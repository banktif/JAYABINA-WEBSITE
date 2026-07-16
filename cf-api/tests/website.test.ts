import { env, exports as workerExports } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, signJWT } from '../src/utils/helpers';
import { buildWebsiteSettingsFiles, isEditableWebsitePath, parseWebsiteSettings, validateWebsiteSettings, WEBSITE_FILES } from '../src/routes/website';

const ADMIN_ID = '20000000-0000-4000-8000-000000000001';
const STAFF_ID = '20000000-0000-4000-8000-000000000002';
let adminToken = '';
let staffToken = '';

beforeAll(async () => {
  adminToken = await signJWT({ sub: ADMIN_ID, role: 'admin', name: 'Website Admin' }, env.JWT_SECRET);
  staffToken = await signJWT({ sub: STAFF_ID, role: 'staff', name: 'Website Staff' }, env.JWT_SECRET);
});

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const password = await hashPassword('TestPassword123!');
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO profiles (id,full_name,phone,role,is_active,email,address,avatar_url,service_area,password,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(ADMIN_ID, 'Website Admin', '60110000011', 'admin', 1, 'website-admin@example.test', '', '', '', password, '2026-01-01T00:00:00.000Z'),
    env.DB.prepare('INSERT OR REPLACE INTO profiles (id,full_name,phone,role,is_active,email,address,avatar_url,service_area,password,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(STAFF_ID, 'Website Staff', '60110000012', 'staff', 1, 'website-staff@example.test', '', '', '', password, '2026-01-01T00:00:00.000Z')
  ]);
});

async function call(path: string, token?: string, method = 'GET', body?: unknown) {
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await workerExports.default.fetch(new Request(`https://api.example.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  }));
  return { status: response.status, body: await response.json() as any };
}

describe('Hugo website management', () => {
  it('uses a strict editable-file allowlist', () => {
    expect(WEBSITE_FILES.length).toBeGreaterThan(10);
    expect(isEditableWebsitePath('site/content/_index.md')).toBe(true);
    expect(isEditableWebsitePath('site/content/blog/artikel-baharu.md')).toBe(true);
    expect(isEditableWebsitePath('site/content/blog/Artikel.md')).toBe(false);
    expect(isEditableWebsitePath('../admin/index.html')).toBe(false);
    expect(isEditableWebsitePath('site/hugo.toml')).toBe(false);
  });

  it('requires an active admin account', async () => {
    expect((await call('/api/website/files')).status).toBe(401);
    expect((await call('/api/website/files', staffToken)).status).toBe(403);
    const admin = await call('/api/website/files', adminToken);
    expect(admin.status).toBe(200);
    expect(admin.body.data.repo).toBe('banktif/jayaclean-salespage');
    expect(admin.body.data.files).toHaveLength(WEBSITE_FILES.length);
  });

  it('fails safely when GitHub publishing is not configured', async () => {
    const missing = await call('/api/website/file?path=site%2Fcontent%2F_index.md', adminToken);
    expect(missing.status).toBe(503);
    expect((await call('/api/website/settings', adminToken)).status).toBe(503);
    const traversal = await call('/api/website/file', adminToken, 'PUT', { path: '../theme.css', content: 'x' });
    expect(traversal.status).toBe(400);
  });

  it('round-trips structured Hugo settings without losing managed fields', () => {
    const source = {
      'site/hugo.toml': `baseURL = "https://www.jayabina.com/"
locale = "ms-MY"
defaultContentLanguage = "ms"
title = "JAYABINA"

[params]
  description = "Default description"
  brand = "JAYABINA"
  company = "Primex Jaya Bina Solutions"
  companyNumber = "JR0188646-T"
  phoneDisplay = "013-937 3275"
  phoneTel = "+60139373275"
  whatsapp = "60139373275"
  serviceArea = "Kuala Lumpur dan Selangor"

[[menus.main]]
  name = "Utama"
  pageRef = "/"
  weight = 10
[[menus.main]]
  name = "Servis"
  pageRef = "/servis"
  weight = 20
`,
      'site/data/business.yaml': `brand: JAYABINA
legal_name: Primex Jaya Bina Solutions
company_number: JR0188646-T
domain: www.jayabina.com
phone_display: 013-937 3275
phone_tel: "+60139373275"
whatsapp: "60139373275"
service_area: Kuala Lumpur dan Selangor
`,
      'site/data/services.yaml': `- key: roof
  name: Tukar Atap Baharu
  kicker: TUKAR ATAP
  title: Atap masih bocor?
  summary: Penilaian dan penggantian atap baharu.
  url: /servis-tukar-atap/
  image: /images/roof.webp
  alt: Kerja menukar atap
- key: tank
  name: Cuci Tangki Air
  kicker: CUCI TANGKI
  title: Tangki sudah lama tidak dicuci?
  summary: Pemeriksaan dan cucian tangki air rumah.
  url: /servis-cuci-tangki-air/
  image: /images/tank.webp
  alt: Kerja mencuci tangki
- key: paint
  name: Mengecat Rumah
  kicker: MENGECAT RUMAH
  title: Dinding kelihatan pudar?
  summary: Persediaan dan kemasan cat rumah atau ofis.
  url: /servis-mengecat/
  image: /images/paint.webp
  alt: Kerja mengecat rumah
`,
      'site/content/_index.md': `---
title: "Servis Rumah & Ofis | JAYABINA"
description: "Tiga servis rumah dan ofis daripada JAYABINA."
---
`
    };
    const parsed = parseWebsiteSettings(source);
    expect(parsed.general.company_number).toBe('JR0188646-T');
    expect(parsed.navigation).toHaveLength(2);
    expect(parsed.services.map(service => service.key)).toEqual(['roof', 'tank', 'paint']);
    expect(validateWebsiteSettings(parsed)).toBe('');

    const generated = buildWebsiteSettingsFiles(parsed);
    const reparsed = parseWebsiteSettings(generated);
    expect(reparsed).toEqual(parsed);
  });

  it('rejects unsafe structured website settings', () => {
    const invalid: any = {
      general: { site_title: 'JAYABINA', site_url: 'http://example.com', locale: 'ms-MY', default_language: 'ms', brand: 'JAYABINA', legal_name: 'Company', company_number: '1', domain: 'example.com', phone_display: '012', phone_tel: '+60123456789', whatsapp: '60123456789', service_area: 'KL' },
      seo: { homepage_title: 'Home', homepage_description: 'Description', site_description: 'Description' },
      navigation: [{ name: 'Unsafe', page_ref: '/../admin', weight: 10 }],
      services: []
    };
    expect(validateWebsiteSettings(invalid)).toBe('Public URL must use HTTPS');
    invalid.general.site_url = 'https://example.com';
    expect(validateWebsiteSettings(invalid)).toContain('Navigation path is invalid');
  });
});
