import type { Env } from '../types';
import { signJWT, verifyPassword, hashPassword, err, ok } from '../utils/helpers';
import { requireAuth, requireAdmin } from '../utils/middleware';

export async function handleAuth(req: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(req.url);

  // POST /api/auth/login
  if (path === '/api/auth/login' && req.method === 'POST') {
    const { email, password, phone } = await req.json() as any;
    let user;

    if (email) {
      user = await env.DB.prepare('SELECT * FROM profiles WHERE lower(email) = lower(?) AND is_active = 1')
        .bind(String(email).trim()).first();
    } else if (phone) {
      const digits = phone.replace(/\D/g, '');
      user = await env.DB.prepare('SELECT * FROM profiles WHERE phone = ? AND is_active = 1')
        .bind(digits).first();
    }

    if (!user) return err('Invalid credentials', 401);

    // Password hashes cannot be exported from Supabase Auth. Migrated staff
    // accounts must be reset by an admin instead of allowing first-use claims.
    if (!(user as any).password) {
      return err('Password reset required. Contact the administrator.', 403);
    }

    const valid = await verifyPassword(password, (user as any).password);
    if (!valid) return err('Invalid credentials', 401);

    const token = await signJWT({ sub: (user as any).id, role: (user as any).role, name: (user as any).full_name }, env.JWT_SECRET);

    return ok({
      token,
      user: {
        id: (user as any).id,
        full_name: (user as any).full_name,
        phone: (user as any).phone,
        email: (user as any).email,
        role: (user as any).role,
        avatar_url: (user as any).avatar_url,
        service_area: (user as any).service_area
      }
    });
  }

  // GET /api/auth/me
  if (path === '/api/auth/me' && req.method === 'GET') {
    try {
      const payload = await requireAuth(req, env);
      const user = await env.DB.prepare('SELECT id, full_name, phone, email, role, is_active, avatar_url, service_area, address, created_at FROM profiles WHERE id = ?')
        .bind(payload.sub).first();
      if (!user) return err('User not found', 404);
      return ok(user);
    } catch (e: any) {
      return err(e.msg || 'Unauthorized', e.status || 401);
    }
  }

  // POST /api/auth/change-password
  if (path === '/api/auth/change-password' && req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      const { current_password, new_password } = await req.json() as any;
      if (!new_password || (new_password as string).length < 8) return err('Password must be at least 8 characters');

      const user = await env.DB.prepare('SELECT password FROM profiles WHERE id = ?').bind(payload.sub).first<{password: string}>();
      if (!user || !(await verifyPassword(current_password || '', user.password))) {
        return err('Current password is incorrect', 403);
      }

      const hashed = await hashPassword(new_password);
      await env.DB.prepare('UPDATE profiles SET password = ? WHERE id = ?').bind(hashed, payload.sub).run();
      return ok({ message: 'Password changed' });
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  // POST /api/auth/reset-password (admin only)
  if (path === '/api/auth/reset-password' && req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      requireAdmin(payload);
      const { user_id, new_password } = await req.json() as any;
      if (!new_password || (new_password as string).length < 8) return err('Password must be at least 8 characters');

      const hashed = await hashPassword(new_password);
      await env.DB.prepare('UPDATE profiles SET password = ? WHERE id = ?').bind(hashed, user_id).run();
      return ok({ message: 'Password reset' });
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  return err('Not found', 404);
}
