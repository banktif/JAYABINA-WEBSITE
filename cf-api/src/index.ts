import type { Env } from './types';
import { json, err, ok } from './utils/helpers';
import { handleCors, requireAuth, requireAdmin } from './utils/middleware';
import { handleAuth } from './routes/auth';
import { handleBookings, handleCreateIntent, handleBayarcashCallback, handleDistributeUnassigned } from './routes/bookings';
import { handleTasks, handleTaskPhotos } from './routes/tasks';
import { handleProfiles } from './routes/profiles';
import { handleSettings } from './routes/settings';
import { handleCustomers } from './routes/customers';
import { handleSlots } from './routes/slots';
import { handleWhatsapp } from './routes/whatsapp';
import { handleBackup } from './routes/backup';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = handleCors(req);
    if (cors) return cors;

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // Routes
    try {
      if (path === '/api/health' && req.method === 'GET') {
        await env.DB.prepare('SELECT 1').first();
        return ok({ service: 'jayaclean-api', database: 'ok' });
      }

      // Auth
      if (path.startsWith('/api/auth')) return await handleAuth(req, env, path);
      if (path.startsWith('/api/settings')) return await handleSettings(req, env, path);

      // Public endpoints
      if (path === '/api/bookings/public') return await handleBookings(req, env, path);
      if (path === '/api/slots/available' || path === '/api/slots/check') return await handleSlots(req, env, path);
      if (path === '/api/settings/public') return await handleSettings(req, env, path);

      // Bookings
      if (path.startsWith('/api/bookings')) return await handleBookings(req, env, path);

      // Payment
      if (path === '/api/payments/create-intent') return await handleCreateIntent(req, env);
      if (path === '/api/payments/create-balance-intent') return await handleCreateBalanceIntent(req, env);
      if (path === '/api/payments/bayarcash-callback') return await handleBayarcashCallback(req, env);

      // Tasks
      if (path.startsWith('/api/tasks/distribute')) return await handleDistributeUnassigned(req, env);
      if (path.startsWith('/api/tasks')) return await handleTasks(req, env, path);
      if (path.startsWith('/api/task-photos')) return await handleTaskPhotos(req, env, path);

      // Profiles
      if (path.startsWith('/api/profiles')) return await handleProfiles(req, env, path);

      // Customers
      if (path.startsWith('/api/customers')) return await handleCustomers(req, env, path);

      // WhatsApp
      if (path.startsWith('/api/whatsapp')) return await handleWhatsapp(req, env, path);

      // Backup
      if (path.startsWith('/api/backup')) return await handleBackup(req, env, path);

      return err('Not found', 404);
    } catch (e: any) {
      console.error('Unhandled error:', e);
      return err(e.message || 'Internal server error', 500);
    }
  },

  // Cron trigger (runs hourly via wrangler.toml cron)
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Auto backup
    if (env.BACKUP_R2 && env.BACKUP_SECRET) {
      const handlers = await import('./routes/backup');
      const fakeReq = new Request('https://internal/api/backup/db', {
        method: 'POST',
        headers: { 'x-backup-key': env.BACKUP_SECRET, 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false })
      });
      ctx.waitUntil(handlers.handleBackup(fakeReq, env, '/api/backup/db'));
    }

  }
};

async function handleCreateBalanceIntent(req: Request, env: Env): Promise<Response> {
  try {
    const payload = await requireAuth(req, env);
    requireAdmin(payload);
  } catch (e: any) {
    return err(e.msg || 'Unauthorized', e.status || 401);
  }
  const { booking_id } = await req.json() as any;
  if (!booking_id) return err('Missing booking_id');

  if (!env.BAYARCASH_PAT || !env.BAYARCASH_PORTAL_KEY) return err('Payment gateway not configured', 500);

  const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(booking_id).first<{
    id: string; customer_name: string; customer_phone: string; deposit_amount: number; amount: number;
  }>();
  if (!booking) return err('Booking not found', 404);

  const balanceAmount = booking.amount - booking.deposit_amount;
  if (balanceAmount <= 0) return err('No balance due');

  const orderRef = `BB${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2,6).toUpperCase()}`.substring(0, 30);

  const siteUrl = (env.SITE_URL || 'https://cuci.jayabina.com').replace(/\/$/, '');
  const amount = Number(balanceAmount).toFixed(2);
  const payerName = String(booking.customer_name || 'Pelanggan').slice(0, 100);
  const payerEmail = `${booking.id.slice(0, 8)}@jayabina.local`;
  const phone = malaysiaPhone(booking.customer_phone || '');
  const channel = parseInt(env.BAYARCASH_PAYMENT_CHANNEL || '5', 10);
  const body: Record<string, unknown> = {
    payment_channel: channel,
    portal_key: env.BAYARCASH_PORTAL_KEY,
    order_number: orderRef,
    amount,
    payer_name: payerName,
    payer_email: payerEmail,
    return_url: `${siteUrl}/success.html?order=${booking_id}&type=balance`,
    callback_url: `${new URL(req.url).origin}/api/payments/bayarcash-callback`
  };
  if (phone) body.payer_telephone_number = phone;
  if (env.BAYARCASH_API_SECRET) {
    body.checksum = await hmacSha256Hex(ksortJoin({
      amount,
      order_number: orderRef,
      payer_email: payerEmail,
      payer_name: payerName,
      payment_channel: channel
    }), env.BAYARCASH_API_SECRET);
  }

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${env.BAYARCASH_PAT}`,
    'Content-Type': 'application/json'
  };

  const resp = await fetch('https://api.console.bayar.cash/v3/payment-intents', {
    method: 'POST', headers, body: JSON.stringify(body)
  });
  const text = await resp.text();
  let data: any;
  try { data = JSON.parse(text); } catch { return err('Payment gateway returned an invalid response', 502); }
  if (!resp.ok || !data.url) return err(data.message || 'Payment creation failed', 502);
  return json({ url: data.url, id: data.id || null });
}

function ksortJoin(data: Record<string, unknown>): string {
  return Object.keys(data).sort().map(k => {
    const value = data[k];
    return value === null || value === undefined ? '' : String(value);
  }).join('|');
}

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function malaysiaPhone(raw: string): string {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `6${digits}`;
  else if (digits && !digits.startsWith('60')) digits = `60${digits}`;
  return digits;
}
