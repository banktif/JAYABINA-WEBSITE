import { and, count, eq } from 'drizzle-orm';
import type { Env } from '../types';
import { err, ok } from '../utils/helpers';
import { createDb, type AppDb } from '../db/client';
import { appSettings, slots } from '../db/schema';

export async function handleSlots(req: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(req.url);
  const db = createDb(env);

  // GET /api/slots/available?date=
  if (path === '/api/slots/available' && req.method === 'GET') {
    const date = url.searchParams.get('date');
    if (!date) return err('Missing date parameter');

    const slotsStr = await getSetting(db, 'slots') || '9am,11am,2pm,4pm';
    const maxSlotsPerDay = parseInt(await getSetting(db, 'max_slots_per_day') || '4');
    const slotList = slotsStr.split(',').map(s => s.trim());

    const booked = await db.select({ time_slot: slots.timeSlot }).from(slots)
      .where(and(eq(slots.date, date), eq(slots.isBooked, 1)));
    const bookedSet = new Set(booked.map(row => row.time_slot));
    const [bookedCount] = await db.select({ cnt: count() }).from(slots)
      .where(and(eq(slots.date, date), eq(slots.isBooked, 1)));
    const dayAvailable = (bookedCount?.cnt || 0) < maxSlotsPerDay;

    const result = slotList.map(s => ({ time_slot: s, available: dayAvailable && !bookedSet.has(s) }));

    return ok(result);
  }

  // GET /api/slots/check?date=
  if (path === '/api/slots/check' && req.method === 'GET') {
    const date = url.searchParams.get('date');
    if (!date) return err('Missing date parameter');

    const maxSlotsPerDay = parseInt(await getSetting(db, 'max_slots_per_day') || '4');
    const [bookedCount] = await db.select({ cnt: count() }).from(slots)
      .where(and(eq(slots.date, date), eq(slots.isBooked, 1)));
    const available = (bookedCount?.cnt || 0) < maxSlotsPerDay;

    return ok({ available });
  }

  return err('Not found', 404);
}

async function getSetting(db: AppDb, key: string): Promise<string> {
  const row = await db.select({ value: appSettings.value }).from(appSettings)
    .where(eq(appSettings.key, key)).get();
  return row?.value || '';
}
