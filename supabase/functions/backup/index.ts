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
function hex(bytes: Uint8Array) { return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(""); }
function b64url(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
async function gzipBytes(str: string): Promise<Uint8Array> {
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function fetchAll(sb: ReturnType<typeof admin>, table: string): Promise<any[]> {
  const out: any[] = []; const page = 1000; let from = 0;
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

// ---------- Google Drive (service account) ----------
function pemToDer(pem: string) {
  const b = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const raw = atob(b); const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer;
}
async function googleTokenFromSA(sa: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc({ alg: "RS256", typ: "JWT" }) + "." + enc({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.file", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const key = await crypto.subtle.importKey("pkcs8", pemToDer((sa.private_key || "").replace(/\\n/g, "\n")), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(unsigned));
  const jwt = unsigned + "." + b64url(new Uint8Array(sig));
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + jwt });
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
  const body = new Uint8Array(pre.length + data.length + post.length);
  body.set(pre, 0); body.set(data, pre.length); body.set(post, pre.length + data.length);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "multipart/related; boundary=" + boundary }, body });
  if (!res.ok) throw new Error("drive upload " + res.status + ": " + (await res.text()).slice(0, 150));
}
async function driveList(token: string, folderId: string) {
  const q = folderId ? `'${folderId}' in parents and trashed=false` : "trashed=false";
  const url = "https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent(q) + "&orderBy=" + encodeURIComponent("createdTime desc") + "&fields=files(id,name)&pageSize=500&supportsAllDrives=true&includeItemsFromAllDrives=true";
  const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  const d = await res.json();
  return (d.files || []) as { id: string; name: string }[];
}
async function driveDelete(token: string, id: string) {
  await fetch("https://www.googleapis.com/drive/v3/files/" + id + "?supportsAllDrives=true", { method: "DELETE", headers: { Authorization: "Bearer " + token } });
}

// ---------- Cloudflare R2 (AWS SigV4) ----------
type R2 = { account: string; accessKey: string; secretKey: string; bucket: string };
async function sha256hexStr(s: string) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))); }
async function sha256hexBytes(b: Uint8Array) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", b))); }
async function hmacRaw(key: Uint8Array, msg: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
}
async function sigKey(secret: string, date: string) {
  let k = await hmacRaw(new TextEncoder().encode("AWS4" + secret), date);
  k = await hmacRaw(k, "auto"); k = await hmacRaw(k, "s3"); k = await hmacRaw(k, "aws4_request");
  return k;
}
function amzNow() { return new Date().toISOString().replace(/[:-]/g, "").replace(/\.\d{3}/, ""); }
function encPath(p: string) { return p.split("/").map((s) => encodeURIComponent(s)).join("/"); }
async function r2Request(cfg: R2, method: string, path: string, query: Record<string, string>, bodyBytes: Uint8Array | null) {
  const host = cfg.account + ".r2.cloudflarestorage.com";
  const amzdate = amzNow(); const datestamp = amzdate.slice(0, 8);
  const payloadHash = bodyBytes && bodyBytes.length ? await sha256hexBytes(bodyBytes) : await sha256hexStr("");
  const canonicalUri = encPath(path);
  const canonicalQuery = Object.keys(query).sort().map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(query[k])).join("&");
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzdate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${datestamp}/auto/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzdate}\n${scope}\n${await sha256hexStr(canonicalRequest)}`;
  const signature = hex(await hmacRaw(await sigKey(cfg.secretKey, datestamp), stringToSign));
  const auth = `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const url = "https://" + host + canonicalUri + (canonicalQuery ? "?" + canonicalQuery : "");
  return await fetch(url, { method, headers: { Authorization: auth, "x-amz-date": amzdate, "x-amz-content-sha256": payloadHash }, body: bodyBytes });
}
async function r2Put(cfg: R2, key: string, data: Uint8Array) {
  const res = await r2Request(cfg, "PUT", "/" + cfg.bucket + "/" + key, {}, data);
  if (!res.ok) throw new Error("r2 put " + res.status + ": " + (await res.text()).slice(0, 150));
}
async function r2ListKeys(cfg: R2, prefix: string) {
  const res = await r2Request(cfg, "GET", "/" + cfg.bucket, { "list-type": "2", prefix }, null);
  if (!res.ok) throw new Error("r2 list " + res.status);
  const xml = await res.text();
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
  return keys.sort().reverse(); // newest last by name -> reverse to newest first (names are timestamped)
}
async function r2Delete(cfg: R2, key: string) {
  await r2Request(cfg, "DELETE", "/" + cfg.bucket + "/" + key, {}, null);
}
async function r2Presign(cfg: R2, key: string, expires: number) {
  const host = cfg.account + ".r2.cloudflarestorage.com";
  const amzdate = amzNow(); const datestamp = amzdate.slice(0, 8);
  const scope = `${datestamp}/auto/s3/aws4_request`;
  const q: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": cfg.accessKey + "/" + scope,
    "X-Amz-Date": amzdate,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(q).sort().map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(q[k])).join("&");
  const canonicalUri = encPath("/" + cfg.bucket + "/" + key);
  const canonicalRequest = `GET\n${canonicalUri}\n${canonicalQuery}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzdate}\n${scope}\n${await sha256hexStr(canonicalRequest)}`;
  const signature = hex(await hmacRaw(await sigKey(cfg.secretKey, datestamp), stringToSign));
  return "https://" + host + canonicalUri + "?" + canonicalQuery + "&X-Amz-Signature=" + signature;
}

const TABLES = ["app_settings", "profiles", "bookings", "slots", "tasks", "task_photos"];
const KEEP_BACKUPS = 48;
const FREQ_HOURS: Record<string, number> = { hourly: 1, daily: 24, weekly: 168, monthly: 720 };
function isDue(lastAt: string, freq: string): boolean {
  if (!lastAt) return true;
  const h = FREQ_HOURS[freq] || 24;
  return (Date.now() - new Date(lastAt).getTime()) >= (h * 3600 * 1000 - 300000);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = admin();
  if (!(await isAdmin(req, sb))) return json({ error: "Unauthorized" }, 403);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_e) { /* cron sends empty */ }
  const action = String(body.action || "db");

  // load private config (creds)
  const priv: Record<string, string> = {};
  const pr = await sb.from("private_settings").select("key,value");
  (pr.data || []).forEach((r: any) => (priv[r.key] = r.value));
  const gEmail = priv.gdrive_client_email || "", gKey = priv.gdrive_private_key || "", gFolder = priv.gdrive_folder_id || "";
  const driveConfigured = !!(gEmail && gKey);
  const r2cfg: R2 = { account: priv.r2_account_id || "", accessKey: priv.r2_access_key || "", secretKey: priv.r2_secret_key || "", bucket: priv.r2_bucket || "" };
  const r2Configured = !!(r2cfg.account && r2cfg.accessKey && r2cfg.secretKey && r2cfg.bucket);

  try {
    if (action === "db") {
      const force = body.force === true;
      const { data: cfg } = await sb.from("app_settings").select("key,value").in("key", ["backup_freq_drive", "backup_freq_r2", "backup_last_drive_at", "backup_last_r2_at"]);
      const C: Record<string, string> = {};
      (cfg || []).forEach((r: any) => (C[r.key] = r.value));
      const doDrive = driveConfigured && (force || isDue(C.backup_last_drive_at, C.backup_freq_drive || "daily"));
      const doR2 = r2Configured && (force || isDue(C.backup_last_r2_at, C.backup_freq_r2 || "daily"));
      if (!doDrive && !doR2) return json({ status: "ok", data: { skipped: true, reason: driveConfigured || r2Configured ? "not due" : "no destination configured" } });

      const dump: Record<string, unknown> = { _meta: { project: "jayaclean", at: new Date().toISOString() } };
      let total = 0;
      for (const t of TABLES) { const rows = await fetchAll(sb, t); dump[t] = rows; total += rows.length; }
      const gz = await gzipBytes(JSON.stringify(dump));
      const sizeKB = Math.round(gz.length / 1024);
      const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
      const fname = `db-backup-${ts}.json.gz`;
      const now = new Date().toISOString();
      const result: Record<string, unknown> = { rows: total, sizeKB };

      if (doR2) {
        try {
          await r2Put(r2cfg, "db/" + fname, gz);
          try { const keys = await r2ListKeys(r2cfg, "db/"); if (keys.length > KEEP_BACKUPS) { for (const k of keys.slice(KEEP_BACKUPS)) await r2Delete(r2cfg, k); } } catch (_e) { /* best effort */ }
          await setKV(sb, "backup_last_r2_at", now); await setKV(sb, "backup_last_r2_status", `ok (${sizeKB} KB)`);
          result.r2 = "ok";
        } catch (e) { await setKV(sb, "backup_last_r2_status", "error: " + (e as Error).message); result.r2 = "error: " + (e as Error).message; }
      }
      if (doDrive) {
        try {
          const tk = await googleTokenFromSA({ client_email: gEmail, private_key: gKey });
          await driveUpload(tk, gFolder, fname, gz);
          try { const files = (await driveList(tk, gFolder)).filter((f) => f.name.indexOf("db-backup-") === 0); if (files.length > KEEP_BACKUPS) { for (const f of files.slice(KEEP_BACKUPS)) await driveDelete(tk, f.id); } } catch (_e) { /* best effort */ }
          await setKV(sb, "backup_last_drive_at", now); await setKV(sb, "backup_last_drive_status", `ok (${sizeKB} KB)`);
          result.drive = "ok";
        } catch (e) { await setKV(sb, "backup_last_drive_status", "error: " + (e as Error).message); result.drive = "error: " + (e as Error).message; }
      }
      await setKV(sb, "backup_last_db_at", now); await setKV(sb, "backup_last_db_status", `ok (${total} rows, ${sizeKB} KB gz)`);
      return json({ status: "ok", data: result });
    }

    if (action === "list") {
      if (!r2Configured) return json({ status: "ok", data: [] });
      const keys = await r2ListKeys(r2cfg, "db/");
      const items = [];
      for (const k of keys.slice(0, 60)) items.push({ name: k.replace(/^db\//, ""), url: await r2Presign(r2cfg, k, 3600) });
      return json({ status: "ok", data: items });
    }

    if (action === "test_r2") {
      if (!r2Configured) return json({ error: "R2 not configured" }, 400);
      try { await r2Put(r2cfg, "db/.healthcheck", new TextEncoder().encode("ok")); await r2Delete(r2cfg, "db/.healthcheck"); return json({ status: "ok", data: { r2: "reachable" } }); }
      catch (e) { return json({ error: (e as Error).message }, 400); }
    }

    if (action === "code") {
      const ghpat = Deno.env.get("GH_PAT");
      if (!ghpat) return json({ error: "GH_PAT not configured" }, 400);
      const res = await fetch("https://api.github.com/repos/banktif/jayaclean-salespage/actions/workflows/mirror-to-gitlab.yml/dispatches", { method: "POST", headers: { Authorization: "Bearer " + ghpat, Accept: "application/vnd.github+json", "User-Agent": "jayaclean-backup", "X-GitHub-Api-Version": "2022-11-28" }, body: JSON.stringify({ ref: "master" }) });
      const ok = res.status === 204;
      await setKV(sb, "backup_last_code_at", new Date().toISOString());
      await setKV(sb, "backup_last_code_status", ok ? "triggered" : ("error " + res.status));
      if (!ok) return json({ error: "dispatch failed", detail: (await res.text()).slice(0, 150) }, 502);
      return json({ status: "ok", data: { triggered: true } });
    }

    if (action === "status") {
      const { data } = await sb.from("app_settings").select("key,value").in("key", ["backup_last_code_at", "backup_last_code_status", "backup_freq_drive", "backup_freq_r2", "backup_last_drive_at", "backup_last_drive_status", "backup_last_r2_at", "backup_last_r2_status"]);
      const m: Record<string, string> = {};
      (data || []).forEach((r: any) => (m[r.key] = r.value));
      m.drive_configured = driveConfigured ? "true" : "false";
      m.r2_configured = r2Configured ? "true" : "false";
      m.gdrive_client_email = gEmail; m.gdrive_folder_id = gFolder;
      m.r2_account_id = r2cfg.account; m.r2_access_key = r2cfg.accessKey; m.r2_bucket = r2cfg.bucket;
      return json({ status: "ok", data: m });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: "Internal error", detail: (e as Error).message }, 500);
  }
});
