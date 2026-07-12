import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-backup-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...cors } });
}
function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}
async function isAdmin(req: Request, sb: ReturnType<typeof admin>) {
  const key = req.headers.get("x-backup-key");
  if (key && key === Deno.env.get("BACKUP_SECRET")) return true;
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data } = await sb.auth.getUser(token);
  if (!data.user) return false;
  const { data: p } = await sb.from("profiles").select("role,is_active").eq("id", data.user.id).single();
  return !!p && p.role === "admin" && p.is_active;
}
async function setKV(sb: ReturnType<typeof admin>, key: string, value: string) {
  await sb.from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() });
}

// ---------- Google Drive (service account) ----------
function b64url(bytes: Uint8Array) {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pemToDer(pem: string) {
  const b = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const raw = atob(b);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer;
}
async function googleTokenFromSA(sa: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc({ alg: "RS256", typ: "JWT" }) + "." + enc({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.file",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  });
  const pem = (sa.private_key || "").replace(/\\n/g, "\n");
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(unsigned));
  const jwt = unsigned + "." + b64url(new Uint8Array(sig));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + jwt,
  });
  const d = await res.json();
  if (!d.access_token) throw new Error(d.error_description || d.error || "google auth failed");
  return d.access_token as string;
}
async function driveUpload(token: string, folderId: string, filename: string, data: Uint8Array) {
  const boundary = "bkp" + Date.now();
  const meta: Record<string, unknown> = { name: filename };
  if (folderId) meta.parents = [folderId];
  const pre = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`);
  const post = new TextEncoder().encode(`\r\n--${boundary}--`);
  const bodyBytes = new Uint8Array(pre.length + data.length + post.length);
  bodyBytes.set(pre, 0); bodyBytes.set(data, pre.length); bodyBytes.set(post, pre.length + data.length);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true", {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "multipart/related; boundary=" + boundary }, body: bodyBytes,
  });
  if (!res.ok) throw new Error("drive upload " + res.status + ": " + (await res.text()).slice(0, 200));
  return await res.json();
}

async function gzipBytes(str: string): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const stream = new Blob([str]).stream().pipeThrough(cs);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}
async function fetchAll(sb: ReturnType<typeof admin>, table: string): Promise<any[]> {
  const out: any[] = [];
  const page = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from(table).select("*").range(from, from + page - 1);
    if (error) throw new Error(table + ": " + error.message);
    if (!data || data.length === 0) break;
    for (const r of data) out.push(r);
    if (data.length < page) break;
    from += page;
  }
  return out;
}

const TABLES = ["app_settings", "profiles", "bookings", "slots", "tasks", "task_photos"];
const KEEP_BACKUPS = 48;
const FREQ_HOURS: Record<string, number> = { hourly: 1, daily: 24, weekly: 168, monthly: 720 };
function isDue(lastAt: string, freq: string): boolean {
  if (!lastAt) return true;
  const h = FREQ_HOURS[freq] || 24;
  return (Date.now() - new Date(lastAt).getTime()) >= (h * 3600 * 1000 - 300000);
}
async function driveList(token: string, folderId: string) {
  const q = folderId ? `'${folderId}' in parents and trashed=false` : "trashed=false";
  const url = "https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent(q) +
    "&orderBy=" + encodeURIComponent("createdTime desc") + "&fields=files(id,name)&pageSize=500&supportsAllDrives=true&includeItemsFromAllDrives=true";
  const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  const d = await res.json();
  return (d.files || []) as { id: string; name: string }[];
}
async function driveDelete(token: string, id: string) {
  await fetch("https://www.googleapis.com/drive/v3/files/" + id + "?supportsAllDrives=true", { method: "DELETE", headers: { Authorization: "Bearer " + token } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = admin();
  if (!(await isAdmin(req, sb))) return json({ error: "Unauthorized" }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_e) { /* cron may send empty */ }
  const action = String(body.action || "db");

  try {
    if (action === "db") {
      const force = body.force === true;
      // config + last-run
      const { data: cfg } = await sb.from("app_settings").select("key,value").in("key", ["backup_freq_storage", "backup_freq_drive", "backup_last_storage_at", "backup_last_drive_at"]);
      const C: Record<string, string> = {};
      (cfg || []).forEach((r: any) => (C[r.key] = r.value));
      const freqStorage = C.backup_freq_storage || "daily";
      const freqDrive = C.backup_freq_drive || "daily";
      // drive creds
      const priv: Record<string, string> = {};
      const pr = await sb.from("private_settings").select("key,value").in("key", ["gdrive_client_email", "gdrive_private_key", "gdrive_folder_id"]);
      (pr.data || []).forEach((r: any) => (priv[r.key] = r.value));
      const email = priv.gdrive_client_email || "";
      const pkey = priv.gdrive_private_key || "";
      const folder = priv.gdrive_folder_id || Deno.env.get("GDRIVE_FOLDER_ID") || "";
      const driveConfigured = !!(email && pkey);

      const doStorage = force || isDue(C.backup_last_storage_at, freqStorage);
      const doDrive = driveConfigured && (force || isDue(C.backup_last_drive_at, freqDrive));
      if (!doStorage && !doDrive) return json({ status: "ok", data: { skipped: true, reason: "not due" } });

      // Build dump once
      const dump: Record<string, unknown> = { _meta: { project: "jayaclean", at: new Date().toISOString() } };
      let total = 0;
      for (const t of TABLES) { const rows = await fetchAll(sb, t); dump[t] = rows; total += rows.length; }
      const content = JSON.stringify(dump);
      const gz = await gzipBytes(content);
      const sizeKB = Math.round(gz.length / 1024);
      const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
      const fname = `db-backup-${ts}.json.gz`;
      const now = new Date().toISOString();
      const result: Record<string, unknown> = { rows: total, sizeKB };

      if (doStorage) {
        const up = await sb.storage.from("backups").upload("db/" + fname, gz, { contentType: "application/gzip", upsert: true });
        if (up.error) { await setKV(sb, "backup_last_storage_status", "error: " + up.error.message); }
        else {
          try {
            const { data: files } = await sb.storage.from("backups").list("db", { limit: 1000, sortBy: { column: "name", order: "desc" } });
            if (files && files.length > KEEP_BACKUPS) await sb.storage.from("backups").remove(files.slice(KEEP_BACKUPS).map((f: any) => "db/" + f.name));
          } catch (_e) { /* best effort */ }
          await setKV(sb, "backup_last_storage_at", now);
          await setKV(sb, "backup_last_storage_status", `ok (${total} rows, ${sizeKB} KB)`);
        }
        result.storage = up.error ? ("error: " + up.error.message) : "ok";
      }

      if (doDrive) {
        try {
          const tk = await googleTokenFromSA({ client_email: email, private_key: pkey });
          await driveUpload(tk, folder, fname, gz);
          // Drive retention: keep newest KEEP_BACKUPS backup files
          try {
            const files = (await driveList(tk, folder)).filter((f) => f.name.indexOf("db-backup-") === 0);
            if (files.length > KEEP_BACKUPS) { for (const f of files.slice(KEEP_BACKUPS)) await driveDelete(tk, f.id); }
          } catch (_e) { /* best effort */ }
          await setKV(sb, "backup_last_drive_at", now);
          await setKV(sb, "backup_last_drive_status", `ok (${sizeKB} KB)`);
          result.drive = "ok";
        } catch (e) {
          await setKV(sb, "backup_last_drive_status", "error: " + (e as Error).message);
          result.drive = "error: " + (e as Error).message;
        }
      }

      await setKV(sb, "backup_last_db_at", now);
      await setKV(sb, "backup_last_db_status", `ok (${total} rows, ${sizeKB} KB gz)`);
      return json({ status: "ok", data: result });
    }

    if (action === "list") {
      const { data, error } = await sb.storage.from("backups").list("db", { limit: 60, sortBy: { column: "name", order: "desc" } });
      if (error) throw new Error(error.message);
      const items = [];
      for (const f of data || []) {
        const s = await sb.storage.from("backups").createSignedUrl("db/" + f.name, 3600);
        items.push({ name: f.name, size: (f.metadata as any)?.size ?? null, url: s.data?.signedUrl ?? null });
      }
      return json({ status: "ok", data: items });
    }

    if (action === "code") {
      const ghpat = Deno.env.get("GH_PAT");
      if (!ghpat) return json({ error: "GH_PAT not configured" }, 400);
      const res = await fetch("https://api.github.com/repos/banktif/jayaclean-salespage/actions/workflows/mirror-to-gitlab.yml/dispatches", {
        method: "POST",
        headers: { Authorization: "Bearer " + ghpat, Accept: "application/vnd.github+json", "User-Agent": "jayaclean-backup", "X-GitHub-Api-Version": "2022-11-28" },
        body: JSON.stringify({ ref: "master" }),
      });
      const ok = res.status === 204;
      await setKV(sb, "backup_last_code_at", new Date().toISOString());
      await setKV(sb, "backup_last_code_status", ok ? "triggered" : ("error " + res.status));
      if (!ok) return json({ error: "dispatch failed", detail: (await res.text()).slice(0, 200) }, 502);
      return json({ status: "ok", data: { triggered: true } });
    }

    if (action === "status") {
      const { data } = await sb.from("app_settings").select("key,value").in("key", ["backup_enabled", "backup_last_db_at", "backup_last_db_status", "backup_last_code_at", "backup_last_code_status", "backup_freq_storage", "backup_freq_drive", "backup_last_storage_at", "backup_last_storage_status", "backup_last_drive_at", "backup_last_drive_status"]);
      const m: Record<string, string> = {};
      (data || []).forEach((r: any) => (m[r.key] = r.value));
      const pr = await sb.from("private_settings").select("key,value").in("key", ["gdrive_client_email", "gdrive_private_key", "gdrive_folder_id"]);
      const priv: Record<string, string> = {};
      (pr.data || []).forEach((r: any) => (priv[r.key] = r.value));
      m.gdrive_folder_id = priv.gdrive_folder_id || "";
      m.gdrive_client_email = priv.gdrive_client_email || "";
      m.drive_configured = (priv.gdrive_client_email && priv.gdrive_private_key) ? "true" : "false";
      return json({ status: "ok", data: m });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: "Internal error", detail: (e as Error).message }, 500);
  }
});
