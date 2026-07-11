import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BAYARCASH_API = "https://api.console.bayar.cash/v3/payment-intents";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors, ...extra },
  });
}

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function ksortJoin(data: Record<string, unknown>): string {
  return Object.keys(data)
    .sort()
    .map((k) => {
      const v = data[k];
      return v === null || v === undefined ? "" : String(v);
    })
    .join("|");
}

function normalizePhone(raw: string): string {
  let d = (raw || "").replace(/[^0-9]/g, "");
  if (d.startsWith("0")) d = "6" + d.substring(1);
  return d;
}

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

async function handleCreateIntent(req: Request): Promise<Response> {
  const PAT = Deno.env.get("BAYARCASH_PAT");
  const PORTAL = Deno.env.get("BAYARCASH_PORTAL_KEY");
  const SECRET = Deno.env.get("BAYARCASH_API_SECRET");
  const CHANNEL = parseInt(Deno.env.get("BAYARCASH_PAYMENT_CHANNEL") ?? "5", 10);
  if (!PAT || !PORTAL) return json({ error: "Payment gateway not configured" }, 500);

  let payload: { booking_id?: string; origin?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const bookingId = payload.booking_id;
  if (!bookingId) return json({ error: "booking_id required" }, 400);

  const sb = admin();
  const { data: booking, error } = await sb
    .from("bookings")
    .select("id, customer_name, customer_phone, deposit_amount, payment_status")
    .eq("id", bookingId)
    .single();
  if (error || !booking) return json({ error: "Booking not found" }, 404);
  if (booking.payment_status === "paid") return json({ error: "Already paid" }, 409);

  const amount = Number(booking.deposit_amount ?? 150).toFixed(2);
  const payerName = String(booking.customer_name || "Pelanggan").slice(0, 100);
  const payerEmail = `${String(booking.id).slice(0, 8)}@jayabina.local`;
  const phone = normalizePhone(booking.customer_phone || "");

  // Bayarcash order_number max 30 chars — UUID (36) is rejected.
  // Generate a short unique ref and store it so the callback can map back.
  const orderNo = ("JB" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
  await sb
    .from("bookings")
    .update({ bayarcash_ref: orderNo, updated_at: new Date().toISOString() })
    .eq("id", booking.id);

  const siteOrigin = (payload.origin || Deno.env.get("SITE_URL") || "https://cuci.jayabina.com").replace(/\/$/, "");
  const returnUrl = `${siteOrigin}/success.html?order=${booking.id}`;
  const callbackUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/bayarcash/callback`;

  const body: Record<string, unknown> = {
    payment_channel: CHANNEL,
    portal_key: PORTAL,
    order_number: orderNo,
    amount,
    payer_name: payerName,
    payer_email: payerEmail,
    return_url: returnUrl,
    callback_url: callbackUrl,
  };
  if (phone) body.payer_telephone_number = phone;

  if (SECRET) {
    body.checksum = await hmacSha256Hex(
      ksortJoin({
        amount,
        order_number: orderNo,
        payer_email: payerEmail,
        payer_name: payerName,
        payment_channel: CHANNEL,
      }),
      SECRET,
    );
  }

  const res = await fetch(BAYARCASH_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAT}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    return json({ error: "Gateway error", detail: text.slice(0, 300) }, 502);
  }
  if (!res.ok || !data.url) {
    return json({ error: "Payment creation failed", detail: data }, 502);
  }

  return json({ url: data.url, id: data.id ?? null });
}

async function handleCallback(req: Request): Promise<Response> {
  const SECRET = Deno.env.get("BAYARCASH_API_SECRET");

  let p: Record<string, unknown>;
  const ct = req.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) {
      p = await req.json();
    } else {
      const form = await req.formData();
      p = {};
      for (const [k, v] of form.entries()) p[k] = v;
    }
  } catch {
    return json({ error: "Invalid callback" }, 400);
  }

  const orderNumber = String(p.order_number || "");
  if (!orderNumber) return json({ error: "order_number missing" }, 400);

  if (SECRET) {
    const expected = await hmacSha256Hex(
      ksortJoin({
        amount: p.amount,
        currency: p.currency,
        datetime: p.datetime,
        exchange_reference_number: p.exchange_reference_number,
        exchange_transaction_id: p.exchange_transaction_id,
        order_number: p.order_number,
        payer_bank_name: p.payer_bank_name,
        payer_email: p.payer_email,
        payer_name: p.payer_name,
        record_type: p.record_type,
        status: p.status,
        status_description: p.status_description,
        transaction_id: p.transaction_id,
      }),
      SECRET,
    );
    if (expected !== String(p.checksum || "")) {
      return json({ error: "Invalid checksum" }, 401);
    }
  }

  const status = parseInt(String(p.status ?? ""), 10);
  const paid = status === 3;
  const failed = status === 2 || status === 4;

  const sb = admin();
  const update: Record<string, unknown> = {
    bayarcash_transaction_id: String(p.transaction_id || "") || null,
    updated_at: new Date().toISOString(),
  };
  if (paid) {
    update.payment_status = "paid";
    const { data: setting } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", "auto_confirm_payment")
      .single();
    if (!setting || setting.value !== "false") {
      update.status = "confirmed";
    }
  } else if (failed) {
    update.payment_status = "failed";
  }

  await sb.from("bookings").update(update).eq("bayarcash_ref", orderNumber).eq("payment_status", "pending");

  return json({ ok: true });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const path = new URL(req.url).pathname;
  try {
    if (path.endsWith("/callback")) return await handleCallback(req);
    if (path.endsWith("/create-intent")) return await handleCreateIntent(req);
    return json({ error: "Not found" }, 404);
  } catch (_e) {
    return json({ error: "Internal error" }, 500);
  }
});
