// 유저 창작마당 — 플레이어가 직접 주제를 만들고 문제를 채워 넣는 기능.
//
// 공식 콘텐츠(data/*.json → build-seed)와는 완전히 분리된 경로다:
//   - 사람 검수 없음. 자동 검증만 통과하면 그 자리에서 바로 공개된다.
//   - 랭킹(topic_best/global_score/ranking_cache)에 전혀 반영되지 않는다 —
//     품질 편차·어뷰징 위험이 있는 콘텐츠가 공식 랭킹에 섞이지 않게 하는 것이
//     이 기능의 가장 중요한 경계선이다.
//   - 활성화 하한도 공식 주제(난이도당 20문항)보다 훨씬 낮다 — 혼자 만드는
//     사람이 실제로 채울 수 있는 양이어야 하기 때문.
import type { Difficulty, QuestionType } from '../src/types';

export interface CommunityEnv {
  DB: D1Database;
}

/** 공식 주제(GATE_PER_DIFFICULTY=20)보다 훨씬 낮은 하한 — 혼자 만들 수 있는 양. */
const COMMUNITY_GATE_PER_DIFFICULTY = 5;
const NAME_MAX = 30;
const TAGLINE_MAX = 60;
const BODY_MAX = 80;
const SUPERLATIVE = ['가장', '최고', '제일', '최대', '최소'];

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

/** 검수자 없이 즉시 공개하는 대신, 형식 오류만은 반드시 기계가 막는다. */
function normalize(text: string): string {
  return text.replace(/\s+/g, '').replace(/[?？.!,·'"()]/g, '').toLowerCase();
}

async function requireAuthor(
  env: CommunityEnv,
  uid: string,
): Promise<{ ok: true; nickname: string } | { ok: false; res: Response }> {
  const user = await env.DB.prepare('SELECT is_anonymous, nickname FROM users WHERE uid = ?')
    .bind(uid)
    .first<{ is_anonymous: number; nickname: string | null }>();
  if (!user || user.is_anonymous) {
    return { ok: false, res: json({ error: 'must be logged in to create content' }, { status: 403 }) };
  }
  if (!user.nickname) {
    return { ok: false, res: json({ error: 'nickname required before creating content' }, { status: 403 }) };
  }
  return { ok: true, nickname: user.nickname };
}

export interface CommunityTopicPayload {
  id: string;
  name: string;
  tagline: string | null;
  status: 'draft' | 'active';
  questionCount: Record<'1' | '2' | '3' | '4', number>;
  authorNickname: string | null;
  isMine: boolean;
  createdAt: string;
}

export async function handleListCommunityTopics(
  env: CommunityEnv,
  viewerUid: string | null,
): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.name, t.tagline, t.status, t.q_count_1, t.q_count_2, t.q_count_3, t.q_count_4,
            t.author_uid, u.nickname AS author_nickname, t.created_at
       FROM topics t LEFT JOIN users u ON u.uid = t.author_uid
      WHERE t.source = 'community'
      ORDER BY t.created_at DESC`,
  ).all<{
    id: string;
    name: string;
    tagline: string | null;
    status: 'draft' | 'active';
    q_count_1: number;
    q_count_2: number;
    q_count_3: number;
    q_count_4: number;
    author_uid: string | null;
    author_nickname: string | null;
    created_at: string;
  }>();

  const topics: CommunityTopicPayload[] = (results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    tagline: r.tagline,
    status: r.status,
    questionCount: { '1': r.q_count_1, '2': r.q_count_2, '3': r.q_count_3, '4': r.q_count_4 },
    authorNickname: r.author_nickname,
    isMine: viewerUid !== null && viewerUid === r.author_uid,
    createdAt: r.created_at,
  }));
  return json(topics);
}

export async function handleCreateCommunityTopic(request: Request, env: CommunityEnv, uid: string): Promise<Response> {
  const author = await requireAuthor(env, uid);
  if (!author.ok) return author.res;

  const body = (await request.json().catch(() => null)) as { name?: string; tagline?: string } | null;
  const name = body?.name?.trim();
  const tagline = body?.tagline?.trim() || null;
  if (!name || name.length > NAME_MAX) {
    return json({ error: `name must be 1-${NAME_MAX} characters` }, { status: 400 });
  }
  if (tagline && tagline.length > TAGLINE_MAX) {
    return json({ error: `tagline must be at most ${TAGLINE_MAX} characters` }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO topics
       (id, name, kind, tagline, status, q_count_1, q_count_2, q_count_3, q_count_4,
        source, author_uid, created_at, updated_at)
     VALUES (?, ?, 'broad', ?, 'draft', 0, 0, 0, 0, 'community', ?, ?, ?)`,
  )
    .bind(id, name, tagline, uid, now, now)
    .run();

  const payload: CommunityTopicPayload = {
    id,
    name,
    tagline,
    status: 'draft',
    questionCount: { '1': 0, '2': 0, '3': 0, '4': 0 },
    authorNickname: author.nickname,
    isMine: true,
    createdAt: now,
  };
  return json(payload);
}

interface NewQuestionBody {
  type?: QuestionType;
  difficulty?: Difficulty;
  body?: string;
  choices?: string[] | null;
  answer?: string;
  explanation?: string;
}

/** 사람 검수가 없으므로, 기계가 잡을 수 있는 형식 오류만은 반드시 막는다
 *  (scripts/validate.mjs의 ERROR 규칙과 같은 것들 — PLAN 6.6절 [3]). */
function validateQuestion(q: NewQuestionBody): string | null {
  if (q.type !== 'MULTIPLE_CHOICE' && q.type !== 'NUMERIC_INPUT') return 'type이 잘못됨';
  if (![1, 2, 3, 4].includes(q.difficulty as number)) return 'difficulty가 잘못됨';
  const body = q.body?.trim();
  if (!body) return 'body가 비었다';
  if (body.length > BODY_MAX) return `문항은 ${BODY_MAX}자 이내여야 한다`;
  if (!q.explanation?.trim()) return '해설이 비었다';
  if (typeof q.answer !== 'string' || !q.answer.trim()) return '정답이 비었다';

  if (q.type === 'MULTIPLE_CHOICE') {
    if (!Array.isArray(q.choices) || q.choices.length !== 4) return '선택지는 정확히 4개여야 한다';
    if (q.choices.some((c) => !String(c).trim())) return '빈 선택지가 있다';
    if (new Set(q.choices).size !== 4) return '선택지에 중복이 있다';
    if (!q.choices.includes(q.answer)) return '정답이 선택지 안에 없다';
  } else {
    if (q.choices != null) return 'NUMERIC_INPUT은 선택지가 없어야 한다';
    if (Number.isNaN(Number(q.answer))) return '정답이 숫자로 파싱되지 않는다';
  }
  return null;
}

export async function handleAddCommunityQuestion(
  request: Request,
  env: CommunityEnv,
  uid: string,
  topicId: string,
): Promise<Response> {
  const author = await requireAuthor(env, uid);
  if (!author.ok) return author.res;

  const topic = await env.DB.prepare(
    "SELECT id, author_uid FROM topics WHERE id = ? AND source = 'community'",
  )
    .bind(topicId)
    .first<{ id: string; author_uid: string }>();
  if (!topic) return json({ error: 'community topic not found' }, { status: 404 });
  if (topic.author_uid !== uid) return json({ error: 'only the topic author can add questions' }, { status: 403 });

  const q = (await request.json().catch(() => null)) as NewQuestionBody | null;
  if (!q) return json({ error: 'invalid body' }, { status: 400 });
  const reason = validateQuestion(q);
  if (reason) return json({ error: reason }, { status: 400 });

  const existing = await env.DB.prepare(
    `SELECT q.body FROM questions q JOIN question_topics qt ON qt.question_id = q.id WHERE qt.topic_id = ?`,
  )
    .bind(topicId)
    .all<{ body: string }>();
  const dupe = (existing.results ?? []).some((r) => normalize(r.body) === normalize(q.body!.trim()));
  if (dupe) return json({ error: '이미 같은 문항이 있다' }, { status: 409 });

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const choicesJson = q.type === 'MULTIPLE_CHOICE' ? JSON.stringify(q.choices) : null;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO questions
         (id, type, difficulty, body, choices_json, answer, explanation, status, source, generated_by, author_uid, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', 'manual', NULL, ?, ?)`,
    ).bind(id, q.type, q.difficulty, q.body!.trim(), choicesJson, q.answer, q.explanation!.trim(), uid, now),
    env.DB.prepare('INSERT INTO question_topics (question_id, topic_id) VALUES (?, ?)').bind(id, topicId),
  ]);

  // 하한 게이트 재계산 — build-seed.mjs와 같은 규칙, 다만 공식 주제보다 훨씬 낮은 기준으로.
  const counts = await env.DB.prepare(
    `SELECT q.difficulty AS d, COUNT(*) AS n
       FROM questions q JOIN question_topics qt ON qt.question_id = q.id
      WHERE qt.topic_id = ? AND q.status = 'approved'
      GROUP BY q.difficulty`,
  )
    .bind(topicId)
    .all<{ d: Difficulty; n: number }>();
  const byDiff: Record<1 | 2 | 3 | 4, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const r of counts.results ?? []) byDiff[r.d] = r.n;
  const active = ([1, 2, 3, 4] as const).every((d) => byDiff[d] >= COMMUNITY_GATE_PER_DIFFICULTY);

  const status = active ? 'active' : 'draft';
  await env.DB.prepare(
    `UPDATE topics SET q_count_1 = ?, q_count_2 = ?, q_count_3 = ?, q_count_4 = ?, status = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(byDiff[1], byDiff[2], byDiff[3], byDiff[4], status, now, topicId)
    .run();

  const topicRow = await env.DB.prepare('SELECT name, tagline, created_at FROM topics WHERE id = ?')
    .bind(topicId)
    .first<{ name: string; tagline: string | null; created_at: string }>();

  const payload: CommunityTopicPayload = {
    id: topicId,
    name: topicRow?.name ?? '',
    tagline: topicRow?.tagline ?? null,
    status,
    questionCount: { '1': byDiff[1], '2': byDiff[2], '3': byDiff[3], '4': byDiff[4] },
    authorNickname: author.nickname,
    isMine: true,
    createdAt: topicRow?.created_at ?? now,
  };
  return json(payload);
}

/** finalizeRun이 랭킹 반영 여부를 결정하려고 부른다 (worker/index.ts). */
export async function isRankedTopic(env: CommunityEnv, topicId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT source FROM topics WHERE id = ?').bind(topicId).first<{ source: string }>();
  return (row?.source ?? 'official') === 'official';
}
