// 테스트 런타임이 받는 바인딩. wrangler.jsonc의 d1_databases와
// vitest.config.ts의 miniflare.bindings가 합쳐진 모습이다.
//
// 이 파일은 최상위 import가 없어야 한다 — 하나라도 있으면 모듈이 되어서
// 아래 전역 선언들이 앰비언트로 잡히지 않는다.

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    /** vitest.config.ts에서 readD1Migrations()로 읽어 넘긴 마이그레이션 목록. */
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
  }
}

/** db/schema.sql을 문자열로 읽어오기 위한 vite ?raw 임포트. */
declare module '*.sql?raw' {
  const content: string;
  export default content;
}
