// 레이트리밋.
//
// 이 서비스에는 한 곳도 제한이 없었다. 특히 /api/session은 쿠키 없이 부를
// 때마다 users 행을 무제한으로 만들 수 있었다 — D1 행 한도를 채워 서비스를
// 통째로 멈출 수 있는 구멍이다.
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  CREATE_TOPIC,
  NEW_SESSION,
  type RateLimitRule,
  checkRateLimit,
  clientIp,
} from '../worker/ratelimit';
import { Client, logIn, newSession, uniqueId } from './helpers';

const RULE: RateLimitRule = { action: 'test', limit: 3, windowSec: 60 };

/** 헬퍼의 Client가 쓰는 10.x 대역과 겹치지 않는 별도 대역. 이 파일은 IP당
 *  한도를 일부러 소진시키므로, 다른 테스트의 IP와 겹치면 그쪽이 깨진다. */
function testIp(): string {
  const octet = () => Math.floor(Math.random() * 256);
  return `172.16.${octet()}.${octet()}`;
}

describe('카운터', () => {
  it('한도까지는 통과하고 넘으면 막는다', async () => {
    const subject = uniqueId('subj');
    for (let i = 0; i < RULE.limit; i += 1) {
      expect((await checkRateLimit(env, RULE, subject)).ok, `${i + 1}번째는 통과해야 한다`).toBe(true);
    }
    expect((await checkRateLimit(env, RULE, subject)).ok).toBe(false);
  });

  it('주체가 다르면 서로 영향이 없다', async () => {
    const a = uniqueId('subj');
    const b = uniqueId('subj');
    for (let i = 0; i < RULE.limit + 2; i += 1) await checkRateLimit(env, RULE, a);

    expect((await checkRateLimit(env, RULE, a)).ok).toBe(false);
    expect((await checkRateLimit(env, RULE, b)).ok).toBe(true);
  });

  it('행동이 다르면 서로 영향이 없다', async () => {
    const subject = uniqueId('subj');
    const other: RateLimitRule = { ...RULE, action: 'test-other' };
    for (let i = 0; i < RULE.limit + 2; i += 1) await checkRateLimit(env, RULE, subject);

    expect((await checkRateLimit(env, RULE, subject)).ok).toBe(false);
    expect((await checkRateLimit(env, other, subject)).ok).toBe(true);
  });

  it('창이 바뀌면 카운터가 초기화된다', async () => {
    const subject = uniqueId('subj');
    const now = 1_800_000_000;
    for (let i = 0; i < RULE.limit + 2; i += 1) await checkRateLimit(env, RULE, subject, now);
    expect((await checkRateLimit(env, RULE, subject, now)).ok).toBe(false);

    // 다음 창으로 넘어가면 다시 통과해야 한다.
    expect((await checkRateLimit(env, RULE, subject, now + RULE.windowSec)).ok).toBe(true);
  });

  it('막혔을 때 창이 끝날 때까지 남은 시간을 알려준다', async () => {
    const subject = uniqueId('subj');
    const now = 1_800_000_000 + 10; // 창 시작 후 10초
    const result = await checkRateLimit(env, RULE, subject, now);
    expect(result.retryAfterSec).toBe(RULE.windowSec - 10);
  });
});

describe('clientIp', () => {
  const withHeaders = (h: Record<string, string>) =>
    clientIp(new Request('https://example.com', { headers: h }));

  it('CF-Connecting-IP를 우선한다', () => {
    expect(withHeaders({ 'CF-Connecting-IP': '1.2.3.4', 'X-Forwarded-For': '9.9.9.9' })).toBe('1.2.3.4');
  });

  it('X-Forwarded-For는 첫 항목만 쓴다', () => {
    expect(withHeaders({ 'X-Forwarded-For': '1.2.3.4, 5.6.7.8' })).toBe('1.2.3.4');
  });

  // 헤더가 없다고 무제한이 되면 안 된다 — 한 덩어리로 묶어서라도 세야 한다.
  it('헤더가 없으면 고정 키로 묶는다', () => {
    expect(withHeaders({})).toBe('unknown');
  });
});

describe('/api/session — 익명 계정 무한 생성 차단', () => {
  it('쿠키 없이 계속 두드리면 결국 429가 나온다', async () => {
    const ip = testIp();
    const call = () =>
      SELF.fetch('https://example.com/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
      });

    let blocked: Response | null = null;
    for (let i = 0; i < NEW_SESSION.limit + 1; i += 1) {
      const res = await call();
      if (res.status === 429) {
        blocked = res;
        break;
      }
    }

    expect(blocked, `${NEW_SESSION.limit + 1}번 안에 막혔어야 한다`).not.toBeNull();
    expect(blocked!.headers.get('Retry-After')).toBeTruthy();
  });

  it('이미 세션이 있으면 제한에 걸리지 않는다 — 새로고침으로 막히면 안 된다', async () => {
    const ip = testIp();
    const first = await SELF.fetch('https://example.com/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    });
    const cookie = first.headers.get('Set-Cookie')!.match(/session=([^;]*)/)![1];

    // 계정을 새로 만들지 않는 경로라 몇 번을 불러도 통과해야 한다.
    for (let i = 0; i < NEW_SESSION.limit + 5; i += 1) {
      const res = await SELF.fetch('https://example.com/api/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': ip,
          Cookie: `session=${cookie}`,
        },
      });
      expect(res.status).toBe(200);
    }
  });
});

describe('창작마당 생성 제한', () => {
  it('주제를 한도 이상 만들 수 없다', async () => {
    const client = await newSession();
    await logIn(client, '대량생성자');

    let blocked = false;
    for (let i = 0; i < CREATE_TOPIC.limit + 1; i += 1) {
      const res = await client.fetch('/api/community/topics', {
        method: 'POST',
        body: JSON.stringify({ name: `주제${i}` }),
      });
      if (res.status === 429) {
        blocked = true;
        break;
      }
    }
    expect(blocked).toBe(true);
  });

  it('제한은 유저별이다 — 남이 많이 만들어도 나는 만들 수 있다', async () => {
    const heavy = await newSession();
    await logIn(heavy, '헤비유저');
    for (let i = 0; i < CREATE_TOPIC.limit + 1; i += 1) {
      await heavy.fetch('/api/community/topics', {
        method: 'POST',
        body: JSON.stringify({ name: `헤비주제${i}` }),
      });
    }

    const normal = await newSession();
    await logIn(normal, '보통유저');
    const res = await normal.fetch('/api/community/topics', {
      method: 'POST',
      body: JSON.stringify({ name: '보통주제' }),
    });
    expect(res.status).toBe(200);
  });

  it('로그인하지 않은 요청은 제한을 소모하지 않는다 — 403이 먼저 걸린다', async () => {
    const anon = await newSession();
    for (let i = 0; i < CREATE_TOPIC.limit + 3; i += 1) {
      const res = await anon.fetch('/api/community/topics', {
        method: 'POST',
        body: JSON.stringify({ name: '익명주제' }),
      });
      expect(res.status).toBe(403);
    }
  });
});

describe('만료된 카운터 정리', () => {
  it('만료 시각이 지난 행은 지울 수 있다', async () => {
    const subject = uniqueId('subj');
    const past = 1_000_000_000;
    await checkRateLimit(env, RULE, subject, past);

    const before = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM rate_limits WHERE expires_at < ?',
    )
      .bind(past + RULE.windowSec + 1)
      .first<{ n: number }>();
    expect(before!.n).toBeGreaterThan(0);

    await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?')
      .bind(past + RULE.windowSec + 1)
      .run();

    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM rate_limits WHERE bucket LIKE ?')
      .bind(`test:${subject}:%`)
      .first<{ n: number }>();
    expect(after!.n).toBe(0);
  });
});

describe('제한이 정상 플레이를 막지 않는다', () => {
  it('연달아 여러 판을 시작해도 통과한다', async () => {
    const client: Client = await newSession();
    const { createPlayableTopic } = await import('./helpers');
    const topicId = await createPlayableTopic();

    for (let i = 0; i < 10; i += 1) {
      const res = await client.fetch('/api/runs', {
        method: 'POST',
        body: JSON.stringify({ topicId }),
      });
      expect(res.status).toBe(200);
    }
  });
});
