import { and, eq, like, or, sql } from 'drizzle-orm';
import type { Env } from '../types';
import { err, ok, uuid, nowISO, json as jsonResponse } from '../utils/helpers';
import { requireAuth } from '../utils/middleware';
import { createDb, type AppDb } from '../db/client';
import { appSettings as appSettingsTbl, bookings, customers, quotations } from '../db/schema';

// Service templates
const SERVICE_TEMPLATES: Record<string, { name: string; items: { description: string; amount: number }[] }> = {
  cuci_tangki: { name: 'Cuci Tangki Air', items: [
    { description: 'Pemeriksaan & cucian tangki air', amount: 200 },
    { description: 'Disinfeksi & rawatan anti-karat', amount: 100 }
  ]},
  tukar_atap: { name: 'Tukar Atap', items: [
    { description: 'Pemeriksaan struktur atap', amount: 500 },
    { description: 'Pemasangan atap baru', amount: 2000 }
  ]},
  cat_rumah: { name: 'Cat Rumah', items: [
    { description: 'Persediaan permukaan & primer', amount: 800 },
    { description: 'Pengecatan 2 lapis', amount: 1200 }
  ]}
};

export async function handleQuotations(req: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(req.url);
  const db = createDb(env);

  // GET /api/quotations - list
  if (path === '/api/quotations' && req.method === 'GET') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'admin') return err('Admin only', 403);

      const status = url.searchParams.get('status');
      const query = url.searchParams.get('q') || '';
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
      const offset = parseInt(url.searchParams.get('offset') || '0');

      let conditions = [];
      if (status) conditions.push(eq(quotations.status, status));
      if (query) {
        conditions.push(or(
          like(quotations.customerName, `%${query}%`),
          like(quotations.customerPhone, `%${query}%`)
        ) as any);
      }

      const rows = await db.select().from(quotations)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(sql`${quotations.createdAt} DESC`)
        .limit(limit).offset(offset).all();

      return ok(rows);
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  // POST /api/quotations - create
  if (path === '/api/quotations' && req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'admin') return err('Admin only', 403);

      const body = await req.json() as any;
      const { customer_name, customer_phone, customer_address, service_type, amount, details, zone_id } = body;

      if (!customer_name || !customer_phone || !customer_address || !service_type || !amount) {
        return err('Missing required fields');
      }

      const qid = uuid();
      const prefix = await getSetting(db, 'quotation_prefix') || 'QT';
      const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const count = await db.select({ cnt: sql`count(*)` }).from(quotations)
        .where(sql`date(${quotations.createdAt}) = date('now')`).get() as any;
      const seq = String((count?.cnt ?? 0) + 1).padStart(3, '0');
      const number = `${prefix}-${today}-${seq}`;

      await db.insert(quotations).values({
        id: qid,
        customerName: customer_name,
        customerPhone: customer_phone,
        customerAddress: customer_address,
        serviceType: service_type,
        amount,
        details: details ? JSON.stringify(details) : '',
        zoneId: zone_id || null,
        status: 'draft',
        validUntil: body.valid_until || null,
        notes: body.notes || '',
        createdAt: nowISO(),
        updatedAt: nowISO()
      });

      const q = await db.select().from(quotations).where(eq(quotations.id, qid)).get();
      return ok(q);
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  // GET/PATCH /api/quotations/:id
  const idMatch = path.match(/^\/api\/quotations\/([a-f0-9-]+)$/);
  if (idMatch) {
    const qid = idMatch[1];

    if (req.method === 'GET') {
      try {
        const payload = await requireAuth(req, env);
        if (payload.role !== 'admin') return err('Admin only', 403);
        const q = await db.select().from(quotations).where(eq(quotations.id, qid)).get();
        return q ? ok(q) : err('Not found', 404);
      } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
    }

    if (req.method === 'PATCH') {
      try {
        const payload = await requireAuth(req, env);
        if (payload.role !== 'admin') return err('Admin only', 403);

        const body = await req.json() as any;
        const current = await db.select().from(quotations).where(eq(quotations.id, qid)).get();
        if (!current) return err('Not found', 404);

        const updates: Record<string, any> = { updatedAt: nowISO() };

        if (body.status !== undefined) {
          if (!['draft', 'sent', 'accepted', 'rejected', 'expired'].includes(body.status)) {
            return err('Invalid status');
          }
          updates.status = body.status;

          if (body.status === 'accepted' && !current.convertedBookingId) {
            const bId = uuid();
            const priceTotal = parseFloat(await getSetting(db, 'price_total') || '300');
            const priceDeposit = parseFloat(await getSetting(db, 'price_deposit') || '150');
            await db.insert(bookings).values({
              id: bId,
              customerName: current.customerName,
              customerPhone: current.customerPhone,
              customerAddress: current.customerAddress,
              bookingDate: new Date().toISOString().split('T')[0],
              bookingTime: '9am',
              amount: current.amount || priceTotal,
              depositAmount: priceDeposit,
              status: 'pending_payment',
              customerId: current.customerId,
              createdAt: nowISO(),
              updatedAt: nowISO()
            });
            updates.convertedBookingId = bId;
          }
        }
        if (body.notes !== undefined) updates.notes = body.notes;
        if (body.amount !== undefined) updates.amount = body.amount;
        if (body.valid_until !== undefined) updates.validUntil = body.valid_until;

        await db.update(quotations).set(updates).where(eq(quotations.id, qid));

        const q = await db.select().from(quotations).where(eq(quotations.id, qid)).get();
        return ok(q);
      } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
    }
  }

  // GET /api/quotations/templates
  if (path === '/api/quotations/templates' && req.method === 'GET') {
    return ok(SERVICE_TEMPLATES);
  }

  // POST /api/quotations/:id/send — send to customer
  const sendMatch = path.match(/^\/api\/quotations\/([a-f0-9-]+)\/send$/);
  if (sendMatch && req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'admin') return err('Admin only', 403);
      const q = await db.select().from(quotations).where(eq(quotations.id, sendMatch[1])).get();
      if (!q) return err('Not found', 404);

      const siteUrl = env.SITE_URL || 'https://www.jayabina.com';
      const items = safeParse(q.details);
      let itemsText = items.length ? items.map((i: any) => `• ${i.description}: RM${i.amount}`).join('\n') : `Servis ${q.serviceType}`;

      const msg = `*JAYABINA — Sebut Harga*\n\n` +
        `Kepada: ${q.customerName}\nAlamat: ${q.customerAddress}\nServis: ${q.serviceType}\n\n` +
        `${itemsText}\n\nJumlah: RM${q.amount}\n\n` +
        `Sah kan: ${siteUrl}/success.html?quote=${q.id}`;

      let waSent = false, emailSent = false;

      if (env.WA_PHONE_NUMBER_ID && env.WA_ACCESS_TOKEN) {
        let digits = String(q.customerPhone).replace(/\D/g, '');
        if (digits.startsWith('0')) digits = '6' + digits;
        try {
          const wr = await fetch(`https://graph.facebook.com/v22.0/${env.WA_PHONE_NUMBER_ID}/messages`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${env.WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', to: digits, type: 'text', text: { body: msg } })
          });
          waSent = wr.ok;
        } catch {}
      }

      if (env.RESEND_API_KEY) {
        try {
          const itemsHtml = items.length ? items.map((i: any) => `<tr><td>${i.description}</td><td style="text-align:right">RM${i.amount}</td></tr>`).join('') : '';
          const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><h2 style="color:#166534">JAYABINA — Sebut Harga</h2><p>Kepada: <strong>${q.customerName}</strong></p><p>${q.customerAddress}</p><table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f0fdf4"><th style="text-align:left;padding:8px">Item</th><th style="text-align:right;padding:8px">Harga</th></tr></thead><tbody>${itemsHtml}</tbody></table><p style="text-align:right;font-size:1.2em"><strong>Jumlah: RM${q.amount}</strong></p><p style="color:#666">Sah dalam 7 hari. Terima kasih!</p></div>`;
          await fetch('https://api.resend.com/emails', {
            method: 'POST', headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: 'JAYABINA <noreply@jayabina.com>', to: [q.customerPhone + '@jayabina.local'], subject: 'Sebut Harga — JAYABINA', html })
          });
          emailSent = true;
        } catch {}
      }

      await db.update(quotations).set({ status: 'sent', updatedAt: nowISO() }).where(eq(quotations.id, q.id));
      return ok({ sent: true, wa: waSent, email: emailSent });
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // GET /api/quotations/:id/pdf — generate PDF/HTML
  const pdfMatch = path.match(/^\/api\/quotations\/([a-f0-9-]+)\/pdf$/);
  if (pdfMatch && req.method === 'GET') {
    try {
      const q = await db.select().from(quotations).where(eq(quotations.id, pdfMatch[1])).get();
      if (!q) return err('Not found', 404);

      const items = safeParse(q.details);
      const itemsHtml = items.length ? items.map((i: any) => `<tr><td style="padding:10px;border-bottom:1px solid #ddd">${escapeHtml(i.description)}</td><td style="padding:10px;border-bottom:1px solid #ddd;text-align:right">RM${i.amount}</td></tr>`).join('') :
        `<tr><td style="padding:10px">${escapeHtml(q.serviceType)}</td><td style="padding:10px;text-align:right">RM${q.amount}</td></tr>`;

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sebut Harga — JAYABINA</title>
<style>body{font-family:Arial,sans-serif;max-width:700px;margin:40px auto;padding:20px;color:#333}
h1{color:#166534;font-size:24px;border-bottom:3px solid #166534;padding-bottom:8px}
table{width:100%;border-collapse:collapse;margin:20px 0}
th{background:#f0fdf4;padding:10px;text-align:left}
.total{text-align:right;font-size:20px;font-weight:bold;margin-top:16px;padding:16px;background:#f0fdf4;border-radius:8px}
.footer{margin-top:40px;font-size:12px;color:#999;border-top:1px solid #eee;padding-top:16px}
</style></head><body>
<h1>JAYABINA — Sebut Harga</h1>
<p><strong>Kepada:</strong> ${escapeHtml(q.customerName)}</p>
<p><strong>Alamat:</strong> ${escapeHtml(q.customerAddress)}</p>
<p><strong>Telefon:</strong> ${escapeHtml(q.customerPhone)}</p>
<p><strong>Tarikh:</strong> ${new Date().toLocaleDateString('ms-MY')}</p>
<p><strong>Sah Sehingga:</strong> ${q.validUntil ? new Date(q.validUntil).toLocaleDateString('ms-MY') : '7 hari'}</p>
<table><thead><tr><th>Perkara</th><th style="text-align:right">Harga (RM)</th></tr></thead><tbody>${itemsHtml}</tbody></table>
<div class="total">Jumlah: RM${q.amount}</div>
<p><strong>Syarat:</strong> Deposit RM${parseFloat(await getSetting(db, 'price_deposit') || '150')} untuk sahkan tempahan.</p>
<p>Harga tertakluk kepada perubahan selepas tempoh sah laku. Semua harga dalam Ringgit Malaysia (RM).</p>
<div class="footer">Jaya Bina Services · No. Pendaftaran: JR0188646-T · www.jayabina.com · banktifweb1@gmail.com</div>
</body></html>`;

      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  return err('Not found', 404);
}

async function getSetting(db: AppDb, key: string): Promise<string> {
  const row = await db.select({ value: appSettingsTbl.value }).from(appSettingsTbl)
    .where(eq(appSettingsTbl.key, key)).get();
  return row?.value || '';
}

function safeParse(raw: any): any[] {
  try { const v = JSON.parse(typeof raw === 'string' ? raw : '{}'); return Array.isArray(v) ? v : []; } catch { return []; }
}

function escapeHtml(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
