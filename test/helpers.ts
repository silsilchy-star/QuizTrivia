// 테스트 공용 유틸. 여기 있는 것들은 "테스트가 자기 데이터를 직접 만든다"는
// 원칙을 위한 도구다 — 공식 콘텐츠(data/*.json)에 의존하면 문항이 늘거나 바뀔
// 때마다 무관한 테스트가 깨진다.
import { SELF, env } from 'cloudflare:test';
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
  // 워커가 발급하는 것과 같은 uuid 형식이어야 한다 — 세션 토큰 검증이 형식을 본다.
  const uid = opts.uid ?? crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (uid, nickname, is_anonymous, global_score, play_count, created_at, updated_at)
     VALUES (?, ?, ?, 0, 0, ?, ?)`,
  )
    .bind(uid, opts.nickname ?? null, opts.isAnonymous === false ? 0 : 1, NOW, NOW)
    .run();
  return uid;
}

/** 클라이언트마다 다른 IP를 준다.
 *
 *  ⚠ 이 테스트 환경은 D1을 테스트·파일·실행 사이에 되돌려주지 않는다(직접
 *  확인함 — vitest-pool-workers v0.21에는 isolatedStorage 옵션이 없다).
 *  그래서 레이트리밋 카운터가 계속 누적된다.
 *
 *  IP를 안 주면 전부 "unknown" 버킷을 공유하고, 순번으로 주면 카운터가
 *  파일마다 리셋되어 파일 간에 겹친다. 둘 다 실제로 겪었다 — 테스트를
 *  반복 실행하니 세 번째 실행에서 무관한 테스트가 429로 깨졌다.
 *
 *  그래서 넓은 공간에서 무작위로 뽑는다. 실행마다 새 IP라 누적되지 않는다. */
function nextIp(): string {
  const octet = () => Math.floor(Math.random() * 256);
  return `10.${octet()}.${octet()}.${octet()}`;
}

/** 워커를 실제로 fetch하는 클라이언트. SELF.fetch에는 쿠키 저장소가 없으므로
 *  직접 들고 다닌다. 세션 쿠키는 이제 서명된 토큰이라 uid와 같지 않다. */
export class Client {
  cookie = '';
  readonly ip: string;

  constructor(ip?: string) {
    this.ip = ip ?? nextIp();
  }

  async fetch(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    headers.set('Content-Type', 'application/json');
    if (!headers.has('CF-Connecting-IP')) headers.set('CF-Connecting-IP', this.ip);
    if (this.cookie) headers.set('Cookie', this.cookie);
    const res = await SELF.fetch(`https://example.com${path}`, { ...init, headers, redirect: 'manual' });
    const setCookie = res.headers.get('Set-Cookie');
    if (setCookie) {
      const session = setCookie.match(/session=([^;]*)/);
      if (session) this.cookie = `session=${session[1]}`;
    }
    return res;
  }

  async json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await (await this.fetch(path, init))).json() as Promise<T>;
  }

  /** 토큰에서 uid를 꺼낸다 — 테스트가 DB를 직접 확인할 때 쓴다. */
  get uid(): string {
    const token = this.cookie.replace('session=', '');
    const parts = token.split('.');
    return parts.length === 4 ? parts[1] : token;
  }
}

export async function newSession(): Promise<Client> {
  const client = new Client();
  await client.fetch('/api/session', { method: 'POST' });
  return client;
}

/** 구글 로그인을 흉내 낸다 — OAuth 왕복 없이 계정 승계 이후 상태만 만든다. */
export async function logIn(client: Client, nickname: string): Promise<void> {
  await env.DB.prepare('UPDATE users SET is_anonymous = 0, google_sub = ?, updated_at = ? WHERE uid = ?')
    .bind(uniqueId('sub'), new Date().toISOString(), client.uid)
    .run();
  await client.fetch('/api/nickname', { method: 'POST', body: JSON.stringify({ nickname }) });
}

/** 낸 문항들의 정답을 DB에서 직접 읽어온다 — "정답을 아는 플레이어" 역할. */
export async function answerKeyFor(questionIds: string[]): Promise<Map<string, string>> {
  const placeholders = questionIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`SELECT id, answer FROM questions WHERE id IN (${placeholders})`)
    .bind(...questionIds)
    .all<{ id: string; answer: string }>();
  return new Map((results ?? []).map((r) => [r.id, r.answer]));
}
