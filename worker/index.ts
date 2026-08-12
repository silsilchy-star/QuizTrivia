export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

function getCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return null;
  const match = cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function handleSession(request: Request, env: Env): Promise<Response> {
  let uid = getCookie(request, 'session');

  if (uid) {
    const existing = await env.DB.prepare('SELECT uid FROM users WHERE uid = ?').bind(uid).first();
    if (!existing) uid = null;
  }

  const isNew = !uid;
  if (isNew) {
    uid = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      'INSERT INTO users (uid, is_anonymous, created_at, updated_at) VALUES (?, 1, ?, ?)',
    )
      .bind(uid, now, now)
      .run();
  }

  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (isNew) {
    headers.append(
      'Set-Cookie',
      `session=${uid}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 365}`,
    );
  }

  return new Response(JSON.stringify({ uid }), { headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/session' && request.method === 'POST') {
      return handleSession(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
