// 세션 쿠키 발급·검증.
//
// 예전에는 쿠키 값이 곧 users.uid(PK)였다. 서명도 만료도 폐기 수단도 없는
// 순수 베어러 토큰이라, uid가 한 번 새어나가면 그 계정은 영구히 탈취되고
// 막을 방법이 없었다. 지금은 HMAC으로 서명하고 발급 시각을 함께 넣는다.
//
// 토큰 형식:  v1.<uid>.<발급시각(초)>.<서명>
//   서명 = HMAC-SHA256(SESSION_SECRET, "v1.<uid>.<발급시각>")
//
// 서명 검증은 crypto.subtle.verify로 한다 — 상수 시간 비교라 타이밍 공격에
// 안전하고, 직접 문자열을 비교하는 것보다 낫다.

const SESSION_COOKIE = 'session';
/** 쿠키 수명이자 토큰 자체의 유효기간. 서버가 발급 시각을 검증하므로,
 *  클라이언트가 쿠키를 오래 들고 있어도 만료된 토큰은 통하지 않는다. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365;
/** 남은 수명이 절반 아래로 내려가면 /api/session에서 갱신해준다. */
const REISSUE_AFTER = SESSION_MAX_AGE / 2;

const VERSION = 'v1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface SessionEnv {
  SESSION_SECRET?: string;
}

/** 검증 결과. legacy=true면 서명 없는 옛 쿠키라 갱신해줘야 한다. */
export interface VerifiedSession {
  uid: string;
  legacy: boolean;
  stale: boolean;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
    keyCache.set(secret, key);
  }
  return key;
}

function toBase64Url(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array | null {
  try {
    const padded = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function getCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return null;
  const match = cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** 서명된 세션 토큰을 만든다. SESSION_SECRET이 없으면 uid를 그대로 쓴다. */
export async function issueToken(env: SessionEnv, uid: string, nowSec?: number): Promise<string> {
  if (!env.SESSION_SECRET) return uid;
  const issuedAt = nowSec ?? Math.floor(Date.now() / 1000);
  const payload = `${VERSION}.${uid}.${issuedAt}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET), new TextEncoder().encode(payload));
  return `${payload}.${toBase64Url(sig)}`;
}

/** 토큰을 검증해 uid를 꺼낸다. DB 조회는 하지 않는다 — 호출부의 몫이다. */
export async function verifyToken(env: SessionEnv, token: string, nowSec?: number): Promise<VerifiedSession | null> {
  const now = nowSec ?? Math.floor(Date.now() / 1000);

  const parts = token.split('.');
  if (parts.length === 4 && parts[0] === VERSION) {
    // SESSION_SECRET이 없는데 서명된 토큰이 오면 검증할 방법이 없다 — 거부한다.
    if (!env.SESSION_SECRET) return null;

    const [, uid, issuedAtRaw, sigRaw] = parts;
    if (!UUID_RE.test(uid)) return null;

    const issuedAt = Number(issuedAtRaw);
    if (!Number.isInteger(issuedAt) || issuedAt <= 0) return null;
    const age = now - issuedAt;
    // 미래에 발급된 토큰(시계 오차 이상)도 거부한다.
    if (age < -60 || age > SESSION_MAX_AGE) return null;

    const sig = fromBase64Url(sigRaw);
    if (!sig) return null;

    const ok = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(env.SESSION_SECRET),
      sig,
      new TextEncoder().encode(`${VERSION}.${uid}.${issuedAtRaw}`),
    );
    if (!ok) return null;

    return { uid, legacy: false, stale: age > REISSUE_AFTER };
  }

  // 서명 도입 이전에 발급된 쿠키(uid 그대로). 이걸 계속 받아주지 않으면 기존
  // 사용자가 전부 로그아웃되고 익명 기록을 잃는다. /api/session이 접속할 때마다
  // 서명된 쿠키로 갈아끼워주므로, 활동 중인 사용자는 자연히 넘어간다.
  //
  // ⚠ 이 경로가 살아있는 동안은 서명의 효과가 없다. 사용자 대부분이 넘어간
  // 뒤에 ACCEPT_LEGACY를 false로 내려서 닫을 것 (README 참고).
  if (ACCEPT_LEGACY && UUID_RE.test(token)) {
    return { uid: token, legacy: true, stale: true };
  }

  return null;
}

/** 서명 없는 옛 쿠키를 계속 받아줄지. 전환이 끝나면 false로 내린다. */
export const ACCEPT_LEGACY = true;

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`;
}

export function readSessionCookie(request: Request): string | null {
  return getCookie(request, SESSION_COOKIE);
}
