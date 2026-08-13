// 세션 토큰 서명.
//
// 예전에는 쿠키 값이 곧 users.uid(PK)였다. uid를 아는 사람은 누구나 그 계정이
// 될 수 있었고, 폐기할 방법도 없었다. 여기서 검증하는 것은 "uid를 알아도
// 서명을 만들 수 없다"는 성질이다.
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { SESSION_MAX_AGE, issueToken, verifyToken } from '../worker/session';
import { createPlayableTopic, createUser } from './helpers';

const SECRET = { SESSION_SECRET: 'test-secret-1234567890' };
const OTHER = { SESSION_SECRET: 'different-secret-0987654321' };
const UID = '11111111-2222-4333-8444-555555555555';

describe('토큰 발급과 검증', () => {
  it('발급한 토큰은 같은 비밀키로 검증된다', async () => {
    const token = await issueToken(SECRET, UID);
    const verified = await verifyToken(SECRET, token);
    expect(verified?.uid).toBe(UID);
    expect(verified?.legacy).toBe(false);
    expect(verified?.stale).toBe(false);
  });

  it('토큰에 uid가 그대로 담기지만, 서명 없이는 쓸 수 없다', async () => {
    const token = await issueToken(SECRET, UID);
    expect(token).toContain(UID);
    expect(token.split('.')).toHaveLength(4);
  });

  it('다른 비밀키로 서명된 토큰은 거부한다', async () => {
    const token = await issueToken(OTHER, UID);
    expect(await verifyToken(SECRET, token)).toBeNull();
  });

  it('서명을 고치면 거부한다', async () => {
    const token = await issueToken(SECRET, UID);
    const parts = token.split('.');
    parts[3] = parts[3].slice(0, -2) + 'AA';
    expect(await verifyToken(SECRET, parts.join('.'))).toBeNull();
  });

  // 핵심 성질 — 남의 uid를 알아도 그 사람이 될 수 없다.
  it('uid만 바꿔치기한 토큰은 거부한다', async () => {
    const token = await issueToken(SECRET, UID);
    const parts = token.split('.');
    parts[1] = '99999999-8888-4777-8666-555555555555';
    expect(await verifyToken(SECRET, parts.join('.'))).toBeNull();
  });

  it('발급 시각을 앞당겨 수명을 늘리려 해도 거부한다', async () => {
    const token = await issueToken(SECRET, UID);
    const parts = token.split('.');
    parts[2] = String(Number(parts[2]) + 86400);
    expect(await verifyToken(SECRET, parts.join('.'))).toBeNull();
  });

  it('형식이 깨진 토큰은 거부한다', async () => {
    for (const bad of ['', 'garbage', 'v1.abc', 'v1.' + UID + '.notanumber.sig', 'v2.' + UID + '.1.sig']) {
      expect(await verifyToken(SECRET, bad), bad).toBeNull();
    }
  });
});

describe('토큰 수명', () => {
  const now = 1_800_000_000;

  it('유효기간을 넘긴 토큰은 거부한다', async () => {
    const token = await issueToken(SECRET, UID, now - SESSION_MAX_AGE - 10);
    expect(await verifyToken(SECRET, token, now)).toBeNull();
  });

  it('유효기간 안이면 통과한다', async () => {
    const token = await issueToken(SECRET, UID, now - SESSION_MAX_AGE + 100);
    expect((await verifyToken(SECRET, token, now))?.uid).toBe(UID);
  });

  it('수명이 절반 아래로 내려가면 갱신 대상(stale)으로 표시된다', async () => {
    const fresh = await issueToken(SECRET, UID, now - 10);
    const aged = await issueToken(SECRET, UID, now - SESSION_MAX_AGE / 2 - 10);
    expect((await verifyToken(SECRET, fresh, now))?.stale).toBe(false);
    expect((await verifyToken(SECRET, aged, now))?.stale).toBe(true);
  });

  it('미래에 발급된 토큰은 거부한다 — 시계 오차 정도만 봐준다', async () => {
    expect(await verifyToken(SECRET, await issueToken(SECRET, UID, now + 30), now)).not.toBeNull();
    expect(await verifyToken(SECRET, await issueToken(SECRET, UID, now + 3600), now)).toBeNull();
  });
});

describe('옛 쿠키(서명 없는 uid) 전환', () => {
  it('서명 도입 전에 발급된 uid 쿠키를 계속 받아준다 — 기존 사용자가 로그아웃되지 않게', async () => {
    const verified = await verifyToken(SECRET, UID);
    expect(verified?.uid).toBe(UID);
    expect(verified?.legacy).toBe(true);
    expect(verified?.stale).toBe(true); // 갈아끼워야 한다는 표시
  });

  it('uuid 형식이 아닌 값은 옛 쿠키로도 받아주지 않는다', async () => {
    expect(await verifyToken(SECRET, 'not-a-uuid')).toBeNull();
    expect(await verifyToken(SECRET, '../../etc/passwd')).toBeNull();
  });

  it('SESSION_SECRET이 없으면 서명 없이 동작한다 — 비밀키 설정 전에도 배포가 깨지지 않게', async () => {
    const noSecret = {};
    const token = await issueToken(noSecret, UID);
    expect(token).toBe(UID);
    expect((await verifyToken(noSecret, token))?.uid).toBe(UID);
  });

  it('SESSION_SECRET이 없는데 서명된 토큰이 오면 거부한다 — 검증할 방법이 없으므로', async () => {
    const token = await issueToken(SECRET, UID);
    expect(await verifyToken({}, token)).toBeNull();
  });
});

describe('워커 전체에서의 세션 동작', () => {
  async function post(path: string, cookie?: string): Promise<Response> {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (cookie) headers.set('Cookie', cookie);
    return SELF.fetch(`https://example.com${path}`, { method: 'POST', headers, redirect: 'manual' });
  }

  it('세션 응답에 uid가 들어있지 않다', async () => {
    const res = await post('/api/session');
    const raw = await res.text();
    expect(raw).not.toContain('uid');
    expect(JSON.parse(raw)).toEqual({ isAnonymous: true, nickname: null });
  });

  it('위조한 쿠키로는 아무것도 못 한다', async () => {
    // 실제로 존재하는 유저의 uid를 쿠키에 그대로 넣어본다.
    const victim = await createUser({ isAnonymous: false, nickname: '피해자' });
    const topicId = await createPlayableTopic();

    const forged = await SELF.fetch('https://example.com/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `session=${victim}.9999999999.ZmFrZQ` },
      body: JSON.stringify({ topicId }),
    });
    expect(forged.status).toBe(401);
  });

  it('발급받은 쿠키로는 판을 시작할 수 있다', async () => {
    const topicId = await createPlayableTopic();
    const res = await post('/api/session');
    const setCookie = res.headers.get('Set-Cookie')!;
    const session = setCookie.match(/session=([^;]*)/)![1];

    const ok = await SELF.fetch('https://example.com/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `session=${session}` },
      body: JSON.stringify({ topicId }),
    });
    expect(ok.status).toBe(200);
  });

  it('옛 uid 쿠키로 접속하면 서명된 쿠키로 갈아끼워준다', async () => {
    const uid = await createUser({});
    const res = await post('/api/session', `session=${uid}`);
    const setCookie = res.headers.get('Set-Cookie');

    expect(setCookie).toBeTruthy();
    const reissued = setCookie!.match(/session=([^;]*)/)![1];
    expect(reissued).not.toBe(uid);
    // 갈아끼운 쿠키는 같은 계정을 가리켜야 한다 — 기록이 끊기면 안 된다.
    expect((await verifyToken(env, reissued))?.uid).toBe(uid);
  });

  it('없는 계정을 가리키는 쿠키는 새 세션을 만든다', async () => {
    const res = await post('/api/session', `session=${UID}`);
    expect(res.headers.get('Set-Cookie')).toBeTruthy();
    expect(await res.json()).toEqual({ isAnonymous: true, nickname: null });
  });
});
