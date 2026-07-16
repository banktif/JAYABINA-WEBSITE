import type { Env } from '../types';
import { err, ok, uuid, nowISO } from '../utils/helpers';
import { requireAuth, requireAdmin } from '../utils/middleware';

export async function handleTasks(req: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(req.url);

  // GET /api/tasks
  if (path === '/api/tasks' && req.method === 'GET') {
    try {
      const payload = await requireAuth(req, env);
      const statusFilter = url.searchParams.get('status');
      const assignedTo = url.searchParams.get('assigned_to');
      const bookingId = url.searchParams.get('booking_id');

      let q = `SELECT t.*, b.customer_name, b.customer_phone, b.customer_address, b.booking_date, b.booking_time,
        p.full_name as staff_name FROM tasks t LEFT JOIN bookings b ON t.booking_id = b.id LEFT JOIN profiles p ON t.assigned_to = p.id`;
      const conds: string[] = [];
      const params: any[] = [];

      if (payload.role === 'staff') {
        conds.push('t.assigned_to = ?');
        params.push(payload.sub);
      }

      if (statusFilter) { conds.push('t.status = ?'); params.push(statusFilter); }
      if (assignedTo && payload.role === 'admin') { conds.push('t.assigned_to = ?'); params.push(assignedTo); }
      if (bookingId && payload.role === 'admin') { conds.push('t.booking_id = ?'); params.push(bookingId); }

      if (conds.length) q += ' WHERE ' + conds.join(' AND ');
      q += ' ORDER BY b.booking_date DESC, b.booking_time ASC';

      const result = await env.DB.prepare(q).bind(...params).all();
      return ok(result.results);
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  // PATCH /api/tasks/:id
  const patchMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)$/);
  if (patchMatch && req.method === 'PATCH') {
    try {
      const payload = await requireAuth(req, env);
      const taskId = patchMatch[1];
      const body = await req.json() as any;
      const now = nowISO();

      const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first<{assigned_to: string | null; status: string; booking_id: string}>();
      if (!task) return err('Task not found', 404);

      // Staff can only update own tasks
      if (payload.role === 'staff' && task.assigned_to !== payload.sub) {
        return err('Access denied', 403);
      }

      const sets: string[] = ['updated_at = ?'];
      const params: any[] = [now];
      let nextStatus: string | null = null;

      if (body.assigned_to !== undefined && payload.role === 'admin') {
        if (body.assigned_to) {
          const assignee = await env.DB.prepare("SELECT id FROM profiles WHERE id = ? AND role = 'staff' AND is_active = 1")
            .bind(body.assigned_to).first();
          if (!assignee) return err('Selected staff account is not active', 400);
        } else if (!['unassigned', 'assigned', 'cancelled'].includes(task.status)) {
          return err('A job already in progress cannot be unassigned', 409);
        }
        sets.push('assigned_to = ?'); params.push(body.assigned_to);
        if (['unassigned', 'assigned', 'cancelled'].includes(task.status)) {
          nextStatus = body.assigned_to ? 'assigned' : 'unassigned';
        }
      }

      if (body.status !== undefined) {
        const allowedStatuses = ['unassigned', 'assigned', 'in_progress', 'awaiting_review', 'completed', 'cancelled'];
        if (!allowedStatuses.includes(body.status)) return err('Invalid task status');
        if (payload.role === 'staff' && !['in_progress', 'awaiting_review'].includes(body.status)) {
          return err('Staff can only start a job or submit it for review', 403);
        }
        if (payload.role === 'staff' && body.status === 'in_progress') {
          if (task.status !== 'assigned') return err('Only an assigned job can be started', 409);
          const before = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM task_photos WHERE task_id = ? AND type = 'before'")
            .bind(taskId).first<{cnt: number}>();
          if (!before?.cnt) return err('Upload at least one before photo before starting the job', 409);
        }
        if (payload.role === 'staff' && body.status === 'awaiting_review') {
          if (task.status !== 'in_progress') return err('Start the job before submitting it for review', 409);
          const after = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM task_photos WHERE task_id = ? AND type = 'after'")
            .bind(taskId).first<{cnt: number}>();
          if (!after?.cnt) return err('Upload at least one after photo before finishing the job', 409);
        }
        nextStatus = body.status;
        switch (body.status) {
          case 'in_progress':
            sets.push('started_at = ?'); params.push(body.started_at || now);
            break;
          case 'awaiting_review':
            sets.push('finished_at = ?'); params.push(body.finished_at || now);
            // Auto-complete check
            const autoComplete = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'auto_complete_task'").first<{value: string}>();
            if (autoComplete?.value === 'true') {
              nextStatus = 'completed';
              sets.push('completed_at = ?'); params.push(now);
              await env.DB.prepare("UPDATE bookings SET status = 'completed', updated_at = ? WHERE id = ?")
                .bind(now, task.booking_id).run();
              const autoBooking = await env.DB.prepare('SELECT customer_id FROM bookings WHERE id = ?')
                .bind(task.booking_id).first<{customer_id: string | null}>();
              if (autoBooking?.customer_id) await refreshCustomerStats(env.DB, autoBooking.customer_id);
            }
            break;
          case 'completed':
            if (payload.role !== 'admin') return err('Admin only', 403);
            sets.push('completed_at = ?'); params.push(now);
            await env.DB.prepare("UPDATE bookings SET status = 'completed', updated_at = ? WHERE id = ?")
              .bind(now, task.booking_id).run();
            const completedBooking = await env.DB.prepare('SELECT customer_id FROM bookings WHERE id = ?')
              .bind(task.booking_id).first<{customer_id: string | null}>();
            if (completedBooking?.customer_id) await refreshCustomerStats(env.DB, completedBooking.customer_id);
            break;
          case 'cancelled':
            if (payload.role !== 'admin') return err('Admin only', 403);
            await env.DB.prepare("UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE id = ?")
              .bind(now, task.booking_id).run();
            await env.DB.prepare('UPDATE slots SET is_booked = 0 WHERE booking_id = ?').bind(task.booking_id).run();
            break;
        }
      }

      if (nextStatus !== null) { sets.push('status = ?'); params.push(nextStatus); }

      if (sets.length > 1) {
        params.push(taskId);
        await env.DB.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
      }

      const updated = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();
      return ok(updated);
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  return err('Not found', 404);
}

export async function handleTaskPhotos(req: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(req.url);

  // GET /api/task-photos?task_id=
  if (path === '/api/task-photos' && req.method === 'GET') {
    try {
      const payload = await requireAuth(req, env);
      const taskId = url.searchParams.get('task_id');
      if (!taskId) return err('Missing task_id');

      if (payload.role === 'staff') {
        const task = await env.DB.prepare('SELECT assigned_to FROM tasks WHERE id = ?')
          .bind(taskId).first<{assigned_to: string | null}>();
        if (!task || task.assigned_to !== payload.sub) return err('Access denied', 403);
      }

      const photos = await env.DB.prepare('SELECT * FROM task_photos WHERE task_id = ? ORDER BY created_at ASC')
        .bind(taskId).all();
      return ok(photos.results);
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  // POST /api/task-photos
  if (path === '/api/task-photos' && req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      const { task_id, type, url: photoUrl } = await req.json() as any;

      if (!task_id || !type || !photoUrl) return err('Missing task_id, type, or url');
      if (!['before', 'after'].includes(type)) return err('Type must be "before" or "after"');
      try {
        const parsed = new URL(String(photoUrl));
        if (parsed.protocol !== 'https:') return err('Photo URL must use HTTPS');
      } catch { return err('Invalid photo URL'); }

      // Verify staff owns this task (or admin)
      if (payload.role === 'staff') {
        const task = await env.DB.prepare('SELECT assigned_to FROM tasks WHERE id = ?').bind(task_id).first<{assigned_to: string}>();
        if (!task || task.assigned_to !== payload.sub) return err('Access denied', 403);
      }

      const photoId = uuid();
      await env.DB.prepare('INSERT INTO task_photos (id, task_id, type, url, uploaded_by) VALUES (?,?,?,?,?)')
        .bind(photoId, task_id, type, photoUrl, payload.sub).run();

      return ok({ id: photoId, task_id, type, url: photoUrl, uploaded_by: payload.sub });
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  return err('Not found', 404);
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
