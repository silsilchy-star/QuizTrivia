// 레이트리밋.
//
// 이 서비스에는 한 곳도 제한이 없었다. 특히 /api/session은 쿠키 없이 부를
// 때마다 users 행을 무제한으로 만들었고, 창작마당 주제·문항 생성에도 개수
// 제한이 없었다. D1은 행 수와 쓰기 횟수에 한도가 있으므로, 이건 서비스를
// 통째로 멈출 수 있는 구멍이다.
//
// 구현은 D1에 카운터를 두는 고정 창(fixed window) 방식이다. Cloudflare의
// 네이티브 rate limiting 바인딩을 쓰지 않은 이유는, 그쪽은 로컬 테스트에서
// 재현하기 어려워 "테스트로 못을 박는다"는 이 프로젝트의 방향과 어긋나기
// 때문이다. 지금 규모에서는 D1 쓰기 한 번이 문제되지 않는다.

export interface RateLimitEnv {
  DB: D1Database;
}

export interface RateLimitRule {
  /** 무엇을 제한하는지 — 버킷 키의 앞부분이 된다. */
  action: string;
  /** 창 하나에서 허용하는 최대 횟수. */
  limit: number;
  /** 창 길이(초). */
  windowSec: number;
}

/** 익명 계정 무한 생성 방지.
 *  한 교실에서 다 같이 처음 들어오는 상황(공용 NAT)을 막으면 안 되므로 넉넉히
 *  잡는다. 스크립트로 긁는 쪽은 이보다 훨씬 빠르므로 이 정도로도 충분히 걸린다. */
export const NEW_SESSION: RateLimitRule = { action: 'session', limit: 100, windowSec: 3600 };
/** 판 시작 — runs 행이 쌓이는 속도를 묶는다. 정상 플레이보다 훨씬 높게. */
export const START_RUN: RateLimitRule = { action: 'run', limit: 120, windowSec: 3600 };
/** 창작마당 주제 생성. 하루에 이보다 많이 만들 이유가 없다. */
export const CREATE_TOPIC: RateLimitRule = { action: 'topic', limit: 10, windowSec: 86400 };
/** 창작마당 문항 추가. 주제 하나를 채우는 데 20문항이면 충분하다. */
export const ADD_QUESTION: RateLimitRule = { action: 'question', limit: 300, windowSec: 86400 };

export interface RateLimitResult {
  ok: boolean;
  /** 창이 끝날 때까지 남은 초 — 429 응답의 Retry-After에 쓴다. */
  retryAfterSec: number;
}

/** 프록시를 거쳐 오므로 소켓 주소가 아니라 CF 헤더를 봐야 한다.
 *  헤더가 없으면(로컬 등) 한 덩어리로 묶는다 — 없다고 무제한이 되면 안 된다. */
export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'unknown';
}

/** 카운터를 1 올리고 한도를 넘었는지 본다. 넘었으면 ok=false.
 *
 *  넘은 경우에도 카운터는 이미 올라간 상태다 — 계속 두드리면 창이 끝날 때까지
 *  계속 막힌다는 뜻이고, 이건 의도한 동작이다. */
export async function checkRateLimit(
  env: RateLimitEnv,
  rule: RateLimitRule,
  subject: string,
  nowSec?: number,
): Promise<RateLimitResult> {
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / rule.windowSec) * rule.windowSec;
  const expiresAt = windowStart + rule.windowSec;
  const bucket = `${rule.action}:${subject}:${windowStart}`;

  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (bucket, count, expires_at) VALUES (?, 1, ?)
     ON CONFLICT(bucket) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind(bucket, expiresAt)
    .first<{ count: number }>();

  const count = row?.count ?? 1;

  // 만료된 행 청소. 별도 정리 작업(cron)을 두지 않으려고 가끔씩만 훑는다.
  if (Math.random() < 0.01) {
    await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now).run();
  }

  return { ok: count <= rule.limit, retryAfterSec: Math.max(1, expiresAt - now) };
}

export function tooManyRequests(result: RateLimitResult): Response {
  return new Response(JSON.stringify({ error: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(result.retryAfterSec),
    },
  });
}
