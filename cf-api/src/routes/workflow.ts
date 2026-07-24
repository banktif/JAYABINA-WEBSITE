import { and, count, eq, sql } from 'drizzle-orm';
import type { Env } from '../types';
import { err, ok, uuid, nowISO, json as jsonResponse } from '../utils/helpers';
import { requireAuth } from '../utils/middleware';
import { createDb, type AppDb } from '../db/client';
import { bookings, profiles, taskPhotos, tasks } from '../db/schema';
import { generateInvoice } from './invoices';
import { enqueue } from '../queue/events';

export async function handleWorkflow(req: Request, env: Env, path: string): Promise<Response> {
  const db = createDb(env);

  // POST /api/tasks/:id/accept — staff accepts job (step 1)
  const acceptMatch = path.match(/^\/api\/workflow\/([a-f0-9-]+)\/accept$/);
  if (acceptMatch && req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'staff') return err('Staff only', 403);
      const taskId = acceptMatch[1];
      const now = nowISO();

      const task = await db.select({
        assigned_to: tasks.assignedTo, status: tasks.status,
        workflow_step: tasks.workflowStep, booking_id: tasks.bookingId
      }).from(tasks).where(eq(tasks.id, taskId)).get();
      if (!task) return err('Task not found', 404);
      if (task.assigned_to !== payload.sub) return err('Not assigned to you', 403);
      if (task.workflow_step !== 1) return err('Task not in accept state', 409);

      await db.update(tasks).set({
        workflowStep: 2, staffAcceptedAt: now, updatedAt: now
      }).where(eq(tasks.id, taskId));

      await enqueue(db, 'staff.accepted', { booking_id: task.booking_id, task_id: taskId });
      return ok({ step: 2, message: 'Job accepted' });
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // POST /api/workflow/:id/confirm — staff confirms job (step 2, 24h before)
  const confirmMatch = path.match(/^\/api\/workflow\/([a-f0-9-]+)\/confirm$/);
  if (confirmMatch && req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'staff') return err('Staff only', 403);
      const taskId = confirmMatch[1];
      const now = nowISO();

      const task = await db.select({
        assigned_to: tasks.assignedTo, workflow_step: tasks.workflowStep
      }).from(tasks).where(eq(tasks.id, taskId)).get();
      if (!task) return err('Task not found', 404);
      if (task.assigned_to !== payload.sub) return err('Not assigned to you', 403);
      if (task.workflow_step !== 2) return err('Task not in confirm state', 409);

      await db.update(tasks).set({
        workflowStep: 3, staffConfirmedAt: now, updatedAt: now
      }).where(eq(tasks.id, taskId));

      return ok({ step: 3, message: 'Job confirmed' });
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // POST /api/workflow/:id/heading — staff heading to site (step 3, morning of job)
  const headingMatch = path.match(/^\/api\/workflow\/([a-f0-9-]+)\/heading$/);
  if (headingMatch && req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'staff') return err('Staff only', 403);
      const taskId = headingMatch[1];
      const now = nowISO();

      const task = await db.select({
        assigned_to: tasks.assignedTo, workflow_step: tasks.workflowStep
      }).from(tasks).where(eq(tasks.id, taskId)).get();
      if (!task) return err('Task not found', 404);
      if (task.assigned_to !== payload.sub) return err('Not assigned to you', 403);
      if (task.workflow_step !== 3) return err('Task not in heading state', 409);

      await db.update(tasks).set({
        workflowStep: 4, headingAt: now, updatedAt: now
      }).where(eq(tasks.id, taskId));

      return ok({ step: 4, message: 'Heading to site' });
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // POST /api/workflow/:id/arrive — staff arrived at site (step 4)
  const arriveMatch = path.match(/^\/api\/workflow\/([a-f0-9-]+)\/arrive$/);
  if (arriveMatch && req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'staff') return err('Staff only', 403);
      const taskId = arriveMatch[1];
      const now = nowISO();

      const task = await db.select({
        assigned_to: tasks.assignedTo, workflow_step: tasks.workflowStep
      }).from(tasks).where(eq(tasks.id, taskId)).get();
      if (!task) return err('Task not found', 404);
      if (task.assigned_to !== payload.sub) return err('Not assigned to you', 403);
      if (task.workflow_step !== 4) return err('Task not in on-the-way state', 409);

      await db.update(tasks).set({
        workflowStep: 5, arrivedAt: now, updatedAt: now
      }).where(eq(tasks.id, taskId));

      return ok({ step: 5, message: 'Arrived at site' });
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // POST /api/workflow/:id/start — staff starts job (step 6, requires 2 before photos)
  const startMatch = path.match(/^\/api\/workflow\/([a-f0-9-]+)\/start$/);
  if (startMatch && req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'staff') return err('Staff only', 403);
      const taskId = startMatch[1];
      const now = nowISO();

      const task = await db.select({
        assigned_to: tasks.assignedTo, workflow_step: tasks.workflowStep,
        before_photos_count: tasks.beforePhotosCount, booking_id: tasks.bookingId
      }).from(tasks).where(eq(tasks.id, taskId)).get();
      if (!task) return err('Task not found', 404);
      if (task.assigned_to !== payload.sub) return err('Not assigned to you', 403);
      if (task.workflow_step !== 5) return err('Must arrive and take before photos first', 409);

      const beforeCount = (task.before_photos_count ?? 0);
      if (beforeCount < 2) return err(`Must upload 2 before photos (currently: ${beforeCount})`, 409);

      await db.update(tasks).set({
        workflowStep: 6, status: 'in_progress', startedAt: now, updatedAt: now
      }).where(eq(tasks.id, taskId));

      await enqueue(db, 'job.started', { booking_id: task.booking_id, task_id: taskId });
      return ok({ step: 6, message: 'Job started' });
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // POST /api/workflow/:id/request-payment — request customer payment (step 8, requires 2 after photos)
  const rpMatch = path.match(/^\/api\/workflow\/([a-f0-9-]+)\/request-payment$/);
  if (rpMatch && req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'staff') return err('Staff only', 403);
      const taskId = rpMatch[1];
      const now = nowISO();

      const task = await db.select({
        assigned_to: tasks.assignedTo, workflow_step: tasks.workflowStep,
        after_photos_count: tasks.afterPhotosCount, booking_id: tasks.bookingId,
        status: tasks.status
      }).from(tasks).where(eq(tasks.id, taskId)).get();
      if (!task) return err('Task not found', 404);
      if (task.assigned_to !== payload.sub) return err('Not assigned to you', 403);
      if (task.workflow_step !== 6) return err('Must start job and take after photos first', 409);

      const afterCount = (task.after_photos_count ?? 0);
      if (afterCount < 2) return err(`Must upload 2 after photos (currently: ${afterCount})`, 409);

      await db.update(tasks).set({
        workflowStep: 8, status: 'awaiting_review',
        finishedAt: now, paymentRequestedAt: now, updatedAt: now
      }).where(eq(tasks.id, taskId));

      // Auto-send WA payment link to customer
      await enqueue(db, 'payment.requested', { booking_id: task.booking_id, task_id: taskId });
      return ok({ step: 8, message: 'Payment link sent to customer. Wait for on-the-spot payment.' });
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  // POST /api/workflow/:id/finish — customer paid, staff finishes job (step 9)
  const finishMatch = path.match(/^\/api\/workflow\/([a-f0-9-]+)\/finish$/);
  if (finishMatch && req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'staff') return err('Staff only', 403);
      const taskId = finishMatch[1];
      const now = nowISO();

      const task = await db.select({
        assigned_to: tasks.assignedTo, workflow_step: tasks.workflowStep,
        booking_id: tasks.bookingId, customer_paid_on_site: tasks.customerPaidOnSite
      }).from(tasks).where(eq(tasks.id, taskId)).get();
      if (!task) return err('Task not found', 404);
      if (task.assigned_to !== payload.sub) return err('Not assigned to you', 403);
      if (task.workflow_step !== 8) return err('Must request payment first', 409);

      await db.update(tasks).set({
        workflowStep: 9, status: 'completed', completedAt: now,
        customerPaidOnSite: 1, updatedAt: now
      }).where(eq(tasks.id, taskId));

      await db.update(bookings).set({ status: 'completed', updatedAt: now })
        .where(eq(bookings.id, task.booking_id));

      // Auto-generate invoice
      await generateInvoice(db, task.booking_id);
      await enqueue(db, 'job.completed', { booking_id: task.booking_id, task_id: taskId });

      return ok({ step: 9, message: 'Job completed. Invoice generated.' });
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  return err('Not found', 404);
}

// Handle photo upload with count tracking
export async function handleWorkflowPhoto(req: Request, env: Env): Promise<Response> {
  const db = createDb(env);
  const url = new URL(req.url);

  // POST /api/workflow/photos
  if (req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      const { task_id, type, url: photoUrl } = await req.json() as any;

      if (!task_id || !type || !photoUrl) return err('Missing task_id, type, or url');
      if (!['before', 'after'].includes(type)) return err('Type must be "before" or "after"');

      try { const p = new URL(String(photoUrl)); if (p.protocol !== 'https:') return err('HTTPS only'); } catch { return err('Invalid URL'); }

      const task = await db.select({
        assigned_to: tasks.assignedTo, before_photos_count: tasks.beforePhotosCount,
        after_photos_count: tasks.afterPhotosCount, workflow_step: tasks.workflowStep
      }).from(tasks).where(eq(tasks.id, task_id)).get();

      if (!task) return err('Task not found', 404);
      if (payload.role === 'staff' && task.assigned_to !== payload.sub) return err('Access denied', 403);

      const photoId = uuid();
      await db.insert(taskPhotos).values({
        id: photoId, taskId: task_id, type, url: photoUrl, uploadedBy: payload.sub
      });

      const countField = type === 'before' ? 'beforePhotosCount' : 'afterPhotosCount';
      const currentCount = type === 'before' ? (task.before_photos_count ?? 0) : (task.after_photos_count ?? 0);
      const newCount = currentCount + 1;

      await db.update(tasks).set({
        [countField === 'beforePhotosCount' ? 'beforePhotosCount' : 'afterPhotosCount']: newCount,
        updatedAt: nowISO()
      }).where(eq(tasks.id, task_id));

      return ok({
        id: photoId, task_id, type, url: photoUrl,
        [type === 'before' ? 'before_total' : 'after_total']: newCount,
        can_proceed: type === 'before' ? newCount >= 2 : newCount >= 2
      });
    } catch (e: any) { return err(e.msg || 'Error', e.status || 400); }
  }

  return err('Not found', 404);
}
