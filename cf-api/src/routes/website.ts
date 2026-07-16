import type { Env } from '../types';
import { err, ok } from '../utils/helpers';
import { requireAdmin, requireAuth } from '../utils/middleware';

const REPO = 'banktif/jayaclean-salespage';
const BRANCH = 'master';
const API_ROOT = `https://api.github.com/repos/${REPO}`;
const MAX_CONTENT_BYTES = 500_000;

export type WebsiteFile = {
  path: string;
  label: string;
  group: 'Content' | 'Business data' | 'Advanced templates';
  mode: 'markdown' | 'yaml' | 'html';
};

export type WebsiteSettings = {
  general: {
    site_title: string;
    site_url: string;
    locale: string;
    default_language: string;
    brand: string;
    legal_name: string;
    company_number: string;
    domain: string;
    phone_display: string;
    phone_tel: string;
    whatsapp: string;
    service_area: string;
  };
  seo: {
    homepage_title: string;
    homepage_description: string;
    site_description: string;
  };
  navigation: Array<{ name: string; page_ref: string; weight: number }>;
  services: Array<{
    key: 'roof' | 'tank' | 'paint';
    name: string;
    kicker: string;
    title: string;
    summary: string;
    url: string;
    image: string;
    alt: string;
  }>;
};

const SETTINGS_PATHS = {
  config: 'site/hugo.toml',
  business: 'site/data/business.yaml',
  services: 'site/data/services.yaml',
  homepage: 'site/content/_index.md'
} as const;

export const WEBSITE_FILES: WebsiteFile[] = [
  { path: 'site/content/_index.md', label: 'Homepage SEO', group: 'Content', mode: 'markdown' },
  { path: 'site/content/tentang-kami/index.md', label: 'About us', group: 'Content', mode: 'markdown' },
  { path: 'site/content/hubungi-kami/index.md', label: 'Contact us', group: 'Content', mode: 'markdown' },
  { path: 'site/content/servis/tukar-atap/index.md', label: 'Roof service metadata', group: 'Content', mode: 'markdown' },
  { path: 'site/content/servis/cuci-tangki-air/index.md', label: 'Tank cleaning metadata', group: 'Content', mode: 'markdown' },
  { path: 'site/content/servis/mengecat/index.md', label: 'Painting service metadata', group: 'Content', mode: 'markdown' },
  { path: 'site/content/dasar-privasi/index.md', label: 'Privacy policy', group: 'Content', mode: 'markdown' },
  { path: 'site/content/terma-perkhidmatan/index.md', label: 'Terms of service', group: 'Content', mode: 'markdown' },
  { path: 'site/data/business.yaml', label: 'Company details', group: 'Business data', mode: 'yaml' },
  { path: 'site/data/services.yaml', label: 'Homepage service cards', group: 'Business data', mode: 'yaml' },
  { path: 'site/layouts/index.html', label: 'Homepage layout', group: 'Advanced templates', mode: 'html' },
  { path: 'site/layouts/partials/service-roof.html', label: 'Roof sales page', group: 'Advanced templates', mode: 'html' },
  { path: 'site/layouts/partials/service-tank.html', label: 'Tank sales page', group: 'Advanced templates', mode: 'html' },
  { path: 'site/layouts/partials/service-paint.html', label: 'Painting sales page', group: 'Advanced templates', mode: 'html' },
  { path: 'site/layouts/partials/header.html', label: 'Website header', group: 'Advanced templates', mode: 'html' },
  { path: 'site/layouts/partials/footer.html', label: 'Website footer', group: 'Advanced templates', mode: 'html' }
];

export function isEditableWebsitePath(path: string): boolean {
  if (!path || path.includes('..') || path.includes('\\') || path.startsWith('/')) return false;
  if (WEBSITE_FILES.some(file => file.path === path)) return true;
  return /^site\/content\/blog\/[a-z0-9][a-z0-9-]{0,79}\.md$/.test(path);
}

export async function handleWebsite(req: Request, env: Env, path: string): Promise<Response> {
  try {
    const payload = await requireAuth(req, env);
    requireAdmin(payload);
  } catch (e: any) {
    return err(e.msg || 'Unauthorized', e.status || 401);
  }

  if (path === '/api/website/files' && req.method === 'GET') {
    const files = [...WEBSITE_FILES];
    let warning = '';
    if (env.GH_PAT) {
      try {
        const response = await github(`/contents/site/content/blog?ref=${BRANCH}`, env.GH_PAT);
        const data: any = await response.json();
        if (response.ok && Array.isArray(data)) {
          for (const item of data) {
            if (item.type !== 'file' || item.name === '_index.md' || !/^[a-z0-9][a-z0-9-]{0,79}\.md$/.test(item.name)) continue;
            files.splice(8, 0, {
              path: `site/content/blog/${item.name}`,
              label: item.name.replace(/\.md$/, '').split('-').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
              group: 'Content', mode: 'markdown'
            });
          }
        } else warning = 'Article list could not be loaded';
      } catch {
        warning = 'Article list could not be loaded';
      }
    }
    return ok({
      repo: REPO,
      branch: BRANCH,
      live_url: 'https://www.jayabina.com',
      pages_project: 'jayabina',
      connected: Boolean(env.GH_PAT),
      warning,
      files
    });
  }

  if (path === '/api/website/settings' && req.method === 'GET') {
    if (!env.GH_PAT) return err('GitHub publishing is not configured', 503);
    const token = env.GH_PAT;
    const refResponse = await github(`/git/ref/heads/${BRANCH}`, token);
    const refData: any = await refResponse.json();
    if (!refResponse.ok || !refData.object?.sha) return githubError(refData, refResponse.status, 'Unable to load website version');
    try {
      const entries = await Promise.all((Object.values(SETTINGS_PATHS) as string[]).map(async filePath => {
        const file = await readGithubFile(filePath, token);
        return [filePath, file.content] as const;
      }));
      return ok({
        settings: parseWebsiteSettings(Object.fromEntries(entries)),
        commit_sha: refData.object.sha,
        repo: REPO,
        branch: BRANCH,
        pages_project: 'jayabina'
      });
    } catch (e: any) {
      return err(e?.message || 'Unable to load website settings', e?.status || 502);
    }
  }

  if (path === '/api/website/settings' && req.method === 'PUT') {
    if (!env.GH_PAT) return err('GitHub publishing is not configured', 503);
    const body = await safeJson(req);
    const baseCommit = typeof body.base_commit === 'string' ? body.base_commit : '';
    const validation = validateWebsiteSettings(body.settings);
    if (validation) return err(validation, 400);
    if (!/^[a-f0-9]{40}$/i.test(baseCommit)) return err('Website version is missing or invalid. Reload settings and try again.', 400);

    const refResponse = await github(`/git/ref/heads/${BRANCH}`, env.GH_PAT);
    const refData: any = await refResponse.json();
    if (!refResponse.ok || !refData.object?.sha) return githubError(refData, refResponse.status, 'Unable to verify website version');
    if (refData.object.sha !== baseCommit) return err('Website settings changed in GitHub. Reload before saving to avoid overwriting newer work.', 409);

    const commitResponse = await github(`/git/commits/${baseCommit}`, env.GH_PAT);
    const commitData: any = await commitResponse.json();
    if (!commitResponse.ok || !commitData.tree?.sha) return githubError(commitData, commitResponse.status, 'Unable to read the current website tree');

    const files = buildWebsiteSettingsFiles(body.settings as WebsiteSettings);
    const treeResponse = await github('/git/trees', env.GH_PAT, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: commitData.tree.sha,
        tree: Object.entries(files).map(([filePath, content]) => ({ path: filePath, mode: '100644', type: 'blob', content }))
      })
    });
    const treeData: any = await treeResponse.json();
    if (!treeResponse.ok || !treeData.sha) return githubError(treeData, treeResponse.status, 'Unable to prepare website settings');

    const newCommitResponse = await github('/git/commits', env.GH_PAT, {
      method: 'POST',
      body: JSON.stringify({
        message: 'Update Hugo website settings via JAYABINA Admin',
        tree: treeData.sha,
        parents: [baseCommit]
      })
    });
    const newCommitData: any = await newCommitResponse.json();
    if (!newCommitResponse.ok || !newCommitData.sha) return githubError(newCommitData, newCommitResponse.status, 'Unable to create website settings commit');

    const updateResponse = await github(`/git/refs/heads/${BRANCH}`, env.GH_PAT, {
      method: 'PATCH',
      body: JSON.stringify({ sha: newCommitData.sha, force: false })
    });
    const updateData: any = await updateResponse.json();
    if (!updateResponse.ok) return githubError(updateData, updateResponse.status, 'Unable to publish website settings');
    return ok({
      commit_sha: newCommitData.sha,
      commit_url: `https://github.com/${REPO}/commit/${newCommitData.sha}`,
      files: Object.keys(files),
      deployment: 'GitHub Actions started automatically'
    });
  }

  if (path === '/api/website/file' && req.method === 'GET') {
    const filePath = new URL(req.url).searchParams.get('path') || '';
    if (!isEditableWebsitePath(filePath)) return err('This Hugo file is not editable from Admin', 400);
    if (!env.GH_PAT) return err('GitHub publishing is not configured', 503);
    const response = await github(`/contents/${encodePath(filePath)}?ref=${BRANCH}`, env.GH_PAT);
    const data: any = await response.json();
    if (!response.ok || !data.content || !data.sha) return githubError(data, response.status, 'Unable to load Hugo file');
    return ok({ path: filePath, content: decodeBase64(data.content), sha: data.sha, size: data.size || 0, html_url: data.html_url || '' });
  }

  if (path === '/api/website/file' && req.method === 'PUT') {
    const body = await safeJson(req);
    const filePath = typeof body.path === 'string' ? body.path : '';
    const content = typeof body.content === 'string' ? body.content : '';
    const sha = typeof body.sha === 'string' ? body.sha : '';
    if (!isEditableWebsitePath(filePath)) return err('This Hugo file is not editable from Admin', 400);
    if (!content.trim()) return err('Content cannot be empty', 400);
    if (new TextEncoder().encode(content).byteLength > MAX_CONTENT_BYTES) return err('Content is too large', 413);
    if (!env.GH_PAT) return err('GitHub publishing is not configured', 503);

    const payload: Record<string, string> = {
      message: `Update ${filePath.replace(/^site\//, '')} via JAYABINA Admin`,
      content: encodeBase64(content),
      branch: BRANCH
    };
    if (sha) payload.sha = sha;
    const response = await github(`/contents/${encodePath(filePath)}`, env.GH_PAT, { method: 'PUT', body: JSON.stringify(payload) });
    const data: any = await response.json();
    if (!response.ok || !data.commit) return githubError(data, response.status, 'Unable to save Hugo file');
    return ok({
      path: filePath,
      sha: data.content?.sha || '',
      commit_sha: data.commit.sha || '',
      commit_url: data.commit.html_url || '',
      deployment: 'GitHub Actions started automatically'
    });
  }

  if (path === '/api/website/publish' && req.method === 'POST') {
    if (!env.GH_PAT) return err('GitHub publishing is not configured', 503);
    const response = await github('/actions/workflows/deploy-cloudflare-pages.yml/dispatches', env.GH_PAT, {
      method: 'POST', body: JSON.stringify({ ref: BRANCH })
    });
    if (!response.ok) {
      const data: any = await response.json().catch(() => ({}));
      return githubError(data, response.status, 'Unable to start website deployment');
    }
    return ok({ deployment: 'started', live_url: 'https://www.jayabina.com' });
  }

  return err('Not found', 404);
}

export function parseWebsiteSettings(files: Record<string, string>): WebsiteSettings {
  const config = files[SETTINGS_PATHS.config] || '';
  const business = files[SETTINGS_PATHS.business] || '';
  const servicesSource = files[SETTINGS_PATHS.services] || '';
  const homepage = files[SETTINGS_PATHS.homepage] || '';
  const params = tomlSection(config, 'params');
  const general = {
    site_title: tomlString(config, 'title') || 'JAYABINA',
    site_url: tomlString(config, 'baseURL') || 'https://www.jayabina.com/',
    locale: tomlString(config, 'locale') || 'ms-MY',
    default_language: tomlString(config, 'defaultContentLanguage') || 'ms',
    brand: yamlString(business, 'brand') || tomlString(params, 'brand'),
    legal_name: yamlString(business, 'legal_name') || tomlString(params, 'company'),
    company_number: yamlString(business, 'company_number') || tomlString(params, 'companyNumber'),
    domain: yamlString(business, 'domain') || domainFromUrl(tomlString(config, 'baseURL')),
    phone_display: yamlString(business, 'phone_display') || tomlString(params, 'phoneDisplay'),
    phone_tel: yamlString(business, 'phone_tel') || tomlString(params, 'phoneTel'),
    whatsapp: yamlString(business, 'whatsapp') || tomlString(params, 'whatsapp'),
    service_area: yamlString(business, 'service_area') || tomlString(params, 'serviceArea')
  };
  return {
    general,
    seo: {
      homepage_title: frontMatterString(homepage, 'title'),
      homepage_description: frontMatterString(homepage, 'description'),
      site_description: tomlString(params, 'description')
    },
    navigation: parseTomlMenus(config),
    services: parseYamlServices(servicesSource)
  };
}

export function buildWebsiteSettingsFiles(settings: WebsiteSettings): Record<string, string> {
  const g = settings.general;
  const q = (value: unknown) => JSON.stringify(String(value ?? ''));
  const config = [
    `baseURL = ${q(withTrailingSlash(g.site_url))}`,
    `locale = ${q(g.locale)}`,
    `defaultContentLanguage = ${q(g.default_language)}`,
    `title = ${q(g.site_title)}`,
    'enableRobotsTXT = true',
    'enableGitInfo = false',
    'canonifyURLs = false',
    'summaryLength = 28',
    '',
    '[params]',
    `  description = ${q(settings.seo.site_description)}`,
    `  brand = ${q(g.brand)}`,
    `  company = ${q(g.legal_name)}`,
    `  companyNumber = ${q(g.company_number)}`,
    `  phoneDisplay = ${q(g.phone_display)}`,
    `  phoneTel = ${q(g.phone_tel)}`,
    `  whatsapp = ${q(g.whatsapp)}`,
    `  serviceArea = ${q(g.service_area)}`,
    '',
    '[taxonomies]',
    '  category = "categories"',
    '  tag = "tags"',
    '',
    '[outputs]',
    '  home = ["HTML", "RSS"]',
    '  section = ["HTML", "RSS"]',
    '',
    '[markup]',
    '  [markup.goldmark]',
    '    [markup.goldmark.renderer]',
    '      unsafe = false',
    '',
    '[minify]',
    '  minifyOutput = true',
    ''
  ];
  for (const item of settings.navigation) {
    config.push('[[menus.main]]', `  name = ${q(item.name)}`, `  pageRef = ${q(item.page_ref)}`, `  weight = ${Math.round(Number(item.weight))}`, '');
  }

  const business = [
    `brand: ${q(g.brand)}`,
    `legal_name: ${q(g.legal_name)}`,
    `company_number: ${q(g.company_number)}`,
    `domain: ${q(g.domain)}`,
    `phone_display: ${q(g.phone_display)}`,
    `phone_tel: ${q(g.phone_tel)}`,
    `whatsapp: ${q(g.whatsapp)}`,
    `service_area: ${q(g.service_area)}`
  ].join('\n') + '\n';

  const services = settings.services.map(service => [
    `- key: ${service.key}`,
    `  name: ${q(service.name)}`,
    `  kicker: ${q(service.kicker)}`,
    `  title: ${q(service.title)}`,
    `  summary: ${q(service.summary)}`,
    `  url: ${q(service.url)}`,
    `  image: ${q(service.image)}`,
    `  alt: ${q(service.alt)}`
  ].join('\n')).join('\n') + '\n';

  const homepage = [
    '---',
    `title: ${q(settings.seo.homepage_title)}`,
    `description: ${q(settings.seo.homepage_description)}`,
    '---'
  ].join('\n') + '\n';

  return {
    [SETTINGS_PATHS.config]: config.join('\n'),
    [SETTINGS_PATHS.business]: business,
    [SETTINGS_PATHS.services]: services,
    [SETTINGS_PATHS.homepage]: homepage
  };
}

export function validateWebsiteSettings(value: any): string {
  if (!value || typeof value !== 'object') return 'Website settings are required';
  const g = value.general, seo = value.seo;
  if (!g || !seo || !Array.isArray(value.navigation) || !Array.isArray(value.services)) return 'Website settings are incomplete';
  const required: Array<[string, unknown, number]> = [
    ['Website title', g.site_title, 80], ['Public URL', g.site_url, 160], ['Brand', g.brand, 60],
    ['Legal company name', g.legal_name, 120], ['Company number', g.company_number, 40], ['Domain', g.domain, 160],
    ['Display phone', g.phone_display, 40], ['Telephone link', g.phone_tel, 24], ['WhatsApp number', g.whatsapp, 20],
    ['Service area', g.service_area, 180], ['Homepage SEO title', seo.homepage_title, 90],
    ['Homepage description', seo.homepage_description, 220], ['Default site description', seo.site_description, 220]
  ];
  for (const [label, input, max] of required) {
    if (typeof input !== 'string' || !input.trim()) return `${label} is required`;
    if (input.length > max) return `${label} must be ${max} characters or fewer`;
  }
  try {
    const url = new URL(g.site_url);
    if (url.protocol !== 'https:') return 'Public URL must use HTTPS';
  } catch { return 'Public URL must be a valid URL'; }
  if (!/^[a-z]{2}-[A-Z]{2}$/.test(g.locale)) return 'Locale must use a format such as ms-MY';
  if (!/^[a-z]{2}$/.test(g.default_language)) return 'Content language must use a two-letter code';
  if (!/^\+[1-9]\d{7,14}$/.test(g.phone_tel)) return 'Telephone link must use international format, for example +60139373275';
  if (!/^\d{8,15}$/.test(g.whatsapp)) return 'WhatsApp number must contain 8 to 15 digits only';
  if (!/^[a-z0-9.-]+$/i.test(g.domain) || g.domain.includes('..')) return 'Domain is invalid';
  if (value.navigation.length < 1 || value.navigation.length > 8) return 'Navigation must contain between 1 and 8 links';
  for (const item of value.navigation) {
    if (!item || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 40) return 'Every navigation link needs a name of 40 characters or fewer';
    if (!safeSitePath(item.page_ref)) return `Navigation path is invalid: ${item.page_ref || '(empty)'}`;
    if (!Number.isInteger(Number(item.weight)) || Number(item.weight) < 0 || Number(item.weight) > 999) return 'Navigation weights must be whole numbers from 0 to 999';
  }
  if (value.services.length !== 3) return 'Exactly three service cards are required';
  const keys = new Set(value.services.map((service: any) => service?.key));
  if (keys.size !== 3 || !['roof', 'tank', 'paint'].every(key => keys.has(key))) return 'Service cards must include roof, tank and paint';
  for (const service of value.services) {
    for (const field of ['name', 'kicker', 'title', 'summary', 'url', 'image', 'alt']) {
      if (typeof service[field] !== 'string' || !service[field].trim()) return `${service.key} service ${field} is required`;
    }
    if (service.name.length > 80 || service.kicker.length > 80 || service.title.length > 180 || service.summary.length > 400 || service.alt.length > 220) return `${service.key} service content is too long`;
    if (!safeSitePath(service.url) || !safeSitePath(service.image)) return `${service.key} service URL or image path is invalid`;
  }
  const files = buildWebsiteSettingsFiles(value as WebsiteSettings);
  if (Object.values(files).some(content => new TextEncoder().encode(content).byteLength > MAX_CONTENT_BYTES)) return 'Generated website settings are too large';
  return '';
}

async function readGithubFile(filePath: string, token: string): Promise<{ content: string; sha: string }> {
  const response = await github(`/contents/${encodePath(filePath)}?ref=${BRANCH}`, token);
  const data: any = await response.json();
  if (!response.ok || !data.content || !data.sha) {
    const error: any = new Error(typeof data?.message === 'string' ? data.message : `Unable to load ${filePath}`);
    error.status = response.status === 404 ? 404 : 502;
    throw error;
  }
  return { content: decodeBase64(data.content), sha: data.sha };
}

function tomlSection(source: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`^\\[${escaped}\\]\\s*$([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, 'm'))?.[1] || '';
}

function tomlString(source: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`^\\s*${escaped}\\s*=\\s*("(?:\\\\.|[^"\\\\])*")\\s*$`, 'm'));
  if (!match) return '';
  try { return JSON.parse(match[1]); } catch { return ''; }
}

function yamlString(source: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`^\\s*${escaped}:\\s*(.*?)\\s*$`, 'm'));
  return match ? scalarString(match[1]) : '';
}

function scalarString(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    try { return JSON.parse(trimmed); } catch { return trimmed.slice(1, -1); }
  }
  return trimmed.replace(/^'|'$/g, '');
}

function frontMatterString(source: string, key: string): string {
  const front = source.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] || '';
  return yamlString(front, key);
}

function parseTomlMenus(source: string): WebsiteSettings['navigation'] {
  const output: WebsiteSettings['navigation'] = [];
  for (const match of source.matchAll(/^\[\[menus\.main\]\]\s*$([\s\S]*?)(?=^\[\[|^\[(?!\[)|(?![\s\S]))/gm)) {
    const block = match[1];
    const name = tomlString(block, 'name'), pageRef = tomlString(block, 'pageRef');
    const weight = Number(block.match(/^\s*weight\s*=\s*(\d+)\s*$/m)?.[1] || 0);
    if (name && pageRef) output.push({ name, page_ref: pageRef, weight });
  }
  return output;
}

function parseYamlServices(source: string): WebsiteSettings['services'] {
  const output: WebsiteSettings['services'] = [];
  for (const block of source.split(/\n(?=- key:\s*)/)) {
    const key = yamlString(block.replace(/^- /, ''), 'key');
    if (!['roof', 'tank', 'paint'].includes(key)) continue;
    output.push({
      key: key as 'roof' | 'tank' | 'paint',
      name: yamlString(block, 'name'),
      kicker: yamlString(block, 'kicker'),
      title: yamlString(block, 'title'),
      summary: yamlString(block, 'summary'),
      url: yamlString(block, 'url'),
      image: yamlString(block, 'image'),
      alt: yamlString(block, 'alt')
    });
  }
  return output;
}

function safeSitePath(value: unknown): boolean {
  return typeof value === 'string' && value.length <= 240 && /^\/[A-Za-z0-9/_\-.%]*$/.test(value) && !value.includes('..');
}

function withTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function domainFromUrl(value: string): string {
  try { return new URL(value).hostname; } catch { return ''; }
}

function github(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'JAYABINA-Admin',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {})
    }
  });
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function safeJson(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}

function githubError(data: any, status: number, fallback: string): Response {
  const code = status === 409 || status === 422 ? 409 : status === 404 ? 404 : 502;
  return err(typeof data?.message === 'string' ? data.message : fallback, code);
}
