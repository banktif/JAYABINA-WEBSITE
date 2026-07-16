import type { Env } from '../types';
import { json, err, ok, uuid, nowISO, normPhone, todayStr } from '../utils/helpers';
import { requireAuth, requireAdmin, getSetting } from '../utils/middleware';

export async function handleBookings(req: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(req.url);

  // GET /api/bookings - list bookings (auth + anon)
  if (path === '/api/bookings' && req.method === 'GET') {
    try {
      const customerPhone = url.searchParams.get('customer_phone');
      let payload: any = null;
      try { payload = await requireAuth(req, env); } catch {}

      // Anon access: only allowed with customer_phone filter
      if (!payload && !customerPhone) return err('Auth required', 401);

      const dateFilter = url.searchParams.get('date');
      const statusFilter = url.searchParams.get('status');
      const customerId = url.searchParams.get('customer_id');
      const idsParam = url.searchParams.get('ids');
      const orderCol = url.searchParams.get('order') || 'booking_date';
      const orderDir = url.searchParams.get('dir') || 'asc';

      let q = 'SELECT * FROM bookings';
      const conds: string[] = [];
      const params: any[] = [];

      if (payload && payload.role === 'staff') {
        conds.push('id IN (SELECT booking_id FROM tasks WHERE assigned_to = ?)');
        params.push(payload.sub);
      }

      // Anon: must have customer_phone filter
      if (!payload && customerPhone) {
        conds.push('customer_phone = ?');
        params.push(normPhone(customerPhone));
      }

      if (payload) {
        if (customerPhone) { conds.push('customer_phone = ?'); params.push(normPhone(customerPhone)); }
        if (dateFilter) { conds.push('booking_date = ?'); params.push(dateFilter); }
        if (statusFilter) { conds.push('status = ?'); params.push(statusFilter); }
        if (customerId) { conds.push('customer_id = ?'); params.push(customerId); }
        if (idsParam) {
          const idList = idsParam.split(',').map((s: string) => s.trim()).filter(Boolean);
          if (idList.length) {
            conds.push(`id IN (${idList.map(() => '?').join(',')})`);
            params.push(...idList);
          }
        }
      }

      if (conds.length) q += ' WHERE ' + conds.join(' AND ');

      const safeCols = ['booking_date', 'created_at', 'booking_time', 'customer_name', 'status', 'payment_status'];
      const col = safeCols.includes(orderCol) ? orderCol : 'booking_date';
      const dir = orderDir === 'desc' ? 'DESC' : 'ASC';
      q += ` ORDER BY ${col} ${dir}`;

      const result = await env.DB.prepare(q).bind(...params).all();
      return ok(result.results);
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  // GET /api/bookings/public - anon read single booking
  if (path === '/api/bookings/public' && req.method === 'GET') {
    const id = url.searchParams.get('id');
    if (!id) return err('Missing id');
    const row = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(id).first();
    return row ? ok(row) : err('Not found', 404);
  }

  // POST /api/bookings - public booking creation
  if (path === '/api/bookings' && req.method === 'POST') {
    const body = await req.json() as any;
    const { customer_name, customer_phone, customer_address, booking_date, booking_time } = body;

    if (!customer_name || !customer_phone || !customer_address || !booking_date || !booking_time) {
      return err('Missing required fields: customer_name, customer_phone, customer_address, booking_date, booking_time');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(booking_date)) || String(booking_date) < malaysiaDateKey()) {
      return err('Booking date must be today or later');
    }

    const maxSlots = parseInt(await getSetting(env.DB, 'max_slots_per_day') || '4');
    const allowedSlots = (await getSetting(env.DB, 'slots') || '9am,11am,2pm,4pm')
      .split(',').map(s => s.trim()).filter(Boolean);
    if (!allowedSlots.includes(booking_time)) return err('Invalid booking time');

    const existing = await env.DB.prepare('SELECT COUNT(*) as cnt FROM slots WHERE date = ? AND is_booked = 1')
      .bind(booking_date).first<{cnt: number}>();
    if (existing && existing.cnt >= maxSlots) return err('No slots available for this date', 409);
    const existingSlot = await env.DB.prepare('SELECT id FROM slots WHERE date = ? AND time_slot = ? AND is_booked = 1')
      .bind(booking_date, booking_time).first();
    if (existingSlot) return err('This time slot is already booked', 409);

    const priceTotal = parseFloat(await getSetting(env.DB, 'price_total') || '300');
    const priceDeposit = parseFloat(await getSetting(env.DB, 'price_deposit') || '150');

    const bookingId = uuid();
    const slotId = uuid();
    const now = nowISO();

    const phoneDigits = normPhone(customer_phone);

    // Find or create customer
    let cust = await env.DB.prepare('SELECT id FROM customers WHERE phone = ?').bind(phoneDigits).first<{id: string}>();
    if (!cust) {
      const custId = uuid();
      await env.DB.prepare(`INSERT INTO customers (id, phone, name, address) VALUES (?, ?, ?, ?)`)
        .bind(custId, phoneDigits, customer_name, customer_address).run();
      cust = { id: custId };
    } else {
      await env.DB.prepare('UPDATE customers SET name = CASE WHEN ? != \'\' THEN ? ELSE name END, address = CASE WHEN ? != \'\' THEN ? ELSE address END WHERE id = ?')
        .bind(customer_name, customer_name, customer_address, customer_address, cust.id).run();
    }

    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO bookings (id, customer_name, customer_phone, customer_address, booking_date, booking_time, amount, deposit_amount, customer_id, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(bookingId, customer_name, phoneDigits, customer_address, booking_date, booking_time, priceTotal, priceDeposit, cust.id, now, now),
        env.DB.prepare('INSERT INTO slots (id, date, time_slot, is_booked, booking_id) VALUES (?,?,?,1,?)')
          .bind(slotId, booking_date, booking_time, bookingId)
      ]);
    } catch (e: any) {
      if (String(e?.message || e).includes('UNIQUE constraint')) return err('This time slot is already booked', 409);
      throw e;
    }

    // Update customer stats
    await refreshCustomerStats(env.DB, cust.id);

    const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
    return ok(booking);
  }

  // PATCH /api/bookings/:id - update booking
  const patchMatch = path.match(/^\/api\/bookings\/([a-f0-9-]+)$/);
  if (patchMatch && req.method === 'PATCH') {
    try {
      const payload = await requireAuth(req, env);
      const bookingId = patchMatch[1];
      const body = await req.json() as any;
      const now = nowISO();
      const current = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first<any>();
      if (!current) return err('Booking not found', 404);

      // Check access
      if (payload.role !== 'admin') {
        const hasAccess = await env.DB.prepare('SELECT 1 FROM tasks WHERE booking_id = ? AND assigned_to = ?')
          .bind(bookingId, payload.sub).first();
        if (!hasAccess) return err('Access denied', 403);
      }

      if (body.status !== undefined && !['pending_payment', 'confirmed', 'completed', 'cancelled'].includes(body.status)) {
        return err('Invalid booking status');
      }
      if (current.status === 'completed' && body.status === 'cancelled') {
        return err('A completed booking cannot be cancelled', 409);
      }
      if (body.payment_status !== undefined && !['pending', 'paid', 'failed', 'refunded'].includes(body.payment_status)) {
        return err('Invalid payment status');
      }
      const nextDate = body.booking_date !== undefined ? String(body.booking_date) : current.booking_date;
      const nextTime = body.booking_time !== undefined ? String(body.booking_time) : current.booking_time;
      if (body.booking_date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate) || nextDate < malaysiaDateKey())) {
        return err('Booking date must be today or later');
      }
      if (body.booking_time !== undefined) {
        const allowedSlots = (await getSetting(env.DB, 'slots') || '9am,11am,2pm,4pm').split(',').map(s => s.trim()).filter(Boolean);
        if (!allowedSlots.includes(nextTime)) return err('Invalid booking time');
      }
      if (body.booking_date !== undefined || body.booking_time !== undefined || body.status === 'confirmed') {
        const conflict = await env.DB.prepare('SELECT booking_id FROM slots WHERE date = ? AND time_slot = ? AND is_booked = 1 AND booking_id <> ?')
          .bind(nextDate, nextTime, bookingId).first();
        if (conflict) return err('This time slot is already booked', 409);
      }

      const sets: string[] = ['updated_at = ?'];
      const params: any[] = [now];

      if (body.status !== undefined) {
        sets.push('status = ?'); params.push(body.status);
        // Trigger: on confirmed, create task if none
        if (body.status === 'confirmed') {
          const existingTask = await env.DB.prepare('SELECT id, assigned_to, status FROM tasks WHERE booking_id = ?').bind(bookingId).first<any>();
          if (!existingTask) {
            const taskId = uuid();
            await env.DB.prepare('INSERT INTO tasks (id, booking_id, status) VALUES (?, ?, ?)')
              .bind(taskId, bookingId, 'unassigned').run();

            // Auto-assign if enabled
            const autoEnabled = await getSetting(env.DB, 'auto_assign_enabled');
            if (autoEnabled === 'true') {
              await autoAssignTask(env.DB, taskId);
            }
          } else if (existingTask.status === 'cancelled') {
            await env.DB.prepare('UPDATE tasks SET status = ?, completed_at = NULL, updated_at = ? WHERE id = ?')
              .bind(existingTask.assigned_to ? 'assigned' : 'unassigned', now, existingTask.id).run();
          }
        }
      }

      if (body.payment_status !== undefined) { sets.push('payment_status = ?'); params.push(body.payment_status); }
      if (body.customer_name !== undefined) { sets.push('customer_name = ?'); params.push(body.customer_name); }
      if (body.customer_phone !== undefined) { sets.push('customer_phone = ?'); params.push(normPhone(body.customer_phone)); }
      if (body.customer_address !== undefined) { sets.push('customer_address = ?'); params.push(body.customer_address); }
      if (body.notes !== undefined) { sets.push('notes = ?'); params.push(body.notes); }
      if (body.booking_date !== undefined) { sets.push('booking_date = ?'); params.push(body.booking_date); }
      if (body.booking_time !== undefined) { sets.push('booking_time = ?'); params.push(body.booking_time); }

      params.push(bookingId);
      await env.DB.prepare(`UPDATE bookings SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();

      if (body.booking_date !== undefined || body.booking_time !== undefined) {
        const slot = await env.DB.prepare('SELECT id FROM slots WHERE booking_id = ?').bind(bookingId).first<{id: string}>();
        if (slot) {
          await env.DB.prepare('UPDATE slots SET date = ?, time_slot = ? WHERE booking_id = ?').bind(nextDate, nextTime, bookingId).run();
        } else {
          await env.DB.prepare('INSERT INTO slots (id, date, time_slot, is_booked, booking_id) VALUES (?,?,?,?,?)')
            .bind(uuid(), nextDate, nextTime, body.status === 'cancelled' || current.status === 'cancelled' ? 0 : 1, bookingId).run();
        }
      }
      if (body.status === 'cancelled') {
        await env.DB.prepare('UPDATE slots SET is_booked = 0 WHERE booking_id = ?').bind(bookingId).run();
        await env.DB.prepare("UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE booking_id = ? AND status <> 'completed'")
          .bind(now, bookingId).run();
      } else if (body.status === 'confirmed') {
        await env.DB.prepare('UPDATE slots SET is_booked = 1 WHERE booking_id = ?').bind(bookingId).run();
      }
      if (body.status === 'completed') {
        await env.DB.prepare("UPDATE tasks SET status = 'completed', completed_at = COALESCE(completed_at, ?), updated_at = ? WHERE booking_id = ?")
          .bind(now, now, bookingId).run();
      }
      if (current.customer_id && (body.status !== undefined || body.payment_status !== undefined)) await refreshCustomerStats(env.DB, current.customer_id);

      const updated = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first();
      return ok(updated);
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  return err('Not found', 404);
}

// POST /api/bookings/create-bayarcash-intent
export async function handleCreateIntent(req: Request, env: Env): Promise<Response> {
  const { booking_id } = await req.json() as any;
  if (!booking_id) return err('Missing booking_id');

  if (!env.BAYARCASH_PAT || !env.BAYARCASH_PORTAL_KEY) return err('Payment gateway not configured', 500);

  const booking = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(booking_id).first<{
    id: string; customer_name: string; customer_phone: string; deposit_amount: number;
    bayarcash_ref: string | null; payment_status: string;
  }>();
  if (!booking) return err('Booking not found', 404);
  if (booking.payment_status === 'paid') return err('Already paid', 409);
  if (!booking.deposit_amount || booking.deposit_amount <= 0) return err('Invalid deposit amount');

  // Generate short order ref
  const orderRef = await generateOrderRef(env.DB, 'JB');

  await env.DB.prepare('UPDATE bookings SET bayarcash_ref = ? WHERE id = ?').bind(orderRef, booking_id).run();

  const siteUrl = (env.SITE_URL || 'https://cuci.jayabina.com').replace(/\/$/, '');
  const amount = Number(booking.deposit_amount).toFixed(2);
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
    return_url: `${siteUrl}/success.html?order=${booking_id}`,
    callback_url: `${urlForReq(req)}/api/payments/bayarcash-callback`,
  };
  if (phone) body.payer_telephone_number = phone;

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${env.BAYARCASH_PAT}`,
    'Content-Type': 'application/json'
  };

  if (env.BAYARCASH_API_SECRET) {
    body.checksum = await hmacSha256Hex(ksortJoin({
      amount,
      order_number: orderRef,
      payer_email: payerEmail,
      payer_name: payerName,
      payment_channel: channel
    }), env.BAYARCASH_API_SECRET);
  }

  const resp = await fetch('https://api.console.bayar.cash/v3/payment-intents', {
    method: 'POST', headers, body: JSON.stringify(body)
  });
  const text = await resp.text();
  let data: any;
  try { data = JSON.parse(text); } catch { return err('Payment gateway returned an invalid response', 502); }
  if (!resp.ok || !data.url) return err(data.message || 'Payment creation failed', 502);
  return json({ url: data.url, id: data.id || null });
}

export async function handleBayarcashCallback(req: Request, env: Env): Promise<Response> {
  const contentType = req.headers.get('content-type') || '';
  let body: Record<string, any> = {};

  if (contentType.includes('application/json')) {
    body = await req.json() as any;
  } else {
    const text = await req.text();
    for (const [k, v] of new URLSearchParams(text)) body[k] = v;
  }

  // A configured secret makes a checksum mandatory; never accept unsigned callbacks.
  if (env.BAYARCASH_API_SECRET) {
    const computed = await hmacSha256Hex(ksortJoin({
      amount: body.amount,
      currency: body.currency,
      datetime: body.datetime,
      exchange_reference_number: body.exchange_reference_number,
      exchange_transaction_id: body.exchange_transaction_id,
      order_number: body.order_number,
      payer_bank_name: body.payer_bank_name,
      payer_email: body.payer_email,
      payer_name: body.payer_name,
      record_type: body.record_type,
      status: body.status,
      status_description: body.status_description,
      transaction_id: body.transaction_id
    }), env.BAYARCASH_API_SECRET);
    if (computed !== String(body.checksum || '')) return err('Invalid checksum', 401);
  }

  const orderRef = body.order_number as string;
  const status = parseInt(body.status as string);
  const transactionId = body.transaction_id as string;

  const booking = await env.DB.prepare('SELECT * FROM bookings WHERE bayarcash_ref = ? AND payment_status = ?')
    .bind(orderRef, 'pending').first<{id: string}>();
  if (!booking) return json({ ok: true });

  if (status === 3) { // paid
    const autoConfirm = await getSetting(env.DB, 'auto_confirm_payment');
    const bookingStatus = autoConfirm !== 'false' ? 'confirmed' : 'pending_payment';

    await env.DB.prepare('UPDATE bookings SET payment_status = ?, bayarcash_transaction_id = ?, status = ?, updated_at = ? WHERE id = ?')
      .bind('paid', transactionId, bookingStatus, nowISO(), booking.id).run();

    // Trigger task creation if confirmed
    if (bookingStatus === 'confirmed') {
      const existingTask = await env.DB.prepare('SELECT id FROM tasks WHERE booking_id = ?').bind(booking.id).first();
      if (!existingTask) {
        const taskId = uuid();
        await env.DB.prepare('INSERT INTO tasks (id, booking_id, status) VALUES (?, ?, ?)')
          .bind(taskId, booking.id, 'unassigned').run();

        const autoEnabled = await getSetting(env.DB, 'auto_assign_enabled');
        if (autoEnabled === 'true') {
          await autoAssignTask(env.DB, taskId);
        }
      }
    }
  } else if (status === 2 || status === 4) {
    await env.DB.prepare('UPDATE bookings SET payment_status = ?, bayarcash_transaction_id = ?, updated_at = ? WHERE id = ?')
      .bind('failed', transactionId, nowISO(), booking.id).run();
  }

  return json({ ok: true });
}

// Helpers

async function generateOrderRef(db: D1Database, prefix: string): Promise<string> {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return (prefix + ts + rand).substring(0, 30);
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
  let digits = normPhone(raw);
  if (digits.startsWith('0')) digits = `6${digits}`;
  else if (digits && !digits.startsWith('60')) digits = `60${digits}`;
  return digits;
}

function urlForReq(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

function malaysiaDateKey(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().split('T')[0];
}

async function refreshCustomerStats(db: D1Database, customerId: string): Promise<void> {
  const stats = await db.prepare(`
    SELECT
      COUNT(*) as total_bookings,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_bookings,
      SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as total_spent,
      MIN(booking_date) as first_booking_date,
      MAX(booking_date) as last_booking_date
    FROM bookings WHERE customer_id = ?
  `).bind(customerId).first<{total_bookings: number; completed_bookings: number; total_spent: number; first_booking_date: string; last_booking_date: string}>();

  if (stats) {
    await db.prepare(`UPDATE customers SET
      total_bookings = ?, completed_bookings = ?, total_spent = ?,
      first_booking_date = ?, last_booking_date = ?, updated_at = ?
      WHERE id = ?`)
      .bind(stats.total_bookings, stats.completed_bookings, stats.total_spent || 0,
        stats.first_booking_date, stats.last_booking_date, nowISO(), customerId).run();
  }
}

async function autoAssignTask(db: D1Database, taskId: string): Promise<boolean> {
  const rule = await getSetting(db, 'auto_assign_rule') || 'round_robin';
  const task = await db.prepare('SELECT * FROM tasks WHERE id = ? AND assigned_to IS NULL').bind(taskId).first();
  if (!task) return false;

  let staff: { id: string } | null = null;

  if (rule === 'area_based') {
    const job = await db.prepare('SELECT b.customer_address FROM tasks t JOIN bookings b ON b.id = t.booking_id WHERE t.id = ?')
      .bind(taskId).first<{customer_address: string}>();
    if (job?.customer_address) {
      const rows = await db.prepare(`
        SELECT p.id FROM profiles p
        WHERE p.role = 'staff' AND p.is_active = 1 AND p.service_area <> ''
          AND lower(?) LIKE '%' || lower(p.service_area) || '%'
        ORDER BY (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = p.id AND t.status IN ('assigned','in_progress','awaiting_review')) ASC
        LIMIT 1
      `).bind(job.customer_address).all();
      staff = rows.results[0] as any;
    }
  }

  if (!staff && rule === 'least_loaded') {
    const rows = await db.prepare(`
      SELECT p.id FROM profiles p
      WHERE p.role = 'staff' AND p.is_active = 1
      ORDER BY (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = p.id AND t.status IN ('assigned','in_progress','awaiting_review')) ASC
      LIMIT 1
    `).all();
    staff = rows.results[0] as any;
  } else if (!staff) {
    // round_robin: staff assigned least recently (or never)
    const rows = await db.prepare(`
      SELECT p.id FROM profiles p
      WHERE p.role = 'staff' AND p.is_active = 1
      ORDER BY COALESCE((SELECT MAX(t.created_at) FROM tasks t WHERE t.assigned_to = p.id), '1970-01-01') ASC
      LIMIT 1
    `).all();
    staff = rows.results[0] as any;
  }

  if (staff) {
    await db.prepare('UPDATE tasks SET assigned_to = ?, status = ?, updated_at = ? WHERE id = ?')
      .bind(staff.id, 'assigned', nowISO(), taskId).run();
    return true;
  }
  return false;
}

export async function handleDistributeUnassigned(req: Request, env: Env): Promise<Response> {
  try {
    const payload = await requireAuth(req, env);
    if (payload.role !== 'admin') return err('Admin only', 403);

    const tasks = await env.DB.prepare('SELECT id FROM tasks WHERE assigned_to IS NULL AND status = ?').bind('unassigned').all();
    let count = 0;
    for (const t of tasks.results) {
      if (await autoAssignTask(env.DB, (t as any).id)) count++;
    }
    return ok({ assigned: count });
  } catch (e: any) {
    return err(e.msg || 'Error', e.status || 400);
  }
}
