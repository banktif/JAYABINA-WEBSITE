import { asc, inArray } from 'drizzle-orm';
import type { Env } from '../types';
import { err, ok, nowISO } from '../utils/helpers';
import { requireAuth, requireAdmin } from '../utils/middleware';
import { createDb } from '../db/client';
import { appSettings, privateSettings } from '../db/schema';

export async function handleSettings(req: Request, env: Env, path: string): Promise<Response> {
  const db = createDb(env);

  // GET /api/settings (all auth users)
  if (path === '/api/settings' && req.method === 'GET') {
    try {
      await requireAuth(req, env);
      const rows = await db.select({
        key: appSettings.key,
        value: appSettings.value,
        updated_at: appSettings.updatedAt
      }).from(appSettings).orderBy(asc(appSettings.key));
      return ok(rows);
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  // GET /api/settings/public (anon: limited config)
  if (path === '/api/settings/public' && req.method === 'GET') {
    const publicKeys = ['slots', 'max_slots_per_day', 'price_total', 'price_deposit', 'price_balance', 'business_name', 'coverage_area'];
    const rows = await db.select({ key: appSettings.key, value: appSettings.value })
      .from(appSettings).where(inArray(appSettings.key, publicKeys));
    const config: Record<string, string> = {};
    for (const row of rows) config[row.key] = row.value || '';
    return ok(config);
  }

  // PUT /api/settings - bulk update (admin only)
  if (path === '/api/settings' && req.method === 'PUT') {
    try {
      const payload = await requireAuth(req, env);
      requireAdmin(payload);
      const { settings } = await req.json() as { settings: Array<{key: string; value: string}> };
      if (!settings || !settings.length) return err('No settings provided');

      const now = nowISO();
      for (const s of settings) {
        await db.insert(appSettings).values({ key: s.key, value: s.value, updatedAt: now })
          .onConflictDoUpdate({
            target: appSettings.key,
            set: { value: s.value, updatedAt: now }
          });
      }
      return ok({ updated: settings.length });
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  // GET /api/settings/private (admin only)
  if (path === '/api/settings/private' && req.method === 'GET') {
    try {
      const payload = await requireAuth(req, env);
      requireAdmin(payload);
      const rows = await db.select({ key: privateSettings.key, value: privateSettings.value }).from(privateSettings);
      return ok(rows);
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  // PUT /api/settings/private (admin only)
  if (path === '/api/settings/private' && req.method === 'PUT') {
    try {
      const payload = await requireAuth(req, env);
      requireAdmin(payload);
      const { settings } = await req.json() as { settings: Array<{key: string; value: string}> };
      if (!settings || !settings.length) return err('No settings provided');

      for (const s of settings) {
        await db.insert(privateSettings).values({ key: s.key, value: s.value })
          .onConflictDoUpdate({ target: privateSettings.key, set: { value: s.value } });
      }
      return ok({ updated: settings.length });
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  return err('Not found', 404);
}
