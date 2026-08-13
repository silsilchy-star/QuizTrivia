import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('테스트 하네스', () => {
  it('schema.sql과 migrations가 순서대로 적용된다', async () => {
    const row = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE name = 'questions'").first<{
      sql: string;
    }>();
    // 마이그레이션 0002가 실제로 적용됐는지 — CHECK 제약이 넓어졌어야 한다.
    expect(row?.sql).toContain('TEXT_INPUT');
    // 마이그레이션 0001이 적용됐는지.
    expect(row?.sql).toContain('author_uid');
  });

  it('공식 콘텐츠(data/*.json)에 의존하지 않는다 — 빈 DB로 시작한다', async () => {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM topics').first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
