import { eq } from 'drizzle-orm';
import type { Env } from '../types';
import { err, ok, nowISO } from '../utils/helpers';
import { requireAuth } from '../utils/middleware';
import { createDb } from '../db/client';
import { bookings } from '../db/schema';

// POST /api/payments/refund — admin-initiated refund
export async function handleRefund(req: Request, env: Env): Promise<Response> {
  try {
    const payload = await requireAuth(req, env);
    if (payload.role !== 'admin') return err('Admin only', 403);

    const { booking_id, reason } = await req.json() as any;
    if (!booking_id) return err('Missing booking_id');

    const db = createDb(env);
    const booking = await db.select({
      id: bookings.id, bayarcash_transaction_id: bookings.bayarcashTransactionId,
      payment_status: bookings.paymentStatus, deposit_amount: bookings.depositAmount,
      amount: bookings.amount
    }).from(bookings).where(eq(bookings.id, booking_id)).get();

    if (!booking) return err('Booking not found', 404);
    if (booking.payment_status !== 'paid') return err('Only paid bookings can be refunded', 409);

    if (!env.BAYARCASH_PAT) return err('Payment gateway not configured', 503);

    const refundAmount = booking.deposit_amount || booking.amount || 150;

    // Attempt Bayarcash refund
    try {
      const resp = await fetch('https://api.console.bayar.cash/v3/refunds', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.BAYARCASH_PAT}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          transaction_id: booking.bayarcash_transaction_id,
          amount: refundAmount.toFixed(2),
          reason: reason || 'Customer cancellation'
        })
      });

      const data = await resp.json() as any;
      if (resp.ok) {
        await db.update(bookings).set({
          paymentStatus: 'refunded', status: 'cancelled', updatedAt: nowISO()
        }).where(eq(bookings.id, booking_id));

        return ok({ refunded: true, transaction_id: data.transaction_id || data.id, amount: refundAmount });
      }
      return err(data?.message || 'Refund failed via gateway', 502);
    } catch (e: any) {
      // Manual refund fallback
      await db.update(bookings).set({
        paymentStatus: 'refunded', status: 'cancelled',
        notes: `Manual refund required: ${reason || 'Cancellation'} — RM${refundAmount}`,
        updatedAt: nowISO()
      }).where(eq(bookings.id, booking_id));

      return ok({ refunded: false, manual_required: true, amount: refundAmount, message: 'Gateway unavailable. Manual refund required.' });
    }
  } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
}
