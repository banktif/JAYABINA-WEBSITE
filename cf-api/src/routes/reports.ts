import { eq, sql, and } from 'drizzle-orm';
import type { Env } from '../types';
import { err, ok } from '../utils/helpers';
import { requireAuth } from '../utils/middleware';
import { createDb } from '../db/client';
import { bookings, invoices, quotations, receipts } from '../db/schema';

export async function handleChain(req: Request, env: Env, path: string): Promise<Response> {
  const db = createDb(env);

  // GET /api/chain/:bookingId — full document traceability
  const chainMatch = path.match(/^\/api\/chain\/([a-f0-9-]+)$/);
  if (chainMatch && req.method === 'GET') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'admin') return err('Admin only', 403);
      const bid = chainMatch[1];

      const booking = await db.select().from(bookings).where(eq(bookings.id, bid)).get();
      if (!booking) return err('Booking not found', 404);

      // Find quotation that converted to this booking
      const quote = await db.select().from(quotations)
        .where(eq(quotations.convertedBookingId, bid)).get();

      // Find invoice for this booking
      const invoice = await db.select().from(invoices)
        .where(eq(invoices.bookingId, bid)).get();

      // Find all receipts
      const rcpts = await db.select().from(receipts)
        .where(eq(receipts.bookingId, bid))
        .orderBy(sql`${receipts.createdAt} ASC`).all();

      return ok({
        booking,
        quotation: quote || null,
        invoice: invoice || null,
        receipts: rcpts
      });
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  return err('Not found', 404);
}

export async function handleReports(req: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(req.url);
  const db = createDb(env);

  // GET /api/reports/pnl?from=YYYY-MM-DD&to=YYYY-MM-DD
  if (path === '/api/reports/pnl' && req.method === 'GET') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'admin') return err('Admin only', 403);

      const from = url.searchParams.get('from') || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
      const to = url.searchParams.get('to') || new Date().toISOString().split('T')[0];

      const allInvoices = await db.select().from(invoices)
        .where(sql`date(${invoices.createdAt}) >= '${from}' AND date(${invoices.createdAt}) <= '${to}'`)
        .orderBy(sql`${invoices.createdAt} DESC`).all();

      const allReceipts = await db.select().from(receipts)
        .where(sql`date(${receipts.createdAt}) >= '${from}' AND date(${receipts.createdAt}) <= '${to}'`)
        .orderBy(sql`${receipts.createdAt} DESC`).all();

      const totalInvoiced = allInvoices.reduce((s, inv) => s + (inv.subtotal || 0), 0);
      const totalCollected = allReceipts.reduce((s, r) => s + (r.amount || 0), 0);
      const outstanding = totalInvoiced - totalCollected;
      const paidCount = allInvoices.filter(i => i.status === 'paid').length;
      const pendingCount = allInvoices.filter(i => i.status === 'pending').length;

      const byService: Record<string, { count: number; amount: number }> = {};
      allInvoices.forEach(inv => {
        const items = safeParse(inv.items);
        const servItems = items.filter((i: any) => !(i.description || '').includes('Deposit') && !(i.description || '').startsWith('SST '));
        servItems.forEach((i: any) => {
          const key = i.description || 'Servis';
          if (!byService[key]) byService[key] = { count: 0, amount: 0 };
          byService[key].count++;
          byService[key].amount += i.amount;
        });
      });

      const byPayment: Record<string, { count: number; amount: number }> = {};
      allReceipts.forEach(r => {
        const key = r.paymentMethod || r.paymentType;
        if (!byPayment[key]) byPayment[key] = { count: 0, amount: 0 };
        byPayment[key].count++;
        byPayment[key].amount += r.amount;
      });

      return ok({
        period: { from, to },
        summary: {
          total_invoiced: totalInvoiced,
          total_collected: totalCollected,
          outstanding,
          invoice_count: allInvoices.length,
          paid_count: paidCount,
          pending_count: pendingCount
        },
        by_service: byService,
        by_payment_method: byPayment,
        invoices: allInvoices,
        receipts: allReceipts
      });
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // GET /api/reports/export?from=YYYY-MM-DD&to=YYYY-MM-DD — CSV export
  if (path === '/api/reports/export' && req.method === 'GET') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'admin') return err('Admin only', 403);

      const from = url.searchParams.get('from') || '2026-01-01';
      const to = url.searchParams.get('to') || new Date().toISOString().split('T')[0];

      const allInvoices = await db.select().from(invoices)
        .where(sql`date(${invoices.createdAt}) >= '${from}' AND date(${invoices.createdAt}) <= '${to}'`)
        .orderBy(sql`${invoices.createdAt} DESC`).all();

      let csv = 'Invoice No,Customer Name,Customer Phone,Date,Subtotal (RM),Tax (RM),Deposit (RM),Balance (RM),Status\n';
      allInvoices.forEach(inv => {
        csv += `"${inv.number}","${(inv.customerName || '').replace(/"/g, '""')}","${inv.customerPhone}","${(inv.createdAt || '').split('T')[0]}",${inv.subtotal || 0},${inv.taxAmount || 0},${inv.depositPaid || 0},${inv.balanceDue || 0},${inv.status}\n`;
      });

      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="jayabina-invoices-${from}-${to}.csv"`
        }
      });
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  return err('Not found', 404);
}

function safeParse(raw: any): any[] {
  try { const v = JSON.parse(typeof raw === 'string' ? raw : '{}'); return Array.isArray(v) ? v : []; } catch { return []; }
}
