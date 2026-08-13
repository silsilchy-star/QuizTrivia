import type {
  Difficulty,
  GradedAnswer,
  QuestionType,
  ServedQuestion,
  StartRunResponse,
  SubmitRunResponse,
  SubmittedAnswer,
  Topic,
} from '../src/types';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

/** PLAN 4.2절 */
const QUESTIONS_PER_STAGE = 5;
const CLEAR_THRESHOLD = 4;
/** PLAN 5.1절 만점. 7.5절에 따라 서버에서 상한을 검증한다. */
const MAX_RUN_SCORE = 1500;

const SESSION_COOKIE = 'session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

function getCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return null;
  const match = cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** 쿠키의 uid만 신뢰한다. 클라이언트가 본문으로 보내는 uid는 절대 쓰지 않는다. */
async function resolveUid(request: Request, env: Env): Promise<string | null> {
  const uid = getCookie(request, SESSION_COOKIE);
  if (!uid) return null;
  const row = await env.DB.prepare('SELECT uid FROM users WHERE uid = ?').bind(uid).first();
  return row ? uid : null;
}

async function handleSession(request: Request, env: Env): Promise<Response> {
  const existing = await resolveUid(request, env);
  if (existing) return json({ uid: existing });

  const uid = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO users (uid, is_anonymous, created_at, updated_at) VALUES (?, 1, ?, ?)',
  )
    .bind(uid, now, now)
    .run();

  return json(
    { uid },
    {
      headers: {
        'Set-Cookie': `${SESSION_COOKIE}=${uid}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`,
      },
    },
  );
}

/** 하한 게이트를 통과해 active가 된 주제만 노출한다 (PLAN 6.6절). */
async function handleTopics(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, kind, tagline, q_count_1, q_count_2, q_count_3, q_count_4
       FROM topics WHERE status = 'active' ORDER BY kind = 'broad' DESC, no`,
  ).all<{
    id: string;
    name: string;
    kind: 'broad' | 'narrow';
    tagline: string;
    q_count_1: number;
    q_count_2: number;
    q_count_3: number;
    q_count_4: number;
  }>();

  const topics: Topic[] = (results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    tagline: r.tagline,
    questionCount: {
      '1': r.q_count_1,
      '2': r.q_count_2,
      '3': r.q_count_3,
      '4': r.q_count_4,
    },
  }));

  return json(topics);
}

async function handleStartRun(request: Request, env: Env, uid: string): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { topicId?: string } | null;
  const topicId = body?.topicId;
  if (!topicId) return json({ error: 'topicId is required' }, { status: 400 });

  const topic = await env.DB.prepare("SELECT id FROM topics WHERE id = ? AND status = 'active'")
    .bind(topicId)
    .first();
  if (!topic) return json({ error: 'topic not found or not active' }, { status: 404 });

  // 한 판 안에서 같은 문제가 두 번 나오지 않는다 (PLAN 4.3절).
  const { results } = await env.DB.prepare(
    `SELECT q.id, q.type, q.difficulty, q.body, q.choices_json
       FROM questions q
       JOIN question_topics qt ON qt.question_id = q.id
      WHERE qt.topic_id = ? AND q.status = 'approved'
      ORDER BY RANDOM() LIMIT ?`,
  )
    .bind(topicId, QUESTIONS_PER_STAGE)
    .all<{
      id: string;
      type: QuestionType;
      difficulty: Difficulty;
      body: string;
      choices_json: string | null;
    }>();

  const rows = results ?? [];
  if (rows.length < QUESTIONS_PER_STAGE) {
    return json({ error: 'not enough approved questions for this topic' }, { status: 409 });
  }

  const questions: ServedQuestion[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    difficulty: r.difficulty,
    body: r.body,
    choices: r.choices_json ? (JSON.parse(r.choices_json) as string[]) : null,
  }));

  const runId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO runs (id, uid, topic_id, mode, served_json, started_at, status)
     VALUES (?, ?, ?, 'solo', ?, ?, 'in_progress')`,
  )
    .bind(runId, uid, topicId, JSON.stringify(questions.map((q) => q.id)), new Date().toISOString())
    .run();

  const payload: StartRunResponse = { runId, topicId, questions };
  return json(payload);
}

function isCorrect(type: QuestionType, answer: string, given: string): boolean {
  const a = answer.trim();
  const g = given.trim();
  if (type === 'NUMERIC_INPUT') {
    const an = Number(a);
    const gn = Number(g);
    if (Number.isNaN(an) || Number.isNaN(gn)) return false;
    return an === gn;
  }
  return a === g;
}

async function handleSubmitRun(
  request: Request,
  env: Env,
  uid: string,
  runId: string,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { answers?: SubmittedAnswer[] } | null;
  const submitted = body?.answers;
  if (!Array.isArray(submitted)) return json({ error: 'answers is required' }, { status: 400 });

  const run = await env.DB.prepare(
    'SELECT id, uid, topic_id, served_json, status FROM runs WHERE id = ? AND uid = ?',
  )
    .bind(runId, uid)
    .first<{
      id: string;
      uid: string;
      topic_id: string;
      served_json: string | null;
      status: string;
    }>();

  if (!run) return json({ error: 'run not found' }, { status: 404 });
  if (run.status !== 'in_progress') return json({ error: 'run already finished' }, { status: 409 });

  // 채점 대상은 출제 시점에 서버가 박아둔 목록이다. 클라이언트가 보낸 questionId
  // 중 여기에 없는 것은 무시한다 (7.5절 A안).
  const servedIds: string[] = run.served_json ? (JSON.parse(run.served_json) as string[]) : [];
  if (servedIds.length === 0) return json({ error: 'run has no served questions' }, { status: 409 });

  const placeholders = servedIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT id, type, difficulty, body, answer, explanation
       FROM questions WHERE id IN (${placeholders})`,
  )
    .bind(...servedIds)
    .all<{
      id: string;
      type: QuestionType;
      difficulty: Difficulty;
      body: string;
      answer: string;
      explanation: string;
    }>();

  const byId = new Map((results ?? []).map((r) => [r.id, r]));
  const givenById = new Map(submitted.map((a) => [a.questionId, a.given ?? '']));

  const graded: GradedAnswer[] = [];
  let score = 0;
  let correctCount = 0;

  for (const qid of servedIds) {
    const q = byId.get(qid);
    if (!q) continue;
    const given = givenById.get(qid) ?? '';
    const correct = given !== '' && isCorrect(q.type, q.answer, given);
    if (correct) {
      correctCount += 1;
      score += q.difficulty * 10; // PLAN 5.1절
    }
    graded.push({
      questionId: q.id,
      body: q.body,
      given,
      answer: q.answer,
      correct,
      difficulty: q.difficulty,
      explanation: q.explanation,
    });
  }

  score = Math.min(score, MAX_RUN_SCORE);
  const cleared = correctCount >= CLEAR_THRESHOLD;
  const now = new Date().toISOString();

  const prevBest = await env.DB.prepare('SELECT score FROM topic_best WHERE uid = ? AND topic_id = ?')
    .bind(uid, run.topic_id)
    .first<{ score: number }>();
  const isNewBest = !prevBest || score > prevBest.score;

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE runs SET stage_reached = 1, score = ?, answers_json = ?, ended_at = ?, status = 'completed'
        WHERE id = ?`,
    ).bind(score, JSON.stringify(graded.map((g) => ({ questionId: g.questionId, given: g.given, correct: g.correct }))), now, runId),
    // 주제별 최고점만 남긴다 — 폭 보상형 랭킹의 원천 (D-7)
    env.DB.prepare(
      `INSERT INTO topic_best (uid, topic_id, score, stage, updated_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(uid, topic_id) DO UPDATE SET
         score = excluded.score, stage = excluded.stage, updated_at = excluded.updated_at
         WHERE excluded.score > topic_best.score`,
    ).bind(uid, run.topic_id, score, now),
    env.DB.prepare(
      `UPDATE users
          SET global_score = (SELECT COALESCE(SUM(score), 0) FROM topic_best WHERE uid = ?),
              play_count = play_count + 1,
              updated_at = ?
        WHERE uid = ?`,
    ).bind(uid, now, uid),
    // 문항별 정답률의 원천. 저자가 붙인 난이도가 맞는지 나중에 검증할 근거가 된다.
    ...graded.map((g) =>
      env.DB.prepare(
        `INSERT INTO question_stats (question_id, served_count, correct_count, updated_at)
         VALUES (?, 1, ?, ?)
         ON CONFLICT(question_id) DO UPDATE SET
           served_count = question_stats.served_count + 1,
           correct_count = question_stats.correct_count + excluded.correct_count,
           updated_at = excluded.updated_at`,
      ).bind(g.questionId, g.correct ? 1 : 0, now),
    ),
  ]);

  const after = await env.DB.prepare(
    `SELECT (SELECT COALESCE(score, 0) FROM topic_best WHERE uid = ? AND topic_id = ?) AS topic_best_score,
            (SELECT global_score FROM users WHERE uid = ?) AS global_score`,
  )
    .bind(uid, run.topic_id, uid)
    .first<{ topic_best_score: number; global_score: number }>();

  const payload: SubmitRunResponse = {
    runId,
    score,
    correctCount,
    total: graded.length,
    cleared,
    results: graded,
    topicBestScore: after?.topic_best_score ?? score,
    isNewBest,
    globalScore: after?.global_score ?? score,
  };
  return json(payload);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/session' && request.method === 'POST') {
      return handleSession(request, env);
    }

    if (path === '/api/topics' && request.method === 'GET') {
      return handleTopics(env);
    }

    if (path === '/api/runs' && request.method === 'POST') {
      const uid = await resolveUid(request, env);
      if (!uid) return json({ error: 'no session' }, { status: 401 });
      return handleStartRun(request, env, uid);
    }

    const submitMatch = path.match(/^\/api\/runs\/([0-9a-f-]{36})\/submit$/);
    if (submitMatch && request.method === 'POST') {
      const uid = await resolveUid(request, env);
      if (!uid) return json({ error: 'no session' }, { status: 401 });
      return handleSubmitRun(request, env, uid, submitMatch[1]);
    }

    if (path.startsWith('/api/')) {
      return json({ error: 'not found' }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};
