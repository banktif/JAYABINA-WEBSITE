import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const WA_API = "https://graph.facebook.com/v22.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors, ...extra },
  });
}

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

function cleanPhone(p: string): string {
  let d = (p || "").replace(/[^0-9]/g, "");
  if (d.startsWith("0")) d = "6" + d.substring(1);
  if (!d.startsWith("6")) d = "6" + d;
  return d;
}

async function sendWhatsApp(phone: string, message: string): Promise<{ ok: boolean; error?: string }> {
  const phoneId = Deno.env.get("WA_PHONE_NUMBER_ID");
  const token = Deno.env.get("WA_ACCESS_TOKEN");
  if (!phoneId || !token) return { ok: false, error: "WhatsApp API not configured. Set WA_PHONE_NUMBER_ID and WA_ACCESS_TOKEN secrets." };

  const url = `${WA_API}/${phoneId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: cleanPhone(phone),
    type: "text",
    text: { preview_url: false, body: message },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
  }
  return { ok: true };
}

// ═══════════ SEND MESSAGE ═══════════
async function handleSend(req: Request): Promise<Response> {
  let payload: { phone?: string; message?: string; booking_id?: string };
  try { payload = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  // Option 1: direct phone + message
  if (payload.phone && payload.message) {
    const r = await sendWhatsApp(payload.phone, payload.message);
    return r.ok ? json({ status: "ok", sent: true }) : json({ error: r.error }, 502);
  }

  // Option 2: booking_id — prefills customer phone + message from template
  if (payload.booking_id && payload.template) {
    const sb = admin();
    const { data: booking, error } = await sb
      .from("bookings")
      .select("id, customer_name, customer_phone, customer_address")
      .eq("id", payload.booking_id)
      .single();
    if (error || !booking) return json({ error: "Booking not found" }, 404);

    // Read template from app_settings
    const { data: tmpl } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", payload.template)
      .single();

    if (!tmpl || !tmpl.value) return json({ error: "Template not found: " + payload.template }, 404);

    // Fill template placeholders
    let msg = tmpl.value
      .replace(/\{nama\}/g, booking.customer_name || "")
      .replace(/\{alamat\}/g, booking.customer_address || "")
      .replace(/\{pay_url\}/g, payload.pay_url || "");

    if (payload.extra) {
      for (const [k, v] of Object.entries(payload.extra)) {
        msg = msg.replace(new RegExp(`{${k}}`, "g"), String(v));
      }
    }

    const r = await sendWhatsApp(booking.customer_phone, msg);
    return r.ok ? json({ status: "ok", sent: true }) : json({ error: r.error }, 502);
  }

  return json({ error: "phone+message or booking_id+template required" }, 400);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const path = new URL(req.url).pathname;
  try {
    if (path.endsWith("/send")) return await handleSend(req);
    return json({ error: "Not found" }, 404);
  } catch (_e) {
    return json({ error: "Internal error" }, 500);
  }
});
