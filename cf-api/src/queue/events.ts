import { eq, sql } from 'drizzle-orm';
import type { Env } from '../types';
import { createDb, type AppDb } from '../db/client';

type QueueEvent = {
  type: string;
  payload: Record<string, any>;
  created_at: string;
  retries: number;
  status: 'pending' | 'processing' | 'failed' | 'done';
};

export async function enqueue(db: AppDb, eventType: string, payload: Record<string, any>): Promise<void> {
  try {
    await db.run(sql`
      INSERT INTO analytics_events (id, event_type, booking_id, customer_id, metadata, created_at)
      VALUES (${crypto.randomUUID()}, 'queue:' || ${eventType}, ${payload.booking_id || null},
        ${payload.customer_id || null}, ${JSON.stringify({ ...payload, _retries: 0, _status: 'pending' })}, datetime('now'))
    `);
  } catch (e) { console.error('enqueue error:', e); }
}

export async function dequeuePending(db: AppDb, limit: number = 10): Promise<QueueEvent[]> {
  try {
    const rows = await db.all(sql`
      SELECT * FROM analytics_events
      WHERE event_type LIKE 'queue:%'
        AND json_extract(metadata, '$._status') = 'pending'
      ORDER BY created_at ASC
      LIMIT ${limit}
    `) as any[];
    return (rows || []).map(r => ({
      type: (r.event_type as string).replace('queue:', ''),
      payload: JSON.parse(r.metadata || '{}'),
      created_at: r.created_at,
      retries: (() => { try { return JSON.parse(r.metadata || '{}')._retries || 0 } catch { return 0 } })(),
      status: (() => { try { return JSON.parse(r.metadata || '{}')._status || 'pending' } catch { return 'pending' }})()
    }));
  } catch { return []; }
}

export async function markEventDone(db: AppDb, eventId: string): Promise<void> {
  try {
    await db.run(sql`
      UPDATE analytics_events SET metadata = json_set(metadata, '$._status', 'done')
      WHERE id = ${eventId}
    `);
  } catch {}
}

export async function markEventRetry(db: AppDb, eventId: string, retries: number): Promise<void> {
  try {
    if (retries >= 3) {
      await db.run(sql`
        UPDATE analytics_events SET metadata = json_set(metadata, '$._status', 'failed', '$._retries', ${retries})
        WHERE id = ${eventId}
      `);
    } else {
      await db.run(sql`
        UPDATE analytics_events SET metadata = json_set(metadata, '$._retries', ${retries}, '$._status', 'pending')
        WHERE id = ${eventId}
      `);
    }
  } catch {}
}

export async function cleanupStaleEvents(db: AppDb): Promise<number> {
  try {
    const r = await db.run(sql`
      UPDATE analytics_events SET metadata = json_set(metadata, '$._status', 'failed')
      WHERE event_type LIKE 'queue:%'
        AND json_extract(metadata, '$._status') = 'pending'
        AND created_at < datetime('now', '-6 hours')
    `);
    return r?.meta?.changes || 0;
  } catch { return 0; }
}
