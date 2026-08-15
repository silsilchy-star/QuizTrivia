import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// 마이그레이션 파일들을 빌드 시점에 읽어 바인딩으로 넘긴다. 테스트 런타임(워커
// 안)에서는 node:fs를 쓸 수 없기 때문이다.
const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          GOOGLE_CLIENT_ID: 'test-client-id',
          GOOGLE_CLIENT_SECRET: 'test-client-secret',
          // 프로덕션과 같은 조건으로 — 서명이 켜진 상태에서 테스트한다.
          SESSION_SECRET: 'test-session-secret-do-not-use-in-production',
        },
      },
    }),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
    // 기본값 5초로는 CI에서 간헐적으로 터진다. 요청을 수십 번 순차로 보내는
    // 테스트가 있는데(게이트 채우기 20회, 레이트리밋 101회) 러너가 느린 날엔
    // 5초를 넘긴다 — 2026-08-15 같은 코드가 한 번은 실패, 한 번은 통과했다.
    // 배포 워크플로도 npm test를 관문으로 쓰므로 이 흔들림이 배포를 막는다.
    // 진짜 멈춘 테스트는 여전히 잡히도록 무한대가 아니라 20초로 둔다.
    testTimeout: 20_000,
  },
});
