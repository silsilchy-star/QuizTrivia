// 스키마 드리프트 감시.
//
// test/setup.ts가 빈 D1에 db/schema.sql → migrations/*.sql을 프로덕션과 같은
// 순서로 적용한다. 여기서는 그 결과가 코드가 기대하는 모습인지 확인한다.
//
// 이 테스트가 있는 이유: 한때 db/schema.sql이 실제 스키마와 어긋나 있었다.
// 진짜 모습을 알려면 마이그레이션을 순서대로 읽어 합쳐야 했고, 그 상태로
// 마이그레이션이 쌓이면 아무도 스키마를 모르게 된다. 다시 갈라지면 여기서
// 걸린다.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

async function tableSql(name: string): Promise<string> {
  const row = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .bind(name)
    .first<{ sql: string }>();
  if (!row) throw new Error(`테이블 ${name}이 없다`);
  return row.sql;
}

async function columnsOf(table: string): Promise<Set<string>> {
  const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return new Set((results ?? []).map((r) => r.name));
}

describe('스키마 구성', () => {
  it('코드가 쓰는 테이블이 전부 있다', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf%'",
    ).all<{ name: string }>();
    const names = new Set((results ?? []).map((r) => r.name));

    for (const t of [
      'topics',
      'questions',
      'question_topics',
      'users',
      'topic_best',
      'topic_best_weekly',
      'runs',
      'question_stats',
      'ranking_cache',
    ]) {
      expect(names, `${t} 테이블이 없다`).toContain(t);
    }
  });

  it('인덱스가 전부 있다 — 조회 성능이 조용히 무너지지 않게', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'",
    ).all<{ name: string }>();
    const names = new Set((results ?? []).map((r) => r.name));

    expect(names).toContain('idx_question_topics_topic');
    expect(names).toContain('idx_runs_uid');
    expect(names).toContain('idx_topics_source');
  });
});

describe('컬럼 — 코드가 실제로 읽고 쓰는 것들', () => {
  it('questions', async () => {
    const cols = await columnsOf('questions');
    for (const c of [
      'id',
      'type',
      'difficulty',
      'body',
      'choices_json',
      'answer',
      'explanation',
      'status',
      'source',
      'author_uid', // 공식/커뮤니티를 가르는 컬럼 (build-seed.mjs가 의존)
      'image_url',
      'created_at',
    ]) {
      expect(cols, `questions.${c}가 없다`).toContain(c);
    }
  });

  it('topics', async () => {
    const cols = await columnsOf('topics');
    for (const c of ['id', 'name', 'kind', 'status', 'source', 'author_uid', 'q_count_1', 'q_count_4']) {
      expect(cols, `topics.${c}가 없다`).toContain(c);
    }
  });

  it('users', async () => {
    const cols = await columnsOf('users');
    for (const c of ['uid', 'nickname', 'is_anonymous', 'google_sub', 'email', 'global_score', 'play_count']) {
      expect(cols, `users.${c}가 없다`).toContain(c);
    }
  });

  it('runs — 서버 채점이 의존하는 컬럼들', async () => {
    const cols = await columnsOf('runs');
    for (const c of ['served_json', 'all_served_json', 'answers_json', 'stage_reached', 'score', 'status']) {
      expect(cols, `runs.${c}가 없다`).toContain(c);
    }
  });
});

describe('제약 — 깨지면 데이터가 조용히 오염되는 것들', () => {
  it('questions.type이 세 가지 문제 유형을 모두 허용한다', async () => {
    const sql = await tableSql('questions');
    expect(sql).toContain('MULTIPLE_CHOICE');
    expect(sql).toContain('NUMERIC_INPUT');
    expect(sql).toContain('TEXT_INPUT');
  });

  it('topics.source가 official/community만 허용한다', async () => {
    const sql = await tableSql('topics');
    expect(sql).toContain("source IN ('official','community')");
  });

  it('난이도는 1~4만 허용한다', async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO questions (id, type, difficulty, body, answer, explanation, source, created_at)
         VALUES ('bad-difficulty', 'MULTIPLE_CHOICE', 5, '문항', '답', '해설', 'manual', '2026-01-01')`,
      ).run(),
    ).rejects.toThrow();
  });

  it('알 수 없는 문제 유형은 DB가 거부한다', async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO questions (id, type, difficulty, body, answer, explanation, source, created_at)
         VALUES ('bad-type', 'ESSAY', 1, '문항', '답', '해설', 'manual', '2026-01-01')`,
      ).run(),
    ).rejects.toThrow();
  });

  // 이 FK들이 되살아나면 questions를 재생성하는 마이그레이션이 불가능해진다
  // (D1은 참조당하는 테이블의 DROP을 막는다).
  // db/migrations-archive/0002_add_text_input_and_images.sql 참고.
  it('question_topics와 question_stats에는 questions(id) FK가 없다', async () => {
    expect(await tableSql('question_topics')).not.toContain('REFERENCES questions');
    expect(await tableSql('question_stats')).not.toContain('REFERENCES questions');
  });

  it('question_topics는 topics(id)는 계속 참조한다', async () => {
    expect(await tableSql('question_topics')).toContain('REFERENCES topics(id)');
  });
});

describe('테스트 환경 자체', () => {
  it('공식 콘텐츠(data/*.json)에 의존하지 않는다 — 빈 DB로 시작한다', async () => {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM topics').first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
