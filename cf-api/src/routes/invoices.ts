import { and, eq, like, or, sql } from 'drizzle-orm';
import type { Env } from '../types';
import { err, ok, uuid, nowISO, json as jsonResponse } from '../utils/helpers';
import { requireAuth } from '../utils/middleware';
import { createDb, type AppDb } from '../db/client';
import { appSettings as appSettingsTbl, bookings, invoices, receipts } from '../db/schema';
import { nextDocNumber } from '../utils/counter';

export async function handleInvoices(req: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(req.url);
  const db = createDb(env);

  // GET /api/invoices/customer?phone=XXX — customer view invoices
  if (path === '/api/invoices/customer' && req.method === 'GET') {
    try {
      const phone = url.searchParams.get('phone') || '';
      if (!phone) return err('Missing phone parameter');
      const rows = await db.select().from(invoices)
        .where(eq(invoices.customerPhone, phone))
        .orderBy(sql`${invoices.createdAt} DESC`).all();
      return ok(rows);
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // GET /api/invoices - list
  if (path === '/api/invoices' && req.method === 'GET') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'admin') return err('Admin only', 403);

      const status = url.searchParams.get('status');
      const query = url.searchParams.get('q') || '';
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
      const offset = parseInt(url.searchParams.get('offset') || '0');

      let conditions = [];
      if (status) conditions.push(eq(invoices.status, status));
      if (query) {
        conditions.push(or(
          like(invoices.customerName, `%${query}%`),
          like(invoices.customerPhone, `%${query}%`),
          like(invoices.number, `%${query}%`)
        ) as any);
      }

      const rows = await db.select().from(invoices)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(sql`${invoices.createdAt} DESC`)
        .limit(limit).offset(offset).all();

      return ok(rows);
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // POST /api/invoices/generate - auto-generate from booking
  if (path === '/api/invoices/generate' && req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'admin') return err('Admin only', 403);

      const { booking_id } = await req.json() as any;
      if (!booking_id) return err('Missing booking_id');

      return await generateInvoice(db, booking_id);
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // POST /api/invoices/:id/send — send invoice to customer
  const sendMatch = path.match(/^\/api\/invoices\/([a-f0-9-]+)\/send$/);
  if (sendMatch && req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'admin') return err('Admin only', 403);
      const inv = await db.select().from(invoices).where(eq(invoices.id, sendMatch[1])).get();
      if (!inv) return err('Not found', 404);

      return await sendInvoiceNotification(db, inv, env);
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // POST /api/invoices/:id/pay — create balance payment link
  const payMatch = path.match(/^\/api\/invoices\/([a-f0-9-]+)\/pay$/);
  if (payMatch && req.method === 'POST') {
    try {
      const inv = await db.select().from(invoices).where(eq(invoices.id, payMatch[1])).get();
      if (!inv) return err('Not found', 404);
      if (inv.status === 'paid') return err('Invoice already paid');
      if (inv.balanceDue <= 0) return err('No balance due');

      if (!env.BAYARCASH_PAT || !env.BAYARCASH_PORTAL_KEY) return err('Payment gateway not configured', 500);

      const orderRef = `INV${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2,6).toUpperCase()}`.substring(0, 30);
      const siteUrl = (env.SITE_URL || 'https://www.jayabina.com').replace(/\/$/, '');
      const amount = Number(inv.balanceDue).toFixed(2);
      const payerName = String(inv.customerName || 'Pelanggan').slice(0, 100);
      const payerEmail = `${inv.id.slice(0, 8)}@jayabina.local`;
      const phone = malaysiaPhone(inv.customerPhone || '');
      const channel = parseInt(env.BAYARCASH_PAYMENT_CHANNEL || '5', 10);
      const body: Record<string, unknown> = {
        payment_channel: channel, portal_key: env.BAYARCASH_PORTAL_KEY,
        order_number: orderRef, amount, payer_name: payerName, payer_email: payerEmail,
        return_url: `${siteUrl}/success.html?order=${inv.bookingId}&type=balance`,
        callback_url: `${new URL(req.url).origin}/api/payments/bayarcash-callback`
      };
      if (phone) body.payer_telephone_number = phone;
      if (env.BAYARCASH_API_SECRET) {
        body.checksum = await hmacSha256Hex(ksortJoin({
          amount, order_number: orderRef, payer_email: payerEmail,
          payer_name: payerName, payment_channel: channel
        }), env.BAYARCASH_API_SECRET);
      }
      const resp = await fetch('https://api.console.bayar.cash/v3/payment-intents', {
        method: 'POST', headers: { 'Authorization': `Bearer ${env.BAYARCASH_PAT}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const text = await resp.text();
      let data: any;
      try { data = JSON.parse(text); } catch { return err('Payment gateway invalid response', 502); }
      if (!resp.ok || !data.url) return err(data.message || 'Payment creation failed', 502);
      return ok({ url: data.url });
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // GET /api/invoices/:id/pdf — generate PDF-style HTML invoice
  const pdfMatch = path.match(/^\/api\/invoices\/([a-f0-9-]+)\/pdf$/);
  if (pdfMatch && req.method === 'GET') {
    try {
      const inv = await db.select().from(invoices).where(eq(invoices.id, pdfMatch[1])).get();
      if (!inv) return htmlPage('Not Found', '<h1 style="text-align:center;margin-top:80px">Invoice tidak dijumpai.</h1>');

      const items = safeParse(inv.items);
      const serviceItems = items.filter((i: any) => !(i.description || '').startsWith('SST ') && !(i.description || '').includes('Deposit'));
      const taxItems = items.filter((i: any) => (i.description || '').startsWith('SST '));
      const depositItems = items.filter((i: any) => (i.description || '').includes('Deposit'));
      const itemsHtml = serviceItems.map((i: any) => `<tr><td style="padding:10px;border-bottom:1px solid #ddd">${escapeHtml(i.description)}</td><td style="padding:10px;border-bottom:1px solid #ddd;text-align:right;font-weight:600">RM${i.amount}</td></tr>`).join('');
      const taxHtml = taxItems.length ? taxItems.map((i: any) => `<tr><td style="padding:10px;border-bottom:1px solid #ddd;color:#888">${escapeHtml(i.description)}</td><td style="padding:10px;border-bottom:1px solid #ddd;text-align:right;font-weight:600;color:#888">RM${i.amount}</td></tr>`).join('') : '';

      const totalBeforeTax = serviceItems.reduce((s: number, i: any) => s + i.amount, 0);
      const taxTotal = taxItems.reduce((s: number, i: any) => s + i.amount, 0);
      const depositTotal = depositItems.reduce((s: number, i: any) => s + i.amount, 0);

      const paidBadge = inv.status === 'paid' ? '<div style="display:inline-block;background:#dcfce7;color:#166534;padding:8px 20px;border-radius:20px;font-weight:700;font-size:1.1em">PAID</div>' : '';

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${escapeHtml(inv.number)} — JAYABINA</title>
<style>body{font-family:Arial,sans-serif;max-width:700px;margin:40px auto;padding:20px;color:#333}
h1{color:#166534;font-size:24px;border-bottom:3px solid #166534;padding-bottom:8px}
.inv-no{font-size:18px;font-weight:700;color:#444;margin-bottom:20px}
table{width:100%;border-collapse:collapse;margin:20px 0}
th{background:#f0fdf4;padding:10px;text-align:left}
.total-row td{font-weight:700;font-size:1.05em;padding:10px}
.summary{margin:24px 0;padding:20px;background:#f8faf9;border-radius:12px}
.summary-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e5e7eb}
.summary-row:last-child{border:none;font-weight:700;font-size:1.1em;color:#166534}
.paid-stamp{position:absolute;top:30%;left:50%;transform:translate(-50%,-50%) rotate(-15deg);font-size:72px;color:rgba(22,101,52,.15);font-weight:900;pointer-events:none;text-transform:uppercase;z-index:0}
.footer{margin-top:40px;font-size:12px;color:#999;border-top:1px solid #eee;padding-top:16px}
@media print{body{margin:0;padding:10mm}@page{margin:10mm}}</style></head><body>
<div style="position:relative">
${inv.status === 'paid' ? '<div class="paid-stamp">PAID</div>' : ''}
<h1>JAYABINA — Invois</h1>
<div class="inv-no">${escapeHtml(inv.number)}</div>
<p><strong>Kepada:</strong> ${escapeHtml(inv.customerName)}</p>
<p><strong>Alamat:</strong> ${escapeHtml(inv.customerAddress)}</p>
<p><strong>Telefon:</strong> ${escapeHtml(inv.customerPhone)}</p>
<p><strong>Tarikh:</strong> ${new Date().toLocaleDateString('ms-MY')}</p>
${paidBadge}
<table><thead><tr><th>Perkara</th><th style="text-align:right">Harga (RM)</th></tr></thead><tbody>${itemsHtml}${taxHtml}</tbody></table>
<div class="summary">
  <div class="summary-row"><span>Jumlah Keseluruhan</span><span>RM${inv.subtotal}</span></div>
  <div class="summary-row"><span>Deposit (Telah Dibayar)</span><span>-RM${inv.depositPaid || 0}</span></div>
  <div class="summary-row"><span>Baki Perlu Dibayar</span><span>RM${inv.balanceDue}</span></div>
</div>
<p style="font-size:.85rem;color:#666">Sila buat pembayaran dalam masa 7 hari. Semua harga dalam Ringgit Malaysia (RM).</p>
<div class="footer">Jaya Bina Services · No. Pendaftaran: JR0188646-T · www.jayabina.com</div>
</div></body></html>`;

      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // GET /api/invoices/:id
  const idMatch = path.match(/^\/api\/invoices\/([a-f0-9-]+)$/);
  if (idMatch && req.method === 'GET') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'admin') return err('Admin only', 403);
      const inv = await db.select().from(invoices).where(eq(invoices.id, idMatch[1])).get();
      return inv ? ok(inv) : err('Not found', 404);
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // PATCH /api/invoices/:id
  if (idMatch && req.method === 'PATCH') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'admin') return err('Admin only', 403);

      const body = await req.json() as any;
      const current = await db.select().from(invoices).where(eq(invoices.id, idMatch[1])).get();
      if (!current) return err('Not found', 404);

      const updates: Record<string, any> = { updatedAt: nowISO() };
      if (body.status !== undefined) {
        if (!['pending', 'paid', 'cancelled'].includes(body.status)) return err('Invalid status');
        updates.status = body.status;
        if (body.status === 'paid') {
          updates.paidAt = nowISO();
        }
      }
      if (body.wa_sent_at !== undefined) updates.waSentAt = body.wa_sent_at;
      if (body.email_sent_at !== undefined) updates.emailSentAt = body.email_sent_at;

      await db.update(invoices).set(updates).where(eq(invoices.id, idMatch[1]));

      // Auto-generate balance receipt when marked as paid
      if (body.status === 'paid' && current.status !== 'paid') {
        const updated = await db.select().from(invoices).where(eq(invoices.id, idMatch[1])).get();
        if (updated && updated.balanceDue > 0) {
          await generateReceipt(db, updated.bookingId || '', updated.id, 'balance', updated.balanceDue);
        }
        // Send receipt notification
        if (updated) await sendReceiptNotification(db, updated, env);
      }

      const inv = await db.select().from(invoices).where(eq(invoices.id, idMatch[1])).get();
      return ok(inv);
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  return err('Not found', 404);
}

// Generate invoice for a completed booking
export async function generateInvoice(db: AppDb, bookingId: string) {
  const existing = await db.select({ id: invoices.id }).from(invoices)
    .where(eq(invoices.bookingId, bookingId)).get();
  if (existing) return ok({ invoice_id: existing.id, message: 'Invoice already exists' });

  const booking = await db.select({
    id: bookings.id,
    customerName: bookings.customerName,
    customerPhone: bookings.customerPhone,
    customerAddress: bookings.customerAddress,
    amount: bookings.amount,
    depositAmount: bookings.depositAmount,
    createdAt: bookings.createdAt
  }).from(bookings).where(eq(bookings.id, bookingId)).get();

  if (!booking) return err('Booking not found', 404);

  const number = await nextDocNumber(db, 'invoice', invoices);

  const taxEnabled = parseInt(await getSetting(db, 'tax_enabled') || '0', 10) === 1;
  const taxRate = taxEnabled ? parseFloat(await getSetting(db, 'tax_rate') || '6') : 0;
  const taxAmount = taxEnabled ? Math.round((booking.amount || 0) * taxRate) / 100 : 0;
  const total = (booking.amount || 0) + taxAmount;
  const balance = total - (booking.depositAmount || 0);

  const items = JSON.stringify([
    { description: 'Servis Cuci Tangki Air', amount: booking.amount },
    ...(taxEnabled ? [{ description: `SST ${taxRate}%`, amount: taxAmount }] : []),
    { description: 'Deposit (Telah Dibayar)', amount: -(booking.depositAmount || 0) }
  ]);

  const balanceDueCalc = total - (booking.depositAmount || 0);

  const iid = uuid();
  await db.insert(invoices).values({
    id: iid,
    bookingId: bookingId,
    number,
    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    customerAddress: booking.customerAddress,
    items,
    subtotal: total,
    taxRate,
    taxAmount,
    depositPaid: booking.depositAmount || 0,
    balanceDue: balanceDueCalc > 0 ? balanceDueCalc : 0,
    status: 'pending',
    createdAt: nowISO(),
    updatedAt: nowISO()
  });

  // Auto-generate receipt for deposit if already paid
  const paymentStatus = await db.select({ ps: bookings.paymentStatus })
    .from(bookings).where(eq(bookings.id, bookingId)).get();
  if (paymentStatus?.ps === 'paid') {
    await generateReceipt(db, bookingId, iid, 'deposit', booking.depositAmount || 0);
  }

  const inv = await db.select().from(invoices).where(eq(invoices.id, iid)).get();
  if (!inv) return err('Failed to create invoice');

  return ok(inv);
}

// Generate receipt for payment
export async function generateReceipt(
  db: AppDb,
  bookingId: string,
  invoiceId: string,
  paymentType: 'deposit' | 'balance' | 'full',
  amount: number
) {
  const booking = await db.select({
    customerName: bookings.customerName,
    customerPhone: bookings.customerPhone
  }).from(bookings).where(eq(bookings.id, bookingId)).get();
  if (!booking) return;

  const number = await nextDocNumber(db, 'receipt', receipts);

  await db.insert(receipts).values({
    id: uuid(),
    bookingId,
    invoiceId,
    number,
    paymentType,
    amount,
    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    createdAt: nowISO()
  });
}

async function getSetting(db: AppDb, key: string): Promise<string> {
  const row = await db.select({ value: appSettingsTbl.value }).from(appSettingsTbl)
    .where(eq(appSettingsTbl.key, key)).get();
  return row?.value || '';
}

async function sendInvoiceNotification(db: AppDb, inv: any, env: Env) {
  const siteUrl = env.SITE_URL || 'https://www.jayabina.com';
  const items = safeParse(inv.items);
  let itemsText = items.length ? items.map((i: any) => `• ${escapeHtml(i.description)}: RM${i.amount}`).join('\n') : `Servis: RM${inv.subtotal}`;

  const msg = `*JAYABINA — Invois*\n\n` +
    `No: ${inv.number}\nKepada: ${inv.customerName}\n\n` +
    `${itemsText}\n\nJumlah: RM${inv.subtotal}\nDeposit: RM${inv.depositPaid || 0}\n` +
    `*Baki: RM${inv.balanceDue}*\n\nLihat invois: ${siteUrl}/api/invoices/${inv.id}/pdf`;

  let waOk = false, emailOk = false;

  if (env.WA_PHONE_NUMBER_ID && env.WA_ACCESS_TOKEN) {
    let digits = String(inv.customerPhone).replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '6' + digits;
    try {
      const wr = await fetch(`https://graph.facebook.com/v22.0/${env.WA_PHONE_NUMBER_ID}/messages`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${env.WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: digits, type: 'text', text: { body: msg } })
      });
      waOk = wr.ok;
    } catch {}
  }

  if (env.RESEND_API_KEY) {
    try {
      const itemsHtml = items.length ? items.map((i: any) => `<tr><td>${escapeHtml(i.description)}</td><td style="text-align:right">RM${i.amount}</td></tr>`).join('') : '';
      const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><h2 style="color:#166534">JAYABINA — Invois ${inv.number}</h2><p>Kepada: <strong>${inv.customerName}</strong></p><table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f0fdf4"><th style="text-align:left;padding:8px">Item</th><th style="text-align:right;padding:8px">Harga</th></tr></thead><tbody>${itemsHtml}</tbody></table><p><strong>Jumlah: RM${inv.subtotal}</strong> | Deposit: RM${inv.depositPaid || 0} | <strong>Baki: RM${inv.balanceDue}</strong></p><p style="color:#666">Terima kasih kerana menggunakan servis JAYABINA!</p></div>`;
      await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'JAYABINA <noreply@jayabina.com>', to: [inv.customerPhone + '@jayabina.local'], subject: `Invois ${inv.number} — JAYABINA`, html })
      });
      emailOk = true;
    } catch {}
  }

  const now = nowISO();
  const sends: Record<string, any> = { updatedAt: now };
  if (waOk) sends.waSentAt = now;
  if (emailOk) sends.emailSentAt = now;
  await db.update(invoices).set(sends).where(eq(invoices.id, inv.id));
  return ok({ sent: true, wa: waOk, email: emailOk });
}

async function sendReceiptNotification(db: AppDb, inv: any, env: Env) {
  const siteUrl = env.SITE_URL || 'https://www.jayabina.com';
  const msg = `*JAYABINA — Resit Pembayaran*\n\n` +
    `Invois: ${inv.number}\nKepada: ${inv.customerName}\n` +
    `Jumlah Dibayar: RM${inv.balanceDue}\n` +
    `Status: PAID ✓\n\nTerima kasih! ${siteUrl}`;

  if (env.WA_PHONE_NUMBER_ID && env.WA_ACCESS_TOKEN) {
    let digits = String(inv.customerPhone).replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '6' + digits;
    try {
      await fetch(`https://graph.facebook.com/v22.0/${env.WA_PHONE_NUMBER_ID}/messages`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${env.WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: digits, type: 'text', text: { body: msg } })
      });
    } catch {}
  }
}

function safeParse(raw: any): any[] {
  try { const v = JSON.parse(typeof raw === 'string' ? raw : '{}'); return Array.isArray(v) ? v : []; } catch { return []; }
}

function escapeHtml(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function htmlPage(title: string, body: string): Response {
  return new Response(`<!DOCTYPE html><html lang="ms"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — JAYABINA</title><style>body{font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:24px;color:#333;background:#f8faf9}</style></head><body>${body}</body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

function malaysiaPhone(raw: string): string {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `6${digits}`;
  else if (digits && !digits.startsWith('60')) digits = `60${digits}`;
  return digits;
}

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function ksortJoin(data: Record<string, unknown>): string {
  return Object.keys(data).sort().map(k => {
    const value = data[k];
    return value === null || value === undefined ? '' : String(value);
  }).join('|');
}
