import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
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
import { handleWebsite } from './routes/website';
import { createDb } from './db/client';
import { bookings as bookingsTable } from './db/schema';

const app = new Hono<{ Bindings: Env }>({ strict: false });

app.onError((error) => {
  console.error('Unhandled error:', error);
  return err(error.message || 'Internal server error', 500);
});

app.all('/api/health', async (c) => {
  if (c.req.raw.method !== 'GET') return err('Not found', 404);
  await createDb(c.env).get(sql`SELECT 1`);
  return ok({ service: 'jayaclean-api', database: 'ok' });
});

const handleSettingsRoute = (req: Request, env: Env) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
  return handleSettings(req, env, path);
};
app.all('/api/settings', (c) => handleSettingsRoute(c.req.raw, c.env));
app.all('/api/settings/*', (c) => handleSettingsRoute(c.req.raw, c.env));

const handleSlotsRoute = (req: Request, env: Env) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
  return handleSlots(req, env, path);
};
app.all('/api/slots/*', (c) => handleSlotsRoute(c.req.raw, c.env));

const handleAuthRoute = (req: Request, env: Env) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
  return handleAuth(req, env, path);
};
app.all('/api/auth', (c) => handleAuthRoute(c.req.raw, c.env));
app.all('/api/auth/*', (c) => handleAuthRoute(c.req.raw, c.env));

const handleProfilesRoute = (req: Request, env: Env) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
  return handleProfiles(req, env, path);
};
app.all('/api/profiles', (c) => handleProfilesRoute(c.req.raw, c.env));
app.all('/api/profiles/*', (c) => handleProfilesRoute(c.req.raw, c.env));

const handleCustomersRoute = (req: Request, env: Env) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
  return handleCustomers(req, env, path);
};
app.all('/api/customers', (c) => handleCustomersRoute(c.req.raw, c.env));
app.all('/api/customers/*', (c) => handleCustomersRoute(c.req.raw, c.env));

const handleWhatsappRoute = (req: Request, env: Env) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
  return handleWhatsapp(req, env, path);
};
app.all('/api/whatsapp', (c) => handleWhatsappRoute(c.req.raw, c.env));
app.all('/api/whatsapp/*', (c) => handleWhatsappRoute(c.req.raw, c.env));

app.all('/api/tasks/distribute', (c) => handleDistributeUnassigned(c.req.raw, c.env));
const handleTasksRoute = (req: Request, env: Env) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
  return handleTasks(req, env, path);
};
app.all('/api/tasks', (c) => handleTasksRoute(c.req.raw, c.env));
app.all('/api/tasks/*', (c) => handleTasksRoute(c.req.raw, c.env));

const handleTaskPhotosRoute = (req: Request, env: Env) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
  return handleTaskPhotos(req, env, path);
};
app.all('/api/task-photos', (c) => handleTaskPhotosRoute(c.req.raw, c.env));
app.all('/api/task-photos/*', (c) => handleTaskPhotosRoute(c.req.raw, c.env));

const handleBookingsRoute = (req: Request, env: Env) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
  return handleBookings(req, env, path);
};
app.all('/api/bookings', (c) => handleBookingsRoute(c.req.raw, c.env));
app.all('/api/bookings/*', (c) => handleBookingsRoute(c.req.raw, c.env));
app.all('/api/payments/create-intent', (c) => handleCreateIntent(c.req.raw, c.env));
app.all('/api/payments/create-balance-intent', (c) => handleCreateBalanceIntent(c.req.raw, c.env));
app.all('/api/payments/bayarcash-callback', (c) => handleBayarcashCallback(c.req.raw, c.env));

const handleBackupRoute = (req: Request, env: Env) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
  return handleBackup(req, env, path);
};
app.all('/api/backup', (c) => handleBackupRoute(c.req.raw, c.env));
app.all('/api/backup/*', (c) => handleBackupRoute(c.req.raw, c.env));

const handleWebsiteRoute = (req: Request, env: Env) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
  return handleWebsite(req, env, path);
};
app.all('/api/website', (c) => handleWebsiteRoute(c.req.raw, c.env));
app.all('/api/website/*', (c) => handleWebsiteRoute(c.req.raw, c.env));

app.notFound(() => err('Not found', 404));

const worker = {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const cors = handleCors(req);
    if (cors) return cors;

    try {
      return await app.fetch(req, env, ctx);
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

export { app };
export default worker;

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

  const booking = await createDb(env).select({
    id: bookingsTable.id,
    customer_name: bookingsTable.customerName,
    customer_phone: bookingsTable.customerPhone,
    deposit_amount: bookingsTable.depositAmount,
    amount: bookingsTable.amount
  }).from(bookingsTable).where(eq(bookingsTable.id, booking_id)).get();
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
