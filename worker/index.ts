import type {
  Difficulty,
  GradedAnswer,
  QuestionType,
  RunFinalSummary,
  ServedQuestion,
  StartRunResponse,
  SubmitStageResponse,
  SubmittedAnswer,
  Topic,
} from '../src/types';
import { TOTAL_STAGES } from '../src/types';
import { handleAuthGoogleCallback, handleAuthGoogleStart, handleSetNickname } from './auth';
import { handleGlobalRanking, handleTopicRanking, refreshGlobalCaches, upsertWeeklyBest } from './ranking';
import {
  handleAddCommunityQuestion,
  handleCreateCommunityTopic,
  handleDeleteCommunityTopic,
  handleListCommunityTopics,
  isRankedTopic,
} from './community';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

/** PLAN 4.2절 */
const QUESTIONS_PER_STAGE = 5;
const CLEAR_THRESHOLD = 4;
/** PLAN 5.1절 만점. 7.5절에 따라 서버에서 상한을 검증한다. */
const MAX_RUN_SCORE = 1500;

const SESSION_COOKIE = 'session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

/** 스테이지 1~3은 난이도1, 4~6은 난이도2, ... (PLAN 4.2절) */
function difficultyForStage(stage: number): Difficulty {
  return (Math.min(4, Math.ceil(stage / 3)) as Difficulty) || 1;
}

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
  const existingUid = getCookie(request, SESSION_COOKIE);
  if (existingUid) {
    const row = await env.DB.prepare('SELECT uid, is_anonymous, nickname FROM users WHERE uid = ?')
      .bind(existingUid)
      .first<{ uid: string; is_anonymous: number; nickname: string | null }>();
    if (row) {
      return json({ uid: row.uid, isAnonymous: !!row.is_anonymous, nickname: row.nickname });
    }
  }

  const uid = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO users (uid, is_anonymous, created_at, updated_at) VALUES (?, 1, ?, ?)',
  )
    .bind(uid, now, now)
    .run();

  return json(
    { uid, isAnonymous: true, nickname: null },
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
       FROM topics WHERE status = 'active' AND source = 'official' ORDER BY kind = 'broad' DESC, no`,
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

/** 이 판에서 아직 안 낸 문항 중, 해당 난이도에서 5개를 무작위로 뽑는다 (PLAN 4.3절 판 내 무중복). */
async function drawStageQuestions(
  env: Env,
  topicId: string,
  difficulty: Difficulty,
  excludeIds: string[],
): Promise<ServedQuestion[]> {
  const exclude = excludeIds.length ? `AND q.id NOT IN (${excludeIds.map(() => '?').join(',')})` : '';
  const { results } = await env.DB.prepare(
    `SELECT q.id, q.type, q.difficulty, q.body, q.choices_json
       FROM questions q
       JOIN question_topics qt ON qt.question_id = q.id
      WHERE qt.topic_id = ? AND q.status = 'approved' AND q.difficulty = ? ${exclude}
      ORDER BY RANDOM() LIMIT ?`,
  )
    .bind(topicId, difficulty, ...excludeIds, QUESTIONS_PER_STAGE)
    .all<{
      id: string;
      type: QuestionType;
      difficulty: Difficulty;
      body: string;
      choices_json: string | null;
    }>();

  return (results ?? []).map((r) => ({
    id: r.id,
    type: r.type,
    difficulty: r.difficulty,
    body: r.body,
    choices: r.choices_json ? (JSON.parse(r.choices_json) as string[]) : null,
  }));
}

async function handleStartRun(request: Request, env: Env, uid: string): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { topicId?: string } | null;
  const topicId = body?.topicId;
  if (!topicId) return json({ error: 'topicId is required' }, { status: 400 });

  const topic = await env.DB.prepare("SELECT id FROM topics WHERE id = ? AND status = 'active'")
    .bind(topicId)
    .first();
  if (!topic) return json({ error: 'topic not found or not active' }, { status: 404 });

  const questions = await drawStageQuestions(env, topicId, 1, []);
  if (questions.length < QUESTIONS_PER_STAGE) {
    return json({ error: 'not enough approved questions for this topic' }, { status: 409 });
  }

  const runId = crypto.randomUUID();
  const ids = questions.map((q) => q.id);
  await env.DB.prepare(
    `INSERT INTO runs (id, uid, topic_id, mode, stage_reached, score, served_json, all_served_json, answers_json, started_at, status)
     VALUES (?, ?, ?, 'solo', 1, 0, ?, ?, '[]', ?, 'in_progress')`,
  )
    .bind(runId, uid, topicId, JSON.stringify(ids), JSON.stringify(ids), new Date().toISOString())
    .run();

  const payload: StartRunResponse = { runId, topicId, stage: 1, totalStages: TOTAL_STAGES, questions };
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

/** 판을 완전히 종료하고 주제별 최고점·통합 점수를 반영한다 (성공/실패 공통 경로).
 *  유저 창작마당(커뮤니티) 주제는 랭킹에 전혀 반영하지 않는다 — 품질 편차·어뷰징
 *  위험이 있는 콘텐츠를 공식 랭킹과 분리하기 위한 경계선이다. */
async function finalizeRun(
  env: Env,
  uid: string,
  topicId: string,
  runId: string,
  finalScore: number,
  stagesCleared: number,
  answersJson: string,
): Promise<RunFinalSummary> {
  const now = new Date().toISOString();

  await env.DB.prepare(
    `UPDATE runs SET stage_reached = ?, score = ?, answers_json = ?, ended_at = ?, status = 'completed' WHERE id = ?`,
  )
    .bind(stagesCleared, finalScore, answersJson, now, runId)
    .run();
  await env.DB.prepare('UPDATE users SET play_count = play_count + 1, updated_at = ? WHERE uid = ?')
    .bind(now, uid)
    .run();

  const ranked = await isRankedTopic(env, topicId);
  if (!ranked) {
    return { totalScore: finalScore, stagesCleared, ranked: false };
  }

  const prevBest = await env.DB.prepare('SELECT score FROM topic_best WHERE uid = ? AND topic_id = ?')
    .bind(uid, topicId)
    .first<{ score: number }>();
  const isNewBest = !prevBest || finalScore > prevBest.score;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO topic_best (uid, topic_id, score, stage, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(uid, topic_id) DO UPDATE SET
         score = excluded.score, stage = excluded.stage, updated_at = excluded.updated_at
         WHERE excluded.score > topic_best.score`,
    ).bind(uid, topicId, finalScore, stagesCleared, now),
    env.DB.prepare(
      `UPDATE users
          SET global_score = (SELECT COALESCE(SUM(score), 0) FROM topic_best WHERE uid = ?),
              updated_at = ?
        WHERE uid = ?`,
    ).bind(uid, now, uid),
  ]);

  const isNewWeeklyBest = await upsertWeeklyBest(env, uid, topicId, finalScore, now);
  // 랭킹에 실제로 영향을 준 판만 캐시를 다시 계산한다 — 매 판마다 부르면 낭비다 (5.3절).
  if (isNewBest || isNewWeeklyBest) {
    await refreshGlobalCaches(env, now);
  }

  const after = await env.DB.prepare(
    `SELECT (SELECT COALESCE(score, 0) FROM topic_best WHERE uid = ? AND topic_id = ?) AS topic_best_score,
            (SELECT global_score FROM users WHERE uid = ?) AS global_score`,
  )
    .bind(uid, topicId, uid)
    .first<{ topic_best_score: number; global_score: number }>();

  return {
    totalScore: finalScore,
    stagesCleared,
    ranked: true,
    topicBestScore: after?.topic_best_score ?? finalScore,
    isNewBest,
    globalScore: after?.global_score ?? finalScore,
  };
}

async function handleSubmitStage(
  request: Request,
  env: Env,
  uid: string,
  runId: string,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { answers?: SubmittedAnswer[] } | null;
  const submitted = body?.answers;
  if (!Array.isArray(submitted)) return json({ error: 'answers is required' }, { status: 400 });

  const run = await env.DB.prepare(
    `SELECT id, uid, topic_id, stage_reached, score, served_json, all_served_json, answers_json, status
       FROM runs WHERE id = ? AND uid = ?`,
  )
    .bind(runId, uid)
    .first<{
      id: string;
      uid: string;
      topic_id: string;
      stage_reached: number;
      score: number;
      served_json: string | null;
      all_served_json: string | null;
      answers_json: string | null;
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
  let stageScore = 0;
  let correctCount = 0;

  for (const qid of servedIds) {
    const q = byId.get(qid);
    if (!q) continue;
    const given = givenById.get(qid) ?? '';
    const correct = given !== '' && isCorrect(q.type, q.answer, given);
    if (correct) {
      correctCount += 1;
      stageScore += q.difficulty * 10; // PLAN 5.1절
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

  const cleared = correctCount >= CLEAR_THRESHOLD;
  const now = new Date().toISOString();

  const newTotalScore = Math.min(run.score + stageScore, MAX_RUN_SCORE);
  const priorAnswers = run.answers_json ? JSON.parse(run.answers_json) : [];
  const answersJson = JSON.stringify([
    ...priorAnswers,
    { stage: run.stage_reached, correctCount, stageScore, graded: graded.map((g) => ({ questionId: g.questionId, given: g.given, correct: g.correct })) },
  ]);

  // 문항별 정답률의 원천. 저자가 붙인 난이도가 맞는지 나중에 검증할 근거가 된다.
  const statsUpdates = graded.map((g) =>
    env.DB.prepare(
      `INSERT INTO question_stats (question_id, served_count, correct_count, updated_at)
       VALUES (?, 1, ?, ?)
       ON CONFLICT(question_id) DO UPDATE SET
         served_count = question_stats.served_count + 1,
         correct_count = question_stats.correct_count + excluded.correct_count,
         updated_at = excluded.updated_at`,
    ).bind(g.questionId, g.correct ? 1 : 0, now),
  );

  const stagesCleared = cleared ? run.stage_reached : run.stage_reached - 1;
  const runEnds = !cleared || run.stage_reached >= TOTAL_STAGES;

  if (runEnds) {
    await env.DB.batch(statsUpdates);
    const final = await finalizeRun(env, uid, run.topic_id, runId, newTotalScore, Math.max(0, stagesCleared), answersJson);
    const payload: SubmitStageResponse = {
      runId,
      stage: run.stage_reached,
      totalStages: TOTAL_STAGES,
      correctCount,
      total: graded.length,
      cleared,
      stageScore,
      results: graded,
      runOver: true,
      final,
    };
    return json(payload);
  }

  // 클리어했고 스테이지가 남음 — 다음 스테이지를 바로 출제한다.
  const nextStageNum = run.stage_reached + 1;
  const allServed: string[] = run.all_served_json ? JSON.parse(run.all_served_json) : [];
  const nextQuestions = await drawStageQuestions(env, run.topic_id, difficultyForStage(nextStageNum), allServed);
  if (nextQuestions.length < QUESTIONS_PER_STAGE) {
    // 문항 풀이 예상보다 적게 남은 예외 상황 — 여기서 판을 끝낸다.
    await env.DB.batch(statsUpdates);
    const final = await finalizeRun(env, uid, run.topic_id, runId, newTotalScore, stagesCleared, answersJson);
    const payload: SubmitStageResponse = {
      runId,
      stage: run.stage_reached,
      totalStages: TOTAL_STAGES,
      correctCount,
      total: graded.length,
      cleared,
      stageScore,
      results: graded,
      runOver: true,
      final,
    };
    return json(payload);
  }

  const nextIds = nextQuestions.map((q) => q.id);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE runs SET stage_reached = ?, score = ?, served_json = ?, all_served_json = ?, answers_json = ? WHERE id = ?`,
    ).bind(nextStageNum, newTotalScore, JSON.stringify(nextIds), JSON.stringify([...allServed, ...nextIds]), answersJson, runId),
    ...statsUpdates,
  ]);

  const payload: SubmitStageResponse = {
    runId,
    stage: run.stage_reached,
    totalStages: TOTAL_STAGES,
    correctCount,
    total: graded.length,
    cleared,
    stageScore,
    results: graded,
    runOver: false,
    nextStage: { stage: nextStageNum, questions: nextQuestions },
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
      return handleSubmitStage(request, env, uid, submitMatch[1]);
    }

    if (path === '/api/auth/google' && request.method === 'GET') {
      const uid = await resolveUid(request, env);
      if (!uid) return json({ error: 'no session' }, { status: 401 });
      return handleAuthGoogleStart(request, env, uid);
    }

    if (path === '/api/auth/google/callback' && request.method === 'GET') {
      return handleAuthGoogleCallback(request, env);
    }

    if (path === '/api/nickname' && request.method === 'POST') {
      const uid = await resolveUid(request, env);
      if (!uid) return json({ error: 'no session' }, { status: 401 });
      return handleSetNickname(request, env, uid);
    }

    const rankingMatch = path.match(/^\/api\/rankings\/(global_all_time|global_weekly)$/);
    if (rankingMatch && request.method === 'GET') {
      const uid = await resolveUid(request, env);
      return handleGlobalRanking(env, rankingMatch[1], uid);
    }

    const topicRankingMatch = path.match(/^\/api\/rankings\/topic\/([^/]+)$/);
    if (topicRankingMatch && request.method === 'GET') {
      const uid = await resolveUid(request, env);
      return handleTopicRanking(env, decodeURIComponent(topicRankingMatch[1]), uid);
    }

    if (path === '/api/community/topics' && request.method === 'GET') {
      const uid = await resolveUid(request, env);
      return handleListCommunityTopics(env, uid);
    }
    if (path === '/api/community/topics' && request.method === 'POST') {
      const uid = await resolveUid(request, env);
      if (!uid) return json({ error: 'no session' }, { status: 401 });
      return handleCreateCommunityTopic(request, env, uid);
    }

    const communityQuestionMatch = path.match(/^\/api\/community\/topics\/([^/]+)\/questions$/);
    if (communityQuestionMatch && request.method === 'POST') {
      const uid = await resolveUid(request, env);
      if (!uid) return json({ error: 'no session' }, { status: 401 });
      return handleAddCommunityQuestion(request, env, uid, decodeURIComponent(communityQuestionMatch[1]));
    }

    const communityTopicMatch = path.match(/^\/api\/community\/topics\/([^/]+)$/);
    if (communityTopicMatch && request.method === 'DELETE') {
      const uid = await resolveUid(request, env);
      if (!uid) return json({ error: 'no session' }, { status: 401 });
      return handleDeleteCommunityTopic(env, uid, decodeURIComponent(communityTopicMatch[1]));
    }

    if (path.startsWith('/api/')) {
      return json({ error: 'not found' }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};
