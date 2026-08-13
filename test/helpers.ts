// 테스트 공용 유틸. 여기 있는 것들은 "테스트가 자기 데이터를 직접 만든다"는
// 원칙을 위한 도구다 — 공식 콘텐츠(data/*.json)에 의존하면 문항이 늘거나 바뀔
// 때마다 무관한 테스트가 깨진다.
import { env } from 'cloudflare:test';
import type { Difficulty, QuestionType } from '../src/types';

/** `--` 주석을 걷어내고 세미콜론 단위로 자른다. D1의 exec()는 statement가 한
 *  줄이어야 해서 여러 줄짜리 CREATE TABLE을 못 받는다. */
export function splitSqlStatements(sql: string): string[] {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

let seq = 0;
/** 테스트끼리 데이터가 섞이지 않게 매번 다른 id를 준다. */
export function uniqueId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

const NOW = '2026-08-13T00:00:00.000Z';

export async function createTopic(opts: {
  id?: string;
  name?: string;
  status?: 'draft' | 'active';
  source?: 'official' | 'community';
  authorUid?: string | null;
}): Promise<string> {
  const id = opts.id ?? uniqueId('topic');
  await env.DB.prepare(
    `INSERT INTO topics (id, no, name, kind, tagline, status, q_count_1, q_count_2, q_count_3, q_count_4,
                         source, author_uid, created_at, updated_at)
     VALUES (?, 1, ?, 'broad', '', ?, 0, 0, 0, 0, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      opts.name ?? '테스트주제',
      opts.status ?? 'active',
      opts.source ?? 'official',
      opts.authorUid ?? null,
      NOW,
      NOW,
    )
    .run();
  return id;
}

export async function createQuestion(opts: {
  id?: string;
  topicId: string;
  difficulty: Difficulty;
  type?: QuestionType;
  body?: string;
  choices?: string[] | null;
  answer?: string;
  authorUid?: string | null;
}): Promise<string> {
  const id = opts.id ?? uniqueId('q');
  const type = opts.type ?? 'MULTIPLE_CHOICE';
  const choices = opts.choices !== undefined ? opts.choices : ['가', '나', '다', '라'];
  const answer = opts.answer ?? (type === 'MULTIPLE_CHOICE' ? '가' : '42');
  await env.DB.prepare(
    `INSERT INTO questions (id, type, difficulty, body, choices_json, answer, explanation, status, source,
                            generated_by, author_uid, created_at, image_url)
     VALUES (?, ?, ?, ?, ?, ?, '해설', 'approved', 'manual', NULL, ?, ?, NULL)`,
  )
    .bind(
      id,
      type,
      opts.difficulty,
      opts.body ?? `문항 ${id}`,
      choices ? JSON.stringify(choices) : null,
      answer,
      opts.authorUid ?? null,
      NOW,
    )
    .run();
  await env.DB.prepare('INSERT INTO question_topics (question_id, topic_id) VALUES (?, ?)')
    .bind(id, opts.topicId)
    .run();
  return id;
}

/** 난이도 1~4에 각각 n개씩 문항을 채운 주제를 만든다. 12스테이지를 끝까지
 *  돌리려면 난이도당 최소 15개(3스테이지 × 5문항)가 필요하다. */
export async function createPlayableTopic(perDifficulty = 15, source: 'official' | 'community' = 'official') {
  const topicId = await createTopic({ source });
  for (const d of [1, 2, 3, 4] as const) {
    for (let i = 0; i < perDifficulty; i += 1) {
      await createQuestion({ topicId, difficulty: d });
    }
  }
  return topicId;
}

export async function createUser(opts: {
  uid?: string;
  nickname?: string | null;
  isAnonymous?: boolean;
} = {}): Promise<string> {
  const uid = opts.uid ?? uniqueId('uid');
  await env.DB.prepare(
    `INSERT INTO users (uid, nickname, is_anonymous, global_score, play_count, created_at, updated_at)
     VALUES (?, ?, ?, 0, 0, ?, ?)`,
  )
    .bind(uid, opts.nickname ?? null, opts.isAnonymous === false ? 0 : 1, NOW, NOW)
    .run();
  return uid;
}
