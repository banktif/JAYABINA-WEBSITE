import type { Env } from '../types';
import { err, ok, uuid, nowISO, hashPassword } from '../utils/helpers';
import { requireAuth, requireAdmin } from '../utils/middleware';

export async function handleProfiles(req: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(req.url);

  // GET /api/profiles
  if (path === '/api/profiles' && req.method === 'GET') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'admin') {
        // Staff can only see their own profile
        const profile = await env.DB.prepare('SELECT id, full_name, phone, role, is_active, email, address, avatar_url, service_area, created_at FROM profiles WHERE id = ?')
          .bind(payload.sub).first();
        return profile ? ok(profile) : err('Not found', 404);
      }
      const role = url.searchParams.get('role');
      const query = role === 'admin' || role === 'staff'
        ? env.DB.prepare('SELECT id, full_name, phone, role, is_active, email, address, avatar_url, service_area, created_at FROM profiles WHERE role = ? ORDER BY created_at DESC').bind(role)
        : env.DB.prepare('SELECT id, full_name, phone, role, is_active, email, address, avatar_url, service_area, created_at FROM profiles ORDER BY created_at DESC');
      const profiles = await query.all();
      return ok(profiles.results);
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
      const existing = await env.DB.prepare('SELECT id FROM profiles WHERE phone = ?').bind(phoneDigits).first();
      if (existing) return err('Phone number already exists', 409);

      const userId = uuid();
      const hashed = await hashPassword(String(body.password));
      const email = String(body.email || `${phoneDigits}@staff.jayabina.local`).trim().toLowerCase();

      await env.DB.prepare(`INSERT INTO profiles (id, full_name, phone, role, is_active, email, address, avatar_url, service_area, password)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind(userId, String(body.full_name).trim(), phoneDigits, 'staff', body.is_active !== false ? 1 : 0,
          email, body.address || '', body.avatar_url || '', body.service_area || '', hashed).run();

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
      const existing = await env.DB.prepare('SELECT id FROM profiles WHERE id = ?').bind(profileId).first();
      if (!existing) return err('Profile not found', 404);

      // Staff can only update own profile (limited fields)
      if (payload.role !== 'admin' && payload.sub !== profileId) {
        return err('Access denied', 403);
      }

      const sets: string[] = [];
      const params: any[] = [];

      if (payload.role === 'admin') {
        if (body.full_name !== undefined) { sets.push('full_name = ?'); params.push(body.full_name); }
        if (body.phone !== undefined) { sets.push('phone = ?'); params.push(body.phone.replace(/\D/g, '')); }
        if (body.is_active !== undefined) { sets.push('is_active = ?'); params.push(body.is_active ? 1 : 0); }
        if (body.service_area !== undefined) { sets.push('service_area = ?'); params.push(body.service_area); }
        if (body.role !== undefined && payload.sub !== profileId) { sets.push('role = ?'); params.push(body.role); }
      }

      // Fields anyone can update on their own profile
      if (body.email !== undefined) { sets.push('email = ?'); params.push(String(body.email).trim().toLowerCase()); }
      if (body.address !== undefined) { sets.push('address = ?'); params.push(body.address); }
      if (body.avatar_url !== undefined) { sets.push('avatar_url = ?'); params.push(body.avatar_url); }

      if (sets.length === 0) return err('No fields to update');

      params.push(profileId);
      await env.DB.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();

      const updated = await env.DB.prepare('SELECT id, full_name, phone, role, is_active, email, address, avatar_url, service_area, created_at FROM profiles WHERE id = ?')
        .bind(profileId).first();
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
        const existing = await env.DB.prepare('SELECT id FROM profiles WHERE phone = ?').bind(phoneDigits).first();
        if (existing) { results.push({ phone: s.phone, error: 'Already exists' }); continue; }

        const userId = uuid();
        const hashed = await hashPassword(String(s.password));

        await env.DB.prepare(`INSERT INTO profiles (id, full_name, phone, role, is_active, email, password)
          VALUES (?,?,?,?,?,?,?)`)
          .bind(userId, s.full_name, phoneDigits, 'staff', 1, `${phoneDigits}@staff.jayabina.local`, hashed).run();

        results.push({ ok: true, phone: s.phone, id: userId, name: s.full_name });
      }
      return ok(results);
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  return err('Not found', 404);
}
