// 런타임 에러 기록.
//
// 지금까지는 워커가 예외를 던져도 그 사실이 아무데도 남지 않았고, 사용자가
// 말해줘야 장애를 알았다. 여기서 검증하는 것은 두 가지다 — 에러가 실제로
// 남는가, 그리고 **기록하다 실패해도 요청이 망가지지 않는가**.
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { logError } from '../worker/errorlog';
import { createPlayableTopic, newSession, uniqueId } from './helpers';

function req(path = '/api/thing', method = 'POST'): Request {
  return new Request(`https://example.com${path}`, { method });
}

async function latestFor(message: string) {
  return env.DB.prepare(
    'SELECT path, method, message, stack, uid FROM error_log WHERE message LIKE ? ORDER BY id DESC LIMIT 1',
  )
    .bind(`%${message}%`)
    .first<{ path: string; method: string; message: string; stack: string | null; uid: string | null }>();
}

describe('에러 기록', () => {
  it('예외의 이름·메시지·스택과 요청 정보를 남긴다', async () => {
    const marker = uniqueId('boom');
    await logError(env, req('/api/runs', 'POST'), new TypeError(marker), 'uid-123');

    const row = await latestFor(marker);
    expect(row).not.toBeNull();
    expect(row!.message).toContain('TypeError');
    expect(row!.message).toContain(marker);
    expect(row!.path).toBe('/api/runs');
    expect(row!.method).toBe('POST');
    expect(row!.uid).toBe('uid-123');
    expect(row!.stack).toBeTruthy();
  });

  it('Error가 아닌 값을 던져도 기록한다', async () => {
    const marker = uniqueId('plain');
    await logError(env, req(), marker);

    const row = await latestFor(marker);
    expect(row!.message).toContain(marker);
    expect(row!.stack).toBeNull();
  });

  // 쿼리스트링에는 OAuth code처럼 그대로 남기면 안 되는 값이 섞인다.
  it('경로만 남기고 쿼리스트링은 버린다', async () => {
    const marker = uniqueId('qs');
    await logError(env, req(`/api/auth/google/callback?code=SECRET-${marker}&state=xyz`, 'GET'), new Error(marker));

    const row = await latestFor(marker);
    expect(row!.path).toBe('/api/auth/google/callback');
    expect(row!.path).not.toContain('code');
    expect(row!.path).not.toContain('SECRET');
  });

  it('아주 긴 메시지와 스택은 잘라서 넣는다', async () => {
    const marker = uniqueId('long');
    const err = new Error(marker + 'x'.repeat(5000));
    err.stack = 'y'.repeat(10000);
    await logError(env, req(), err);

    const row = await latestFor(marker);
    expect(row!.message.length).toBeLessThanOrEqual(501);
    expect(row!.stack!.length).toBeLessThanOrEqual(2001);
  });

  it('uid는 없어도 된다', async () => {
    const marker = uniqueId('anon');
    await logError(env, req(), new Error(marker));
    expect((await latestFor(marker))!.uid).toBeNull();
  });

  // 가장 중요한 성질 — 로깅이 원래 에러보다 더 큰 사고를 내면 안 된다.
  it('기록에 실패해도 예외를 밖으로 던지지 않는다', async () => {
    const broken = {
      DB: {
        prepare() {
          throw new Error('DB가 죽었다');
        },
      },
    } as unknown as Parameters<typeof logError>[0];

    await expect(logError(broken, req(), new Error('원래 에러'))).resolves.toBeUndefined();
  });
});

describe('워커 전체에서의 에러 처리', () => {
  it('알 수 없는 API 경로는 404 — 에러로 기록하지 않는다', async () => {
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM error_log').first<{ n: number }>();

    const res = await SELF.fetch('https://example.com/api/does-not-exist');
    expect(res.status).toBe(404);

    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM error_log').first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
  });

  // 정상 요청이 에러 로그를 더럽히면 진짜 장애를 못 찾는다.
  it('정상 요청은 아무것도 남기지 않는다', async () => {
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM error_log').first<{ n: number }>();

    const res = await SELF.fetch('https://example.com/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.7' },
    });
    expect(res.status).toBe(200);

    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM error_log').first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
  });

  // 실제로 예외가 던져지는 경로를 만들어 catch가 도는지 확인한다.
  // served_json은 서버가 넣은 값이라 정상 흐름에서는 깨질 일이 없지만,
  // 여기서 일부러 깨서 JSON.parse가 던지게 한다.
  it('라우팅 중 예외가 나면 500을 주고 error_log에 남긴다', async () => {
    const client = await newSession();
    const topicId = await createPlayableTopic();
    const run = await client.json<{ runId: string }>('/api/runs', {
      method: 'POST',
      body: JSON.stringify({ topicId }),
    });

    await env.DB.prepare("UPDATE runs SET served_json = '{{{ 깨진 JSON' WHERE id = ?")
      .bind(run.runId)
      .run();

    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM error_log').first<{ n: number }>();

    const res = await client.fetch(`/api/runs/${run.runId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers: [] }),
    });

    expect(res.status).toBe(500);
    // 내부 정보가 사용자에게 새면 안 된다.
    const body = await res.text();
    expect(body).not.toContain('SyntaxError');
    expect(body).not.toContain('served_json');

    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM error_log').first<{ n: number }>();
    expect(after!.n).toBe(before!.n + 1);

    const row = await env.DB.prepare(
      'SELECT path, method, message FROM error_log ORDER BY id DESC LIMIT 1',
    ).first<{ path: string; method: string; message: string }>();
    expect(row!.path).toContain('/submit');
    expect(row!.method).toBe('POST');
  });

  it('잘못된 본문을 보내도 500이 아니라 4xx로 처리된다', async () => {
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM error_log').first<{ n: number }>();

    const res = await SELF.fetch('https://example.com/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{{{ 망가진 JSON',
    });
    expect(res.status).toBeLessThan(500);

    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM error_log').first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
  });
});

describe('보관 한도', () => {
  it('오래된 행부터 지워 상한을 유지한다', async () => {
    const now = new Date().toISOString();
    const stmts = [];
    for (let i = 0; i < 20; i += 1) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO error_log (path, method, message, stack, uid, created_at)
           VALUES ('/x', 'GET', ?, NULL, NULL, ?)`,
        ).bind(`bulk-${i}`, now),
      );
    }
    await env.DB.batch(stmts);

    // errorlog.ts의 정리 쿼리와 같은 형태 — 상한을 5로 두고 동작을 확인한다.
    await env.DB.prepare(
      `DELETE FROM error_log WHERE id NOT IN (SELECT id FROM error_log ORDER BY id DESC LIMIT ?)`,
    )
      .bind(5)
      .run();

    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM error_log').first<{ n: number }>();
    expect(row!.n).toBe(5);

    // 남은 것은 가장 최근 5개여야 한다.
    const kept = await env.DB.prepare('SELECT message FROM error_log ORDER BY id DESC').all<{ message: string }>();
    expect(kept.results!.map((r) => r.message)).toEqual([
      'bulk-19',
      'bulk-18',
      'bulk-17',
      'bulk-16',
      'bulk-15',
    ]);
  });
});
