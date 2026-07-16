import type { Env } from '../types';
import { err, ok, uuid, nowISO } from '../utils/helpers';
import { requireAuth, requireAdmin, getPrivateSetting, getSetting } from '../utils/middleware';

export async function handleBackup(req: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(req.url);

  // POST /api/backup/db
  if (path === '/api/backup/db' && req.method === 'POST') {
    try {
      await checkBackupAuth(req, env);
      const body = await req.json().catch(() => ({})) as any;
      const force = body.force === true;
      const drive = await loadDriveConfig(env.DB);
      const r2Configured = !!env.BACKUP_R2;
      const driveConfigured = !!(drive.email && drive.privateKey);
      if (!r2Configured && !driveConfigured) return err('No backup destination is configured', 503);
      const doR2 = r2Configured && (force || await isBackupDue(env.DB, 'r2'));
      const doDrive = driveConfigured && (force || await isBackupDue(env.DB, 'drive'));
      if (!doR2 && !doDrive) {
        return ok({ skipped: true, reason: 'not due' });
      }

      const now = nowISO();
      const tables = ['profiles', 'app_settings', 'bookings', 'slots', 'tasks', 'task_photos', 'customers'];
      const dump: Record<string, any[]> = {};
      const tableQueries: Record<string, string> = {
        profiles: 'SELECT id, full_name, phone, role, is_active, email, address, avatar_url, service_area, created_at FROM profiles'
      };

      for (const table of tables) {
        let offset = 0;
        const rows: any[] = [];
        while (true) {
          const query = tableQueries[table] || `SELECT * FROM ${table}`;
          const batch = await env.DB.prepare(`${query} LIMIT 1000 OFFSET ?`).bind(offset).all();
          rows.push(...batch.results as any[]);
          if (batch.results.length < 1000) break;
          offset += 1000;
        }
        dump[table] = rows;
      }

      const json = JSON.stringify({ _meta: { project: 'jayaclean', timestamp: now }, ...dump });
      const compressed = await gzip(json);
      const filename = `db-backup-${now.replace(/[:.]/g, '-')}.json.gz`;

      const result: Record<string, unknown> = { filename, tables: tables.length, timestamp: now };
      const failures: string[] = [];
      let succeeded = 0;

      if (doR2 && env.BACKUP_R2) {
        const r2Key = `db/${filename}`;
        try {
          await env.BACKUP_R2.put(r2Key, compressed, { httpMetadata: { contentType: 'application/gzip' } });
          await recordBackupLog(env.DB, 'r2', filename, 'ok', compressed.byteLength);
          await updateBackupStatus(env.DB, 'r2', now, `ok (${Math.round(compressed.byteLength / 1024)} KB)`);
          await pruneBackups(env, 'r2', 48);
          result.r2 = 'ok'; succeeded++;
        } catch (e: any) {
          const message = e.message || 'Upload failed';
          await recordBackupLog(env.DB, 'r2', filename, 'error', 0, message);
          await updateBackupStatus(env.DB, 'r2', now, `error: ${message}`);
          result.r2 = `error: ${message}`; failures.push('R2');
        }
      }

      if (doDrive) {
        try {
          const token = await googleTokenFromSA(drive.email, drive.privateKey);
          await driveUpload(token, drive.folderId, filename, compressed);
          const files = (await driveList(token, drive.folderId)).filter(f => f.name.startsWith('db-backup-'));
          for (const file of files.slice(48)) await driveDelete(token, file.id);
          await recordBackupLog(env.DB, 'drive', filename, 'ok', compressed.byteLength);
          await updateBackupStatus(env.DB, 'drive', now, `ok (${Math.round(compressed.byteLength / 1024)} KB)`);
          result.drive = 'ok'; succeeded++;
        } catch (e: any) {
          const message = e.message || 'Upload failed';
          await recordBackupLog(env.DB, 'drive', filename, 'error', 0, message);
          await updateBackupStatus(env.DB, 'drive', now, `error: ${message}`);
          result.drive = `error: ${message}`; failures.push('Google Drive');
        }
      }

      await env.DB.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('backup_last_db_at', ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`)
        .bind(now, now, now, now).run();
      await env.DB.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('backup_last_db_status', ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`)
        .bind('ok', now, 'ok', now).run();

      if (!succeeded) return err(`${failures.join(' and ')} backup failed`, 502);
      return ok(result);
    } catch (e: any) {
      return err(e.msg || 'Backup failed', e.status || 500);
    }
  }

  // GET /api/backup/list
  if (path === '/api/backup/list' && req.method === 'GET') {
    try {
      await checkBackupAuth(req, env);
      if (!env.BACKUP_R2) return ok([]);

      const objects = await env.BACKUP_R2.list({ prefix: 'db/', limit: 60 });
      const files = [];
      const sorted = objects.objects.sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime());
      for (const obj of sorted) {
        const expires = Math.floor(Date.now() / 1000) + 3600;
        const sig = await signDownload(obj.key, expires, env.JWT_SECRET);
        files.push({
          name: obj.key.replace(/^db\//, ''),
          url: `${url.origin}/api/backup/download?key=${encodeURIComponent(obj.key)}&expires=${expires}&sig=${sig}`,
          size: obj.size,
          uploaded: obj.uploaded.toISOString()
        });
      }
      return ok(files);
    } catch (e: any) {
      return err(e.msg || 'List failed', e.status || 500);
    }
  }

  // GET /api/backup/status
  if (path === '/api/backup/status' && req.method === 'GET') {
    try {
      const payload = await requireAuth(req, env);
      requireAdmin(payload);
      const statusKeys = ['backup_last_db_at', 'backup_last_db_status', 'backup_last_drive_at', 'backup_last_drive_status',
        'backup_last_r2_at', 'backup_last_r2_status', 'backup_last_code_at', 'backup_last_code_status',
        'backup_freq_drive', 'backup_freq_r2'];
      const rows = await env.DB.prepare(`SELECT key, value FROM app_settings WHERE key IN (${statusKeys.map(() => '?').join(',')})`)
        .bind(...statusKeys).all();
      const status: Record<string, string> = {};
      for (const r of rows.results as any[]) status[r.key] = r.value;

      const r2Configured = !!env.BACKUP_R2;
      const drive = await loadDriveConfig(env.DB);
      const driveConfigured = !!(drive.email && drive.privateKey);

      return ok({ ...status, r2_configured: r2Configured, drive_configured: driveConfigured });
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  // POST /api/backup/test_r2
  if (path === '/api/backup/test_r2' && req.method === 'POST') {
    try {
      await checkBackupAuth(req, env);
      if (!env.BACKUP_R2) return err('R2 backup binding is not configured', 503);
      const key = 'db/.healthcheck';
      await env.BACKUP_R2.put(key, 'ok');
      await env.BACKUP_R2.delete(key);
      return ok({ r2: 'reachable' });
    } catch (e: any) {
      return err(e.msg || e.message || 'R2 test failed', e.status || 500);
    }
  }

  if (path === '/api/backup/test_drive' && req.method === 'POST') {
    try {
      await checkBackupAuth(req, env);
      const drive = await loadDriveConfig(env.DB);
      if (!drive.email || !drive.privateKey) return err('Google Drive service account is not configured', 503);
      const token = await googleTokenFromSA(drive.email, drive.privateKey);
      await driveList(token, drive.folderId);
      return ok({ drive: 'reachable' });
    } catch (e: any) {
      return err(e.msg || e.message || 'Google Drive test failed', e.status || 500);
    }
  }

  // GET /api/backup/download (short-lived signed link from the authenticated list call)
  if (path === '/api/backup/download' && req.method === 'GET') {
    if (!env.BACKUP_R2) return err('R2 backup binding is not configured', 503);
    const key = url.searchParams.get('key') || '';
    const expires = parseInt(url.searchParams.get('expires') || '0', 10);
    const sig = url.searchParams.get('sig') || '';
    if (!key.startsWith('db/') || expires < Math.floor(Date.now() / 1000)) return err('Link expired or invalid', 403);
    const expected = await signDownload(key, expires, env.JWT_SECRET);
    if (!safeEqual(sig, expected)) return err('Link expired or invalid', 403);
    const object = await env.BACKUP_R2.get(key);
    if (!object) return err('Backup not found', 404);
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'application/gzip',
        'Content-Disposition': `attachment; filename="${key.split('/').pop() || 'backup.json.gz'}"`,
        'Cache-Control': 'private, no-store'
      }
    });
  }

  // POST /api/backup/code
  if (path === '/api/backup/code' && req.method === 'POST') {
    try {
      await checkBackupAuth(req, env);
      if (!env.GH_PAT) return err('GitHub token is not configured in Cloudflare Worker secrets', 503);
      const response = await fetch('https://api.github.com/repos/banktif/jayaclean-salespage/actions/workflows/mirror-to-gitlab.yml/dispatches', {
        method: 'POST',
        headers: githubHeaders(env.GH_PAT),
        body: JSON.stringify({ ref: 'master' })
      });
      const now = nowISO();
      await setSetting(env.DB, 'backup_last_code_at', now);
      await setSetting(env.DB, 'backup_last_code_status', response.status === 204 ? 'triggered' : `error ${response.status}`);
      if (response.status !== 204) return err('GitHub backup workflow could not be triggered', 502);
      return ok({ triggered: true });
    } catch (e: any) {
      return err(e.msg || e.message || 'Code backup failed', e.status || 500);
    }
  }

  // POST /api/backup/publish-home
  if (path === '/api/backup/publish-home' && req.method === 'POST') {
    try {
      await checkBackupAuth(req, env);
      if (!env.GH_PAT) return err('GitHub token is not configured in Cloudflare Worker secrets', 503);
      const { version } = await req.json() as {version?: string};
      const clean = String(version || '').toLowerCase();
      if (!['v1', 'v2', 'v3', 'v4'].includes(clean)) return err('Invalid homepage version');
      const headers = githubHeaders(env.GH_PAT);
      const srcResponse = await fetch(`https://api.github.com/repos/banktif/jayaclean-salespage/contents/home/${clean}.html`, { headers });
      const src: any = await srcResponse.json();
      if (!srcResponse.ok || !src.content) return err(`Source home/${clean}.html not found`, 404);
      const indexResponse = await fetch('https://api.github.com/repos/banktif/jayaclean-salespage/contents/index.html', { headers });
      const index: any = await indexResponse.json();
      if (!indexResponse.ok || !index.sha) return err('Live homepage metadata could not be read', 502);
      const publish = await fetch('https://api.github.com/repos/banktif/jayaclean-salespage/contents/index.html', {
        method: 'PUT', headers,
        body: JSON.stringify({
          message: `Publish homepage ${clean} to live`,
          content: String(src.content).replace(/\n/g, ''),
          sha: index.sha,
          branch: 'master'
        })
      });
      if (!publish.ok) return err('Homepage publish failed', 502);
      await setSetting(env.DB, 'active_homepage', clean);
      return ok({ published: clean });
    } catch (e: any) {
      return err(e.msg || e.message || 'Homepage publish failed', e.status || 500);
    }
  }

  return err('Not found', 404);
}

// --- helpers ---

async function checkBackupAuth(req: Request, env: Env): Promise<void> {
  const backupKey = req.headers.get('x-backup-key');
  if (backupKey && backupKey === env.BACKUP_SECRET) return;
  const payload = await requireAuth(req, env);
  requireAdmin(payload);
}

async function recordBackupLog(db: D1Database, destination: string, filename: string, status: string, sizeBytes = 0, errorMsg: string | null = null): Promise<void> {
  await db.prepare('INSERT INTO backup_log (id, destination, filename, status, size_bytes, error_msg) VALUES (?,?,?,?,?,?)')
    .bind(uuid(), destination, filename, status, sizeBytes, errorMsg).run();
}

async function updateBackupStatus(db: D1Database, dest: string, ts: string, status: string): Promise<void> {
  const now = nowISO();
  const atKey = `backup_last_${dest}_at`;
  const stKey = `backup_last_${dest}_status`;
  for (const key of [atKey, stKey]) {
    const val = key === atKey ? ts : status;
    await db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=?, updated_at=?`)
      .bind(key, val, now, val, now).run();
  }
}

type DriveConfig = { email: string; privateKey: string; folderId: string };

async function loadDriveConfig(db: D1Database): Promise<DriveConfig> {
  return {
    email: await getPrivateSetting(db, 'gdrive_client_email'),
    privateKey: await getPrivateSetting(db, 'gdrive_private_key'),
    folderId: await getPrivateSetting(db, 'gdrive_folder_id')
  };
}

function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToDer(pem: string): ArrayBuffer {
  const clean = pem.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const raw = atob(clean);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

async function googleTokenFromSA(email: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const enc = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({
    iss: email,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  })}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(privateKey), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${b64url(new Uint8Array(signature))}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(assertion)}`
  });
  const data = await response.json<any>();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Google authentication failed');
  return data.access_token;
}

async function driveUpload(token: string, folderId: string, filename: string, data: Uint8Array): Promise<void> {
  const boundary = `jb-${crypto.randomUUID()}`;
  const metadata: Record<string, unknown> = { name: filename };
  if (folderId) metadata.parents = [folderId];
  const before = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`);
  const after = new TextEncoder().encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(before.length + data.length + after.length);
  body.set(before); body.set(data, before.length); body.set(after, before.length + data.length);
  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
  if (!response.ok) throw new Error(`Drive upload failed (HTTP ${response.status})`);
}

async function driveList(token: string, folderId: string): Promise<Array<{id: string; name: string}>> {
  const query = folderId ? `'${folderId.replace(/'/g, "\\'")}' in parents and trashed=false` : 'trashed=false';
  const params = new URLSearchParams({ q: query, orderBy: 'createdTime desc', fields: 'files(id,name)', pageSize: '500', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json<any>();
  if (!response.ok) throw new Error(data.error?.message || `Drive list failed (HTTP ${response.status})`);
  return data.files || [];
}

async function driveDelete(token: string, id: string): Promise<void> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok && response.status !== 404) throw new Error(`Drive cleanup failed (HTTP ${response.status})`);
}

async function pruneBackups(env: Env, prefix: string, keep: number): Promise<void> {
  if (!env.BACKUP_R2) return;
  const objects = await env.BACKUP_R2.list({ prefix: `db/`, limit: 200 });
  const sorted = objects.objects.sort((a, b) => a.uploaded.getTime() - b.uploaded.getTime());
  if (sorted.length <= keep) return;
  const toDelete = sorted.slice(0, sorted.length - keep);
  for (const obj of toDelete) {
    try { await env.BACKUP_R2.delete(obj.key); } catch {}
  }
}

async function isBackupDue(db: D1Database, destination: 'r2' | 'drive'): Promise<boolean> {
  const frequency = await getSetting(db, `backup_freq_${destination}`) || 'daily';
  const last = await getSetting(db, `backup_last_${destination}_at`);
  if (!last) return true;
  const hours: Record<string, number> = { hourly: 1, daily: 24, weekly: 168, monthly: 720 };
  const dueMs = (hours[frequency] || 24) * 3600 * 1000 - 5 * 60 * 1000;
  return Date.now() - new Date(last).getTime() >= dueMs;
}

async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  const now = nowISO();
  await db.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at')
    .bind(key, value, now).run();
}

function githubHeaders(token: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'jayaclean-cloudflare-worker',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

async function signDownload(key: string, expires: number, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(`${key}|${expires}`));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function gzip(data: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const bytes = enc.encode(data);
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}
