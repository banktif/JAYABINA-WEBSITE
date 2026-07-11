import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

function staffEmail(phone: string): string {
  const digits = (phone || "").replace(/[^0-9]/g, "");
  return `${digits}@staff.jayabina.local`;
}

async function requireAdmin(req: Request, sb: ReturnType<typeof admin>) {
  const authz = req.headers.get("Authorization") || "";
  const token = authz.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profile } = await sb
    .from("profiles")
    .select("role, is_active")
    .eq("id", data.user.id)
    .single();
  if (!profile || profile.role !== "admin" || !profile.is_active) return null;
  return data.user;
}

async function createStaff(sb: ReturnType<typeof admin>, s: { full_name?: string; phone?: string; password?: string; email?: string; address?: string; avatar_url?: string; service_area?: string }) {
  const phone = (s.phone || "").replace(/[^0-9]/g, "");
  if (!phone || !s.full_name) return { ok: false, phone, error: "full_name and phone required" };
  if (!s.password || s.password.length < 6) return { ok: false, phone, error: "password min 6 chars" };
  const { data, error } = await sb.auth.admin.createUser({
    email: staffEmail(phone),
    password: s.password,
    email_confirm: true,
    user_metadata: {
      full_name: s.full_name,
      phone,
      role: "staff",
      email: s.email || "",
      address: s.address || "",
      avatar_url: s.avatar_url || "",
      service_area: s.service_area || "",
    },
  });
  if (error) return { ok: false, phone, error: error.message };
  return { ok: true, phone, id: data.user?.id, name: s.full_name };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const sb = admin();
  const caller = await requireAdmin(req, sb);
  if (!caller) return json({ error: "Admin access required" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const action = String(body.action || "");
  try {
    if (action === "create") {
      const r = await createStaff(sb, body as any);
      return r.ok ? json({ status: "ok", data: r }) : json({ error: r.error }, 400);
    }

    if (action === "bulk_create") {
      const list = Array.isArray(body.staff) ? body.staff : [];
      const results = [];
      for (const s of list) results.push(await createStaff(sb, s));
      return json({ status: "ok", data: results });
    }

    if (action === "update") {
      const userId = String(body.user_id || "");
      if (!userId) return json({ error: "user_id required" }, 400);
      const patch: Record<string, unknown> = {};
      for (const k of ["full_name", "email", "address", "avatar_url", "service_area"]) {
        if (body[k] !== undefined) patch[k] = String(body[k] ?? "");
      }
      if (Object.keys(patch).length === 0) return json({ error: "nothing to update" }, 400);
      const { error } = await sb.from("profiles").update(patch).eq("id", userId);
      if (error) return json({ error: error.message }, 400);
      return json({ status: "ok", data: { user_id: userId } });
    }

    if (action === "set_active") {
      const userId = String(body.user_id || "");
      const isActive = Boolean(body.is_active);
      if (!userId) return json({ error: "user_id required" }, 400);
      const { error } = await sb.from("profiles").update({ is_active: isActive }).eq("id", userId);
      if (error) return json({ error: error.message }, 400);
      return json({ status: "ok", data: { user_id: userId, is_active: isActive } });
    }

    if (action === "reset_password") {
      const userId = String(body.user_id || "");
      const password = String(body.password || "");
      if (!userId || password.length < 6) return json({ error: "user_id + password (min 6) required" }, 400);
      const { error } = await sb.auth.admin.updateUserById(userId, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ status: "ok", data: { user_id: userId } });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (_e) {
    return json({ error: "Internal error" }, 500);
  }
});
