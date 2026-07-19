import { and, asc, count, desc, eq, inArray, max, min, sql, sum, type SQL } from 'drizzle-orm';
import type { Env } from '../types';
import { json, err, ok, uuid, nowISO, normPhone, todayStr } from '../utils/helpers';
import { requireAuth } from '../utils/middleware';
import { createDb, type AppDb } from '../db/client';
import { appSettings, bookings, customers, profiles, slots, tasks } from '../db/schema';

const bookingFields = {
  id: bookings.id,
  created_at: bookings.createdAt,
  updated_at: bookings.updatedAt,
  customer_name: bookings.customerName,
  customer_phone: bookings.customerPhone,
  customer_address: bookings.customerAddress,
  booking_date: bookings.bookingDate,
  booking_time: bookings.bookingTime,
  amount: bookings.amount,
  deposit_amount: bookings.depositAmount,
  payment_status: bookings.paymentStatus,
  bayarcash_ref: bookings.bayarcashRef,
  bayarcash_transaction_id: bookings.bayarcashTransactionId,
  status: bookings.status,
  notes: bookings.notes,
  customer_id: bookings.customerId
};

export async function handleBookings(req: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(req.url);
  const db = createDb(env);

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

      const conditions: SQL[] = [];

      if (payload && payload.role === 'staff') {
        conditions.push(inArray(bookings.id, db.select({ bookingId: tasks.bookingId }).from(tasks)
          .where(eq(tasks.assignedTo, payload.sub))));
      }

      // Anon: must have customer_phone filter
      if (!payload && customerPhone) {
        conditions.push(eq(bookings.customerPhone, normPhone(customerPhone)));
      }

      if (payload) {
        if (customerPhone) conditions.push(eq(bookings.customerPhone, normPhone(customerPhone)));
        if (dateFilter) conditions.push(eq(bookings.bookingDate, dateFilter));
        if (statusFilter) conditions.push(eq(bookings.status, statusFilter as any));
        if (customerId) conditions.push(eq(bookings.customerId, customerId));
        if (idsParam) {
          const idList = idsParam.split(',').map((s: string) => s.trim()).filter(Boolean);
          if (idList.length) conditions.push(inArray(bookings.id, idList));
        }
      }

      const orderColumns = {
        booking_date: bookings.bookingDate,
        created_at: bookings.createdAt,
        booking_time: bookings.bookingTime,
        customer_name: bookings.customerName,
        status: bookings.status,
        payment_status: bookings.paymentStatus
      } as const;
      const orderColumn = orderColumns[orderCol as keyof typeof orderColumns] || bookings.bookingDate;
      const rows = await db.select(bookingFields).from(bookings)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(orderDir === 'desc' ? desc(orderColumn) : asc(orderColumn));
      return ok(rows);
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  // GET /api/bookings/public - anon read single booking
  if (path === '/api/bookings/public' && req.method === 'GET') {
    const id = url.searchParams.get('id');
    if (!id) return err('Missing id');
    const row = await db.select(bookingFields).from(bookings).where(eq(bookings.id, id)).get();
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

    const maxSlots = parseInt(await getSetting(db, 'max_slots_per_day') || '4');
    const allowedSlots = (await getSetting(db, 'slots') || '9am,11am,2pm,4pm')
      .split(',').map(s => s.trim()).filter(Boolean);
    if (!allowedSlots.includes(booking_time)) return err('Invalid booking time');

    const existing = await db.select({ cnt: count() }).from(slots)
      .where(and(eq(slots.date, booking_date), eq(slots.isBooked, 1))).get();
    if (existing && existing.cnt >= maxSlots) return err('No slots available for this date', 409);
    const existingSlot = await db.select({ id: slots.id }).from(slots).where(and(
      eq(slots.date, booking_date), eq(slots.timeSlot, booking_time), eq(slots.isBooked, 1)
    )).get();
    if (existingSlot) return err('This time slot is already booked', 409);

    const priceTotal = parseFloat(await getSetting(db, 'price_total') || '300');
    const priceDeposit = parseFloat(await getSetting(db, 'price_deposit') || '150');

    const bookingId = uuid();
    const slotId = uuid();
    const now = nowISO();

    const phoneDigits = normPhone(customer_phone);

    // Find or create customer
    let cust = await db.select({ id: customers.id }).from(customers).where(eq(customers.phone, phoneDigits)).get();
    if (!cust) {
      const custId = uuid();
      await db.insert(customers).values({ id: custId, phone: phoneDigits, name: customer_name, address: customer_address });
      cust = { id: custId };
    } else {
      await db.update(customers).set({ name: customer_name, address: customer_address }).where(eq(customers.id, cust.id));
    }

    try {
      await db.batch([
        db.insert(bookings).values({
          id: bookingId, customerName: customer_name, customerPhone: phoneDigits,
          customerAddress: customer_address, bookingDate: booking_date, bookingTime: booking_time,
          amount: priceTotal, depositAmount: priceDeposit, customerId: cust.id,
          createdAt: now, updatedAt: now
        }),
        db.insert(slots).values({ id: slotId, date: booking_date, timeSlot: booking_time, isBooked: 1, bookingId })
      ]);
    } catch (e: any) {
      if (String(e?.message || e).includes('UNIQUE constraint')) return err('This time slot is already booked', 409);
      throw e;
    }

    // Update customer stats
    await refreshCustomerStats(db, cust.id);

    const booking = await db.select(bookingFields).from(bookings).where(eq(bookings.id, bookingId)).get();
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
      const current = await db.select(bookingFields).from(bookings).where(eq(bookings.id, bookingId)).get();
      if (!current) return err('Booking not found', 404);

      // Check access
      if (payload.role !== 'admin') {
        const hasAccess = await db.select({ id: tasks.id }).from(tasks)
          .where(and(eq(tasks.bookingId, bookingId), eq(tasks.assignedTo, payload.sub))).get();
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
        const allowedSlots = (await getSetting(db, 'slots') || '9am,11am,2pm,4pm').split(',').map(s => s.trim()).filter(Boolean);
        if (!allowedSlots.includes(nextTime)) return err('Invalid booking time');
      }
      if (body.booking_date !== undefined || body.booking_time !== undefined || body.status === 'confirmed') {
        const conflict = await db.select({ booking_id: slots.bookingId }).from(slots).where(and(
          eq(slots.date, nextDate), eq(slots.timeSlot, nextTime), eq(slots.isBooked, 1),
          sql`${slots.bookingId} <> ${bookingId}`
        )).get();
        if (conflict) return err('This time slot is already booked', 409);
      }

      const updates: Partial<typeof bookings.$inferInsert> = { updatedAt: now };

      if (body.status !== undefined) {
        updates.status = body.status;
        // Trigger: on confirmed, create task if none
        if (body.status === 'confirmed') {
          const existingTask = await db.select({ id: tasks.id, assigned_to: tasks.assignedTo, status: tasks.status })
            .from(tasks).where(eq(tasks.bookingId, bookingId)).get();
          if (!existingTask) {
            const taskId = uuid();
            await db.insert(tasks).values({ id: taskId, bookingId, status: 'unassigned' });

            // Auto-assign if enabled
            const autoEnabled = await getSetting(db, 'auto_assign_enabled');
            if (autoEnabled === 'true') {
              await autoAssignTask(db, taskId);
            }
          } else if (existingTask.status === 'cancelled') {
            await db.update(tasks).set({
              status: existingTask.assigned_to ? 'assigned' : 'unassigned', completedAt: null, updatedAt: now
            }).where(eq(tasks.id, existingTask.id));
          }
        }
      }

      if (body.payment_status !== undefined) updates.paymentStatus = body.payment_status;
      if (body.customer_name !== undefined) updates.customerName = body.customer_name;
      if (body.customer_phone !== undefined) updates.customerPhone = normPhone(body.customer_phone);
      if (body.customer_address !== undefined) updates.customerAddress = body.customer_address;
      if (body.notes !== undefined) updates.notes = body.notes;
      if (body.booking_date !== undefined) updates.bookingDate = body.booking_date;
      if (body.booking_time !== undefined) updates.bookingTime = body.booking_time;

      await db.update(bookings).set(updates).where(eq(bookings.id, bookingId));

      if (body.booking_date !== undefined || body.booking_time !== undefined) {
        const slot = await db.select({ id: slots.id }).from(slots).where(eq(slots.bookingId, bookingId)).get();
        if (slot) {
          await db.update(slots).set({ date: nextDate, timeSlot: nextTime }).where(eq(slots.bookingId, bookingId));
        } else {
          await db.insert(slots).values({
            id: uuid(), date: nextDate, timeSlot: nextTime,
            isBooked: body.status === 'cancelled' || current.status === 'cancelled' ? 0 : 1,
            bookingId
          });
        }
      }
      if (body.status === 'cancelled') {
        await db.update(slots).set({ isBooked: 0 }).where(eq(slots.bookingId, bookingId));
        await db.update(tasks).set({ status: 'cancelled', updatedAt: now })
          .where(and(eq(tasks.bookingId, bookingId), sql`${tasks.status} <> 'completed'`));
      } else if (body.status === 'confirmed') {
        await db.update(slots).set({ isBooked: 1 }).where(eq(slots.bookingId, bookingId));
      }
      if (body.status === 'completed') {
        await db.update(tasks).set({
          status: 'completed', completedAt: sql`COALESCE(${tasks.completedAt}, ${now})`, updatedAt: now
        }).where(eq(tasks.bookingId, bookingId));
      }
      if (current.customer_id && (body.status !== undefined || body.payment_status !== undefined)) await refreshCustomerStats(db, current.customer_id);

      const updated = await db.select(bookingFields).from(bookings).where(eq(bookings.id, bookingId)).get();
      return ok(updated);
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  return err('Not found', 404);
}

// POST /api/bookings/create-bayarcash-intent
export async function handleCreateIntent(req: Request, env: Env): Promise<Response> {
  const db = createDb(env);
  const { booking_id } = await req.json() as any;
  if (!booking_id) return err('Missing booking_id');

  if (!env.BAYARCASH_PAT || !env.BAYARCASH_PORTAL_KEY) return err('Payment gateway not configured', 500);

  const booking = await db.select({
    id: bookings.id,
    customer_name: bookings.customerName,
    customer_phone: bookings.customerPhone,
    deposit_amount: bookings.depositAmount,
    bayarcash_ref: bookings.bayarcashRef,
    payment_status: bookings.paymentStatus
  }).from(bookings).where(eq(bookings.id, booking_id)).get();
  if (!booking) return err('Booking not found', 404);
  if (booking.payment_status === 'paid') return err('Already paid', 409);
  if (!booking.deposit_amount || booking.deposit_amount <= 0) return err('Invalid deposit amount');

  // Generate short order ref
  const orderRef = generateOrderRef('JB');

  await db.update(bookings).set({ bayarcashRef: orderRef }).where(eq(bookings.id, booking_id));

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
  const db = createDb(env);
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
    const autoConfirm = await getSetting(db, 'auto_confirm_payment');
    const bookingStatus = autoConfirm !== 'false' ? 'confirmed' : 'pending_payment';

    await db.update(bookings).set({
      paymentStatus: 'paid', bayarcashTransactionId: transactionId,
      status: bookingStatus, updatedAt: nowISO()
    }).where(eq(bookings.id, booking.id));

    // Trigger task creation if confirmed
    if (bookingStatus === 'confirmed') {
      const existingTask = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.bookingId, booking.id)).get();
      if (!existingTask) {
        const taskId = uuid();
        await db.insert(tasks).values({ id: taskId, bookingId: booking.id, status: 'unassigned' });

        const autoEnabled = await getSetting(db, 'auto_assign_enabled');
        if (autoEnabled === 'true') {
          await autoAssignTask(db, taskId);
        }
      }
    }
  } else if (status === 2 || status === 4) {
    await db.update(bookings).set({
      paymentStatus: 'failed', bayarcashTransactionId: transactionId, updatedAt: nowISO()
    }).where(eq(bookings.id, booking.id));
  }

  return json({ ok: true });
}

// Helpers

function generateOrderRef(prefix: string): string {
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

async function refreshCustomerStats(db: AppDb, customerId: string): Promise<void> {
  const stats = await db.select({
    total_bookings: count(),
    completed_bookings: sum(sql`CASE WHEN ${bookings.status} = 'completed' THEN 1 ELSE 0 END`),
    total_spent: sum(sql`CASE WHEN ${bookings.status} = 'completed' THEN ${bookings.amount} ELSE 0 END`),
    first_booking_date: min(bookings.bookingDate),
    last_booking_date: max(bookings.bookingDate)
  }).from(bookings).where(eq(bookings.customerId, customerId)).get();

  if (stats) {
    await db.update(customers).set({
      totalBookings: stats.total_bookings,
      completedBookings: Number(stats.completed_bookings || 0),
      totalSpent: Number(stats.total_spent || 0),
      firstBookingDate: stats.first_booking_date,
      lastBookingDate: stats.last_booking_date,
      updatedAt: nowISO()
    }).where(eq(customers.id, customerId));
  }
}

async function getSetting(db: AppDb, key: string): Promise<string> {
  const row = await db.select({ value: appSettings.value }).from(appSettings)
    .where(eq(appSettings.key, key)).get();
  return row?.value || '';
}

async function autoAssignTask(db: AppDb, taskId: string): Promise<boolean> {
  const rule = await getSetting(db, 'auto_assign_rule') || 'round_robin';
  const task = await db.select({ id: tasks.id }).from(tasks)
    .where(and(eq(tasks.id, taskId), sql`${tasks.assignedTo} IS NULL`)).get();
  if (!task) return false;

  let staff: { id: string } | null = null;

  if (rule === 'area_based') {
    const job = await db.select({ customer_address: bookings.customerAddress }).from(tasks)
      .innerJoin(bookings, eq(bookings.id, tasks.bookingId)).where(eq(tasks.id, taskId)).get();
    if (job?.customer_address) {
      staff = await db.get<{ id: string }>(sql`
        SELECT p.id FROM profiles p
        WHERE p.role = 'staff' AND p.is_active = 1 AND p.service_area <> ''
          AND lower(${job.customer_address}) LIKE '%' || lower(p.service_area) || '%'
        ORDER BY (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = p.id AND t.status IN ('assigned','in_progress','awaiting_review')) ASC
        LIMIT 1
      `) || null;
    }
  }

  if (!staff && rule === 'least_loaded') {
    staff = await db.get<{ id: string }>(sql`
      SELECT p.id FROM profiles p
      WHERE p.role = 'staff' AND p.is_active = 1
      ORDER BY (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = p.id AND t.status IN ('assigned','in_progress','awaiting_review')) ASC
      LIMIT 1
    `) || null;
  } else if (!staff) {
    // round_robin: staff assigned least recently (or never)
    staff = await db.get<{ id: string }>(sql`
      SELECT p.id FROM profiles p
      WHERE p.role = 'staff' AND p.is_active = 1
      ORDER BY COALESCE((SELECT MAX(t.created_at) FROM tasks t WHERE t.assigned_to = p.id), '1970-01-01') ASC
      LIMIT 1
    `) || null;
  }

  if (staff) {
    await db.update(tasks).set({ assignedTo: staff.id, status: 'assigned', updatedAt: nowISO() })
      .where(eq(tasks.id, taskId));
    return true;
  }
  return false;
}

export async function handleDistributeUnassigned(req: Request, env: Env): Promise<Response> {
  try {
    const payload = await requireAuth(req, env);
    if (payload.role !== 'admin') return err('Admin only', 403);

    const db = createDb(env);
    const unassignedTasks = await db.select({ id: tasks.id }).from(tasks)
      .where(and(sql`${tasks.assignedTo} IS NULL`, eq(tasks.status, 'unassigned')));
    let count = 0;
    for (const task of unassignedTasks) {
      if (await autoAssignTask(db, task.id)) count++;
    }
    return ok({ assigned: count });
  } catch (e: any) {
    return err(e.msg || 'Error', e.status || 400);
  }
}
