import { eq, sql } from 'drizzle-orm';
import type { Env } from '../types';
import { err, ok, nowISO } from '../utils/helpers';
import { requireAuth } from '../utils/middleware';
import { createDb, type AppDb } from '../db/client';
import { tasks, bookings } from '../db/schema';

// Record GPS check-in for a task
export async function handleTracking(req: Request, env: Env): Promise<Response> {
  const db = createDb(env);

  // POST /api/tracking/checkin — staff GPS check-in
  if (req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'staff') return err('Staff only', 403);

      const { task_id, lat, lng } = await req.json() as any;
      if (!task_id || lat === undefined || lng === undefined) return err('Missing task_id, lat, lng');

      const task = await db.select({
        assigned_to: tasks.assignedTo, workflow_step: tasks.workflowStep,
        booking_id: tasks.bookingId
      }).from(tasks).where(eq(tasks.id, task_id)).get();

      if (!task) return err('Task not found', 404);
      if (task.assigned_to !== payload.sub) return err('Not assigned to you', 403);

      const now = nowISO();

      // Store GPS as metadata
      await db.run(sql`
        UPDATE tasks SET
          notes = json_insert(COALESCE(notes, '{}'), '$.gps_lat', ${lat}, '$.gps_lng', ${lng}, '$.gps_updated_at', ${now}),
          updated_at = ${now}
        WHERE id = ${task_id}
      `);

      // Notify customer with location
      const booking = await db.select({
        customer_name: bookings.customerName, customer_phone: bookings.customerPhone
      }).from(bookings).where(eq(bookings.id, task.booking_id)).get();

      let waLink = '';
      if (booking?.customer_phone && env.WA_PHONE_NUMBER_ID && env.WA_ACCESS_TOKEN) {
        try {
          let digits = String(booking.customer_phone).replace(/\D/g, '');
          if (digits.startsWith('0')) digits = '6' + digits;

          await fetch(`https://graph.facebook.com/v22.0/${env.WA_PHONE_NUMBER_ID}/messages`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${env.WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messaging_product: 'whatsapp', to: digits, type: 'location',
              location: { latitude: parseFloat(lat), longitude: parseFloat(lng), name: 'Staff Location', address: 'JAYABINA staff is on the way' }
            })
          });
        } catch {}
      }

      return ok({ tracked: true, lat, lng });
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // GET /api/tracking/:task_id — get GPS location for a task (admin or assigned staff)
  if (req.method === 'GET') {
    try {
      const payload = await requireAuth(req, env);
      const url = new URL(req.url);
      const taskId = url.pathname.split('/').pop() || '';

      const task = await db.select({
        assigned_to: tasks.assignedTo, notes: sql`notes`
      }).from(tasks).where(eq(tasks.id, taskId)).get() as any;

      if (!task) return err('Task not found', 404);
      if (payload.role === 'staff' && task.assigned_to !== payload.sub) return err('Access denied', 403);

      let gps = null;
      try {
        const notes = JSON.parse(task.notes || '{}');
        if (notes.gps_lat) gps = { lat: notes.gps_lat, lng: notes.gps_lng, updated_at: notes.gps_updated_at };
      } catch {}

      return ok({ task_id: taskId, gps });
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  return err('Not found', 404);
}
