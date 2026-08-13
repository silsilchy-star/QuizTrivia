// 소셜 로그인 + 계정 승계 (PLAN 5.4절). OAuth 프로토콜 배관(state/PKCE 생성,
// 토큰 교환)만 Arctic에 맡기고, 계정 승계 로직은 우리 스키마에 맞게 직접 짠다 —
// 이건 어떤 라이브러리도 대신해주지 않는 우리 프로젝트 고유의 부분이다.
import { Google, generateCodeVerifier, generateState } from 'arctic';
import { refreshGlobalCaches } from './ranking';
import { getCookie, issueToken, readSessionCookie, sessionCookie, verifyToken } from './session';

export interface AuthEnv {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET?: string;
}

const OAUTH_COOKIE = 'oauth';

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

function googleClient(env: AuthEnv, request: Request): Google {
  const redirectUri = `${new URL(request.url).origin}/api/auth/google/callback`;
  return new Google(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri);
}

function redirectHome(reason: string, extraCookie: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `/?auth=error&reason=${reason}`, 'Set-Cookie': extraCookie },
  });
}

/** 익명으로 플레이하던 uid는 세션 쿠키가 이미 들고 있다. 여기서는 CSRF 방어용
 *  state와 PKCE verifier만 남긴다.
 *
 *  ⚠ 예전에는 이 쿠키에 uid도 같이 넣고 콜백이 그 값을 그대로 믿었다. 이 쿠키는
 *  서명되지 않으므로, 남의 uid를 적어 넣고 자기 구글 계정으로 로그인하면 그
 *  계정에 자기 google_sub가 연결되고 세션까지 넘어왔다 — 계정 탈취다. 이제
 *  uid는 서명된 세션 쿠키에서만 읽는다. */
export async function handleAuthGoogleStart(request: Request, env: AuthEnv, _uid: string): Promise<Response> {
  const google = googleClient(env, request);
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = google.createAuthorizationURL(state, codeVerifier, ['openid', 'email']);

  const payload = encodeURIComponent(JSON.stringify({ state, codeVerifier }));
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Set-Cookie': `${OAUTH_COOKIE}=${payload}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=600`,
    },
  });
}

export async function handleAuthGoogleCallback(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const raw = getCookie(request, OAUTH_COOKIE);
  const clearOauth = `${OAUTH_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=0`;

  if (!code || !state || !raw) return redirectHome('missing_params', clearOauth);

  let saved: { state: string; codeVerifier: string };
  try {
    saved = JSON.parse(decodeURIComponent(raw));
  } catch {
    return redirectHome('bad_cookie', clearOauth);
  }
  if (!saved.state || saved.state !== state) return redirectHome('state_mismatch', clearOauth);

  // 승계 대상 uid는 서명된 세션 쿠키에서만 읽는다 — 클라이언트가 고를 수 없다.
  const token = readSessionCookie(request);
  const current = token ? await verifyToken(env, token) : null;
  if (!current) return redirectHome('no_session', clearOauth);
  const currentUid = current.uid;

  const google = googleClient(env, request);
  let accessToken: string;
  try {
    const tokens = await google.validateAuthorizationCode(code, saved.codeVerifier);
    accessToken = tokens.accessToken();
  } catch {
    return redirectHome('token_exchange_failed', clearOauth);
  }

  const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!profileRes.ok) return redirectHome('profile_fetch_failed', clearOauth);
  const profile = (await profileRes.json()) as { sub: string; email?: string };

  const now = new Date().toISOString();

  // 이 구글 계정이 이미 다른 uid에 연결돼 있으면 그 계정으로 전환한다.
  // "기존 계정 기록 유지 · 익명 기록 폐기" (PLAN 5.4절 MVP 결정) — 지금 세션의
  // 익명 uid는 그냥 버려진다(별도 삭제 없이 더 이상 어떤 쿠키도 가리키지 않게 됨).
  const existing = await env.DB.prepare('SELECT uid FROM users WHERE google_sub = ? AND uid != ?')
    .bind(profile.sub, currentUid)
    .first<{ uid: string }>();

  let finalUid = currentUid;
  let outcome: 'linked' | 'switched' = 'linked';

  if (existing) {
    finalUid = existing.uid;
    outcome = 'switched';
    await env.DB.prepare('UPDATE users SET email = ?, updated_at = ? WHERE uid = ?')
      .bind(profile.email ?? null, now, finalUid)
      .run();
  } else {
    await env.DB.prepare(
      'UPDATE users SET google_sub = ?, email = ?, is_anonymous = 0, updated_at = ? WHERE uid = ?',
    )
      .bind(profile.sub, profile.email ?? null, now, currentUid)
      .run();
  }

  // 로그인 순간 이 uid가 처음으로 랭킹 집계 대상(is_anonymous=0)이 되므로,
  // 익명일 때 쌓아둔 기존 최고점이 다음 판을 기다리지 않고 바로 반영되게 한다.
  await refreshGlobalCaches(env, now);

  const headers = new Headers({ Location: `/?auth=${outcome}` });
  headers.append('Set-Cookie', clearOauth);
  headers.append('Set-Cookie', sessionCookie(await issueToken(env, finalUid)));
  return new Response(null, { status: 302, headers });
}

export async function handleSetNickname(request: Request, env: AuthEnv, uid: string): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { nickname?: string } | null;
  const nickname = body?.nickname?.trim();
  if (!nickname || nickname.length < 1 || nickname.length > 20) {
    return json({ error: 'nickname must be 1-20 characters' }, { status: 400 });
  }
  await env.DB.prepare('UPDATE users SET nickname = ?, updated_at = ? WHERE uid = ?')
    .bind(nickname, new Date().toISOString(), uid)
    .run();
  return json({ nickname });
}
