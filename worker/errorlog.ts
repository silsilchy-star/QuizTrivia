// 런타임 에러 기록.
//
// 지금까지는 사용자가 말해줘야 장애를 알았다. 실제로 오늘도 "창작마당이
// 이상하다"는 보고를 받고서야 확인에 들어갔다. 워커가 예외를 던지면 그
// 사실 자체가 아무데도 남지 않는다.
//
// Cloudflare 대시보드 로그는 실시간 tail이라 지나가면 사라진다. 그래서
// D1에 남긴다 — 레이트리밋과 같은 방식이고, 나중에 조회·집계할 수 있다.
//
// ⚠ 로깅이 요청을 망가뜨리면 안 된다. 여기서 나는 예외는 전부 삼킨다.

export interface ErrorLogEnv {
  DB: D1Database;
}

/** 한 번에 보관하는 최대 행 수. 넘으면 오래된 것부터 지운다. */
const MAX_ROWS = 500;
/** 스택은 길어질 수 있어 잘라 넣는다. 원인 파악에는 앞부분이면 충분하다. */
const STACK_MAX = 2000;
const MESSAGE_MAX = 500;

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** 쿼리스트링은 통째로 버린다 — OAuth code 같은 비밀이 섞여 들어올 수 있다. */
function safePath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return '(unparseable)';
  }
}

function describe(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return {
      message: clip(`${error.name}: ${error.message}`, MESSAGE_MAX),
      stack: error.stack ? clip(error.stack, STACK_MAX) : null,
    };
  }
  return { message: clip(String(error), MESSAGE_MAX), stack: null };
}

/** 예외를 error_log에 남긴다. 실패해도 조용히 넘어간다 —
 *  로깅 때문에 사용자 요청이 깨지는 것이 원래 에러보다 나쁘다. */
export async function logError(
  env: ErrorLogEnv,
  request: Request,
  error: unknown,
  uid: string | null = null,
): Promise<void> {
  try {
    const { message, stack } = describe(error);
    await env.DB.prepare(
      `INSERT INTO error_log (path, method, message, stack, uid, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(safePath(request), request.method, message, stack, uid, new Date().toISOString())
      .run();

    // 무한정 쌓이지 않게 가끔 정리한다. 레이트리밋 정리와 같은 방식.
    if (Math.random() < 0.05) {
      await env.DB.prepare(
        `DELETE FROM error_log WHERE id NOT IN (
           SELECT id FROM error_log ORDER BY id DESC LIMIT ?
         )`,
      )
        .bind(MAX_ROWS)
        .run();
    }
  } catch {
    // 로깅 실패는 삼킨다. 여기서 던지면 원래 응답까지 잃는다.
  }
}
