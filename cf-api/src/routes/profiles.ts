import { desc, eq } from 'drizzle-orm';
import type { Env } from '../types';
import { err, ok, uuid, hashPassword } from '../utils/helpers';
import { requireAuth, requireAdmin } from '../utils/middleware';
import { createDb } from '../db/client';
import { profiles as profilesTable } from '../db/schema';

const profileFields = {
  id: profilesTable.id,
  full_name: profilesTable.fullName,
  phone: profilesTable.phone,
  role: profilesTable.role,
  is_active: profilesTable.isActive,
  email: profilesTable.email,
  address: profilesTable.address,
  avatar_url: profilesTable.avatarUrl,
  service_area: profilesTable.serviceArea,
  created_at: profilesTable.createdAt
};

export async function handleProfiles(req: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(req.url);
  const db = createDb(env);

  // GET /api/profiles
  if (path === '/api/profiles' && req.method === 'GET') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'admin') {
        // Staff can only see their own profile
        const profile = await db.select(profileFields).from(profilesTable)
          .where(eq(profilesTable.id, payload.sub)).get();
        return profile ? ok(profile) : err('Not found', 404);
      }
      const role = url.searchParams.get('role');
      const rows = role === 'admin' || role === 'staff'
        ? await db.select(profileFields).from(profilesTable).where(eq(profilesTable.role, role)).orderBy(desc(profilesTable.createdAt))
        : await db.select(profileFields).from(profilesTable).orderBy(desc(profilesTable.createdAt));
      return ok(rows);
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  // POST /api/profiles (admin: create staff)
  if (path === '/api/profiles' && req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      requireAdmin(payload);
      const body = await req.json() as any;

      if (!body.full_name || !body.phone) return err('full_name and phone required');
      if (!body.password || String(body.password).length < 8) return err('Password must be at least 8 characters');

      const phoneDigits = body.phone.replace(/\D/g, '');
      const existing = await db.select({ id: profilesTable.id }).from(profilesTable)
        .where(eq(profilesTable.phone, phoneDigits)).get();
      if (existing) return err('Phone number already exists', 409);

      const userId = uuid();
      const hashed = await hashPassword(String(body.password));
      const email = String(body.email || `${phoneDigits}@staff.jayabina.local`).trim().toLowerCase();

      await db.insert(profilesTable).values({
        id: userId,
        fullName: String(body.full_name).trim(),
        phone: phoneDigits,
        role: 'staff',
        isActive: body.is_active !== false ? 1 : 0,
        email,
        address: body.address || '',
        avatarUrl: body.avatar_url || '',
        serviceArea: body.service_area || '',
        password: hashed
      });

      return ok({ id: userId, phone: phoneDigits, full_name: String(body.full_name).trim(), role: 'staff' });
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  // PATCH /api/profiles/:id
  const patchMatch = path.match(/^\/api\/profiles\/([a-f0-9-]+)$/);
  if (patchMatch && req.method === 'PATCH') {
    try {
      const payload = await requireAuth(req, env);
      const profileId = patchMatch[1];
      const body = await req.json() as any;
      const existing = await db.select({ id: profilesTable.id }).from(profilesTable)
        .where(eq(profilesTable.id, profileId)).get();
      if (!existing) return err('Profile not found', 404);

      // Staff can only update own profile (limited fields)
      if (payload.role !== 'admin' && payload.sub !== profileId) {
        return err('Access denied', 403);
      }

      const updates: Partial<typeof profilesTable.$inferInsert> = {};

      if (payload.role === 'admin') {
        if (body.full_name !== undefined) updates.fullName = body.full_name;
        if (body.phone !== undefined) updates.phone = body.phone.replace(/\D/g, '');
        if (body.is_active !== undefined) updates.isActive = body.is_active ? 1 : 0;
        if (body.service_area !== undefined) updates.serviceArea = body.service_area;
        if (body.role !== undefined && payload.sub !== profileId) updates.role = body.role;
      }

      // Fields anyone can update on their own profile
      if (body.email !== undefined) updates.email = String(body.email).trim().toLowerCase();
      if (body.address !== undefined) updates.address = body.address;
      if (body.avatar_url !== undefined) updates.avatarUrl = body.avatar_url;

      if (Object.keys(updates).length === 0) return err('No fields to update');

      await db.update(profilesTable).set(updates).where(eq(profilesTable.id, profileId));

      const updated = await db.select(profileFields).from(profilesTable)
        .where(eq(profilesTable.id, profileId)).get();
      return ok(updated);
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  // POST /api/profiles/bulk (admin: bulk create staff)
  if (path === '/api/profiles/bulk' && req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      requireAdmin(payload);
      const { staff } = await req.json() as { staff: any[] };
      if (!staff || !staff.length) return err('No staff provided');

      const results = [];
      for (const s of staff) {
        if (!s || !s.full_name || !s.phone || !s.password || String(s.password).length < 8) {
          results.push({ phone: s?.phone || '', error: 'Name, phone and password (min 8 characters) required' });
          continue;
        }
        const phoneDigits = s.phone.replace(/\D/g, '');
        const existing = await db.select({ id: profilesTable.id }).from(profilesTable)
          .where(eq(profilesTable.phone, phoneDigits)).get();
        if (existing) { results.push({ phone: s.phone, error: 'Already exists' }); continue; }

        const userId = uuid();
        const hashed = await hashPassword(String(s.password));

        await db.insert(profilesTable).values({
          id: userId,
          fullName: s.full_name,
          phone: phoneDigits,
          role: 'staff',
          isActive: 1,
          email: `${phoneDigits}@staff.jayabina.local`,
          password: hashed
        });

        results.push({ ok: true, phone: s.phone, id: userId, name: s.full_name });
      }
      return ok(results);
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  return err('Not found', 404);
}
