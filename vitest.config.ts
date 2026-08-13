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
  },
});
