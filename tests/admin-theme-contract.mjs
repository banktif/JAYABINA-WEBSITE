import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = {
  html: await readFile(new URL('../admin/index.html', import.meta.url), 'utf8'),
  builtHtml: await readFile(new URL('../admin-public/index.html', import.meta.url), 'utf8'),
  theme: await readFile(new URL('../theme.css', import.meta.url), 'utf8'),
  builtTheme: await readFile(new URL('../admin-public/theme.css', import.meta.url), 'utf8'),
  modern: await readFile(new URL('../admin-modern.css', import.meta.url), 'utf8'),
  builtModern: await readFile(new URL('../admin-public/admin-modern.css', import.meta.url), 'utf8'),
  editor: await readFile(new URL('../admin/editor.html', import.meta.url), 'utf8'),
  builtEditor: await readFile(new URL('../admin-public/editor.html', import.meta.url), 'utf8'),
  editorBundle: await readFile(new URL('../admin/vendor/grapes-editor.bundle.js', import.meta.url)),
  builtEditorBundle: await readFile(new URL('../admin-public/vendor/grapes-editor.bundle.js', import.meta.url))
};

assert.equal(files.builtHtml, files.html, 'admin-public/index.html must match admin/index.html');
assert.equal(files.builtTheme, files.theme, 'built theme.css must match the source');
assert.equal(files.builtModern, files.modern, 'built admin-modern.css must match the source');
assert.equal(files.builtEditor, files.editor, 'admin-public/editor.html must match admin/editor.html');
assert.deepEqual(files.builtEditorBundle, files.editorBundle, 'built GrapesJS bundle must match the source bundle');

for (const token of [
  '--surface-hover:', '--canvas-glow:', '--nav-glass:', '--header-fade:', '--login-card:', '--login-card-border:',
  '--card-bg:', '--card-muted:', '--card-border:', '--card-border-hover:', '--card-shadow:', '--card-shadow-hover:', '--card-radius:'
]) {
  assert.ok(files.theme.includes(token), `missing shared theme token ${token}`);
}

assert.ok(files.theme.includes('html.light{color-scheme:light}'), 'light native controls must use light color-scheme');
assert.ok(files.theme.includes('html.dark{color-scheme:dark}'), 'dark native controls must use dark color-scheme');
assert.ok(files.html.includes('class="login-theme"'), 'login screen must expose a theme toggle');
assert.ok(files.html.includes("theme=h.classList.contains('dark')?'light':'dark'"), 'theme toggle must be a deterministic light/dark switch');
assert.ok(!files.html.includes("?'dark':h.classList.contains('dark')?'system'"), 'legacy three-state toggle must not return');

for (const forbidden of [
  'color:#111827',
  'background:#f8faf9',
  'var(--jb-canvas)',
  'var(--jb-border)',
  'html.dark .admin-app .hdr',
  'html.dark .admin-app .bnav',
  'html.dark .admin-app .d-hdr'
]) {
  assert.ok(!files.modern.includes(forbidden), `hard-coded theme override found: ${forbidden}`);
}

for (const required of [
  'color:var(--text)',
  'border-color:var(--border)',
  'background:var(--surface)',
  'background:var(--nav-glass)!important',
  'background:var(--login-card)'
]) {
  assert.ok(files.modern.includes(required), `missing semantic color usage: ${required}`);
}

for (const cardSelector of [
  '.admin-app .stat', '.admin-app .card', '.admin-app .d-card', '.admin-app .cal-wrap',
  '.admin-app .tk-card', '.admin-app .sGrp', '.admin-app .kpi', '.admin-app .panel',
  '.admin-app .bk-card', '.admin-app .cust-row', '.admin-app .m-sheet'
]) {
  assert.ok(files.modern.includes(cardSelector), `card system must cover ${cardSelector}`);
}

for (const cardRule of [
  'background:var(--card-bg)',
  'border:1px solid var(--card-border)',
  'border-radius:var(--card-radius)',
  'box-shadow:var(--card-shadow)',
  'box-shadow:var(--card-shadow-hover)',
  'background:var(--card-muted)'
]) {
  assert.ok(files.modern.includes(cardRule), `missing unified card rule ${cardRule}`);
}

assert.ok(files.html.includes('?v=20260717-grapes-full1'), 'admin must cache-bust the full visual editor release');
assert.ok(files.html.includes('id="dsWebsite"'), 'desktop navigation must include the Website module');
assert.ok(files.html.includes('function showWebsite()'), 'admin must provide the Hugo website manager');
assert.ok(files.html.includes("API_URL+'/api/website'"), 'website manager must use the authenticated Worker API');
assert.ok(files.modern.includes('.admin-app .site-shell'), 'website manager must have responsive layout styles');
assert.ok(files.html.includes('function renderWebsiteSettings()'), 'website manager must provide structured settings');
assert.ok(files.html.includes("websiteRequest('/settings'"), 'website settings must use the protected Worker API');
assert.ok(files.html.includes('function saveWebsiteSettings()'), 'website manager must save structured settings');
assert.ok(files.modern.includes('.admin-app .site-settings-layout'), 'structured website settings must have responsive layout styles');
assert.ok(files.html.includes('id="siteTabVisual"'), 'Website manager must include the visual editor tab');
assert.ok(files.html.includes('/editor.html?embedded=1'), 'visual editor tab must lazy-load the bundled editor');
assert.ok(files.modern.includes('.admin-app .site-visual-frame-wrap'), 'visual editor must have responsive embedded layout styles');
assert.ok(files.editor.includes('GrapesJS 0.23.2'), 'visual editor must identify the installed GrapesJS version');
assert.ok(files.editor.includes('var MAX_SITES=10'), 'visual editor must enforce the 10-website limit');
assert.ok(files.editor.includes('/api/website/editor/sites'), 'visual editor must use the protected multi-site Worker API');
assert.ok(files.editor.includes('project_data:editor.getProjectData()'), 'visual editor must persist native GrapesJS project data');
assert.ok(!files.editor.includes("localStorage.setItem('gh_pat'"), 'visual editor must never store GitHub tokens in the browser');
assert.ok(files.editorBundle.byteLength > 1_000_000, 'full GrapesJS bundle must be self-hosted');

assert.ok(files.html.includes('<html lang="en"'), 'admin document language must be English');
for (const malayUi of [
  '>Ringkasan<', '>Operasi<', '>Tempahan<', '>Menunggu ', '>Disahkan<', '>Selesai<',
  '>Jadual<', '>Pelanggan<', '>Pasukan & Analitik<', '>Staf<', '>Laporan<', '>Sistem<',
  '>Tetapan<', '>Sandaran<', '>Segarkan data<', '>Tema<', '>Log keluar<', '>Utama<',
  '>Lain-lain<', 'Log masuk ke Operations Portal', '>Log masuk<', 'Akses pentadbir sahaja',
  'No. Syarikat', 'Tandakan kerja ini sebagai selesai?', 'Batalkan tempahan ini?',
  'aria-label="Tukar tema"', 'aria-label="Buka menu"', 'Aktifkan tema cerah', 'Aktifkan tema gelap'
]) {
  assert.ok(!files.html.includes(malayUi), `Malay admin UI text remains: ${malayUi}`);
}

const inlineScripts = [...files.html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
assert.ok(inlineScripts.length >= 2, 'admin must retain its inline application scripts');
for (const [index, source] of inlineScripts.entries()) {
  assert.doesNotThrow(() => new Function(source), `inline admin script ${index + 1} must parse`);
}
const editorScripts = [...files.editor.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
assert.ok(editorScripts.length >= 1, 'visual editor must contain its application script');
for (const [index, source] of editorScripts.entries()) {
  assert.doesNotThrow(() => new Function(source), `inline visual editor script ${index + 1} must parse`);
}

console.log('Admin theme contract: PASS');
