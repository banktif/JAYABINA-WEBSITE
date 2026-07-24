import type { Env } from '../types';
import { err, ok } from '../utils/helpers';
import { requireAuth } from '../utils/middleware';

export async function handleEmail(req: Request, env: Env, path: string): Promise<Response> {
  // POST /api/email/send
  if (path === '/api/email/send' && req.method === 'POST') {
    try {
      await requireAuth(req, env);
      const { to, subject, html } = await req.json() as any;

      if (!to || !subject || !html) return err('Missing to, subject, or html');

      const apiKey = env.RESEND_API_KEY;
      if (!apiKey) return err('Email not configured (RESEND_API_KEY missing)', 503);

      const from = 'JAYABINA <noreply@jayabina.com>';
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, html })
      });

      const data = await resp.json() as any;
      if (!resp.ok) return err(data?.message || 'Email send failed', 502);

      return ok({ id: data.id, message: 'Email sent' });
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  return err('Not found', 404);
}

export async function sendEmailDirect(env: Env, to: string, subject: string, html: string): Promise<boolean> {
  try {
    const apiKey = env.RESEND_API_KEY;
    if (!apiKey) return false;

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'JAYABINA <noreply@jayabina.com>', to: [to], subject, html })
    });
    return resp.ok;
  } catch { return false; }
}
