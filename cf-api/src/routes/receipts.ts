import { and, eq, like, or, sql } from 'drizzle-orm';
import type { Env } from '../types';
import { err, ok, nowISO } from '../utils/helpers';
import { requireAuth } from '../utils/middleware';
import { createDb, type AppDb } from '../db/client';
import { appSettings as appSettingsTbl, receipts } from '../db/schema';

export async function handleReceipts(req: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(req.url);
  const db = createDb(env);

  // GET /api/receipts/customer?phone=XXX — customer view receipts
  if (path === '/api/receipts/customer' && req.method === 'GET') {
    try {
      const phone = url.searchParams.get('phone') || '';
      if (!phone) return err('Missing phone parameter');
      const rows = await db.select().from(receipts)
        .where(eq(receipts.customerPhone, phone))
        .orderBy(sql`${receipts.createdAt} DESC`).all();
      return ok(rows);
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // GET /api/receipts/:id/pdf — generate receipt PDF-style HTML
  const pdfMatch = path.match(/^\/api\/receipts\/([a-f0-9-]+)\/pdf$/);
  if (pdfMatch && req.method === 'GET') {
    try {
      const r = await db.select().from(receipts).where(eq(receipts.id, pdfMatch[1])).get();
      if (!r) return htmlPage('Not Found', '<h1 style="text-align:center;margin-top:80px">Resit tidak dijumpai.</h1>');

      const paymentTypeLabel: Record<string, string> = { deposit: 'Deposit', balance: 'Baki', full: 'Bayaran Penuh' };
      const methodLabel: Record<string, string> = { duitnow: 'DuitNow', fpx: 'FPX', cash: 'Tunai', transfer: 'Pemindahan Bank' };

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Resit ${escapeHtml(r.number)} — JAYABINA</title>
<style>body{font-family:Arial,sans-serif;max-width:700px;margin:40px auto;padding:20px;color:#333}
h1{color:#166534;font-size:24px;border-bottom:3px solid #166534;padding-bottom:8px}
.rcp-no{font-size:18px;font-weight:700;color:#444;margin-bottom:20px}
.amount{font-size:36px;font-weight:900;color:#166534;text-align:center;margin:24px 0;padding:24px;background:#f0fdf4;border-radius:12px}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:20px 0}
.info-box{padding:12px;background:#f8faf9;border-radius:8px}
.info-box dt{font-size:.75rem;color:#888;text-transform:uppercase;margin-bottom:4px}
.info-box dd{font-size:1rem;font-weight:600;margin:0}
.footer{margin-top:40px;font-size:12px;color:#999;border-top:1px solid #eee;padding-top:16px}
@media print{body{margin:0;padding:10mm}@page{margin:10mm}}</style></head><body>
<h1>JAYABINA — Resit Rasmi</h1>
<div class="rcp-no">${escapeHtml(r.number)}</div>
<div class="amount">RM${r.amount}</div>
<dl class="info-grid">
  <div class="info-box"><dt>Kepada</dt><dd>${escapeHtml(r.customerName)}</dd></div>
  <div class="info-box"><dt>Telefon</dt><dd>${escapeHtml(r.customerPhone)}</dd></div>
  <div class="info-box"><dt>Jenis Bayaran</dt><dd>${paymentTypeLabel[r.paymentType] || r.paymentType}</dd></div>
  <div class="info-box"><dt>Kaedah</dt><dd>${methodLabel[r.paymentMethod || ''] || r.paymentMethod || '-'}</dd></div>
  <div class="info-box"><dt>Tarikh</dt><dd>${new Date(r.createdAt).toLocaleDateString('ms-MY')}</dd></div>
  <div class="info-box"><dt>Rujukan</dt><dd style="font-size:.78rem;word-break:break-all">${escapeHtml(r.transactionRef || r.bookingId?.substring(0,8) || '-')}</dd></div>
</dl>
<p style="text-align:center;font-size:.85rem;color:#666;margin-top:24px">Ini adalah resit yang dijana secara elektronik dan sah tanpa tandatangan.</p>
<div class="footer">Jaya Bina Services · No. Pendaftaran: JR0188646-T · www.jayabina.com</div>
</body></html>`;

      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // GET /api/receipts - list
  if (path === '/api/receipts' && req.method === 'GET') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'admin') return err('Admin only', 403);

      const paymentType = url.searchParams.get('payment_type');
      const query = url.searchParams.get('q') || '';
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
      const offset = parseInt(url.searchParams.get('offset') || '0');

      let conditions = [];
      if (paymentType) conditions.push(eq(receipts.paymentType, paymentType));
      if (query) {
        conditions.push(or(
          like(receipts.customerName, `%${query}%`),
          like(receipts.customerPhone, `%${query}%`),
          like(receipts.number, `%${query}%`)
        ) as any);
      }

      const rows = await db.select().from(receipts)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(sql`${receipts.createdAt} DESC`)
        .limit(limit).offset(offset).all();

      return ok(rows);
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // GET /api/receipts/:id
  const idMatch = path.match(/^\/api\/receipts\/([a-f0-9-]+)$/);
  if (idMatch && req.method === 'GET') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'admin') return err('Admin only', 403);
      const r = await db.select().from(receipts).where(eq(receipts.id, idMatch[1])).get();
      return r ? ok(r) : err('Not found', 404);
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // PATCH /api/receipts/:id
  if (idMatch && req.method === 'PATCH') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'admin') return err('Admin only', 403);

      const body = await req.json() as any;
      const current = await db.select().from(receipts).where(eq(receipts.id, idMatch[1])).get();
      if (!current) return err('Not found', 404);

      const updates: Record<string, any> = {};
      if (body.wa_sent_at !== undefined) updates.waSentAt = body.wa_sent_at;
      if (body.email_sent_at !== undefined) updates.emailSentAt = body.email_sent_at;

      if (Object.keys(updates).length > 0) {
        await db.update(receipts).set(updates).where(eq(receipts.id, idMatch[1]));
      }

      const r = await db.select().from(receipts).where(eq(receipts.id, idMatch[1])).get();
      return ok(r);
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  return err('Not found', 404);
}

function escapeHtml(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function htmlPage(title: string, body: string): Response {
  return new Response(`<!DOCTYPE html><html lang="ms"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — JAYABINA</title><style>body{font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:24px;color:#333;background:#f8faf9}</style></head><body>${body}</body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
