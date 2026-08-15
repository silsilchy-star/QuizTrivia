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
import { videoFromStored } from '../src/media';
import { handleAuthGoogleCallback, handleAuthGoogleStart, handleSetNickname } from './auth';
import { handleGlobalRanking, handleTopicRanking, refreshGlobalCaches, upsertWeeklyBest } from './ranking';
import {
  handleAddCommunityQuestion,
  handleCreateCommunityTopic,
  handleDeleteCommunityTopic,
  handleListCommunityTopics,
  isRankedTopic,
} from './community';
import { issueToken, readSessionCookie, sessionCookie, verifyToken } from './session';
import {
  ADD_QUESTION,
  CREATE_TOPIC,
  NEW_SESSION,
  START_RUN,
  checkRateLimit,
  clientIp,
  tooManyRequests,
} from './ratelimit';
import { logError } from './errorlog';
import { IMAGE_PATH_PREFIX, handleServeImage, handleUploadImage } from './images';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** 창작마당 문항 이미지 (worker/images.ts) */
  IMAGES: R2Bucket;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** 세션 쿠키 서명용. 없으면 서명 없이(옛 방식으로) 동작한다 — worker/session.ts */
  SESSION_SECRET?: string;
}

/** PLAN 4.2절 */
const QUESTIONS_PER_STAGE = 5;
const CLEAR_THRESHOLD = 4;
/** PLAN 5.1절 만점. 7.5절에 따라 서버에서 상한을 검증한다. */
const MAX_RUN_SCORE = 1500;

/** 스테이지 1~3은 난이도1, 4~6은 난이도2, ... (PLAN 4.2절) */
export function difficultyForStage(stage: number): Difficulty {
  return (Math.min(4, Math.ceil(stage / 3)) as Difficulty) || 1;
}

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

/** 쿠키의 서명된 토큰만 신뢰한다. 클라이언트가 본문으로 보내는 uid는 절대 쓰지 않는다. */
async function resolveUid(request: Request, env: Env): Promise<string | null> {
  const token = readSessionCookie(request);
  if (!token) return null;
  const session = await verifyToken(env, token);
  if (!session) return null;
  // 서명이 맞아도 그 사이 계정이 사라졌을 수 있다.
  const row = await env.DB.prepare('SELECT uid FROM users WHERE uid = ?').bind(session.uid).first();
  return row ? session.uid : null;
}

async function handleSession(request: Request, env: Env): Promise<Response> {
  const token = readSessionCookie(request);
  const existing = token ? await verifyToken(env, token) : null;

  if (existing) {
    const row = await env.DB.prepare('SELECT uid, is_anonymous, nickname FROM users WHERE uid = ?')
      .bind(existing.uid)
      .first<{ uid: string; is_anonymous: number; nickname: string | null }>();
    if (row) {
      const body = { isAnonymous: !!row.is_anonymous, nickname: row.nickname };
      // 서명 없는 옛 쿠키이거나 수명이 절반 아래로 내려갔으면 갈아끼워준다.
      // 이게 기존 사용자를 로그아웃시키지 않고 서명 방식으로 옮기는 통로다.
      if (existing.legacy || existing.stale) {
        return json(body, { headers: { 'Set-Cookie': sessionCookie(await issueToken(env, row.uid)) } });
      }
      return json(body);
    }
  }

  // 여기부터가 새 계정을 만드는 경로다. 쿠키 없이 계속 두드리면 users 행이
  // 무제한으로 쌓이므로 IP당 제한을 건다. 기존 세션을 확인만 하는 위쪽
  // 경로는 제한하지 않는다 — 정상 사용자가 새로고침으로 막히면 안 된다.
  const limited = await checkRateLimit(env, NEW_SESSION, clientIp(request));
  if (!limited.ok) return tooManyRequests(limited);

  const uid = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO users (uid, is_anonymous, created_at, updated_at) VALUES (?, 1, ?, ?)',
  )
    .bind(uid, now, now)
    .run();

  return json(
    { isAnonymous: true, nickname: null },
    { headers: { 'Set-Cookie': sessionCookie(await issueToken(env, uid)) } },
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
    `SELECT q.id, q.type, q.difficulty, q.body, q.choices_json, q.image_url, q.video_kind, q.video_id
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
      image_url: string | null;
      video_kind: string | null;
      video_id: string | null;
    }>();

  return (results ?? []).map((r) => ({
    id: r.id,
    type: r.type,
    difficulty: r.difficulty,
    body: r.body,
    choices: r.choices_json ? (JSON.parse(r.choices_json) as string[]) : null,
    imageUrl: r.image_url,
    video: videoFromStored(r.video_kind, r.video_id),
  }));
}

async function handleStartRun(request: Request, env: Env, uid: string): Promise<Response> {
  const limited = await checkRateLimit(env, START_RUN, uid);
  if (!limited.ok) return tooManyRequests(limited);

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

/** 공백만 정리하는 정규화 — 대소문자·앞뒤/중복 공백 차이로 학명 단답이 틀리지 않게 한다. */
export function normalizeText(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isCorrect(type: QuestionType, answer: string, given: string): boolean {
  const a = answer.trim();
  const g = given.trim();
  // 빈 답은 어떤 유형에서도 정답이 아니다. 특히 NUMERIC_INPUT에서 이 가드가
  // 없으면 Number('')이 0이라서, 정답이 0인 문항에 공백만 내도 정답이 된다.
  if (g === '') return false;
  if (type === 'NUMERIC_INPUT') {
    const an = Number(a);
    const gn = Number(g);
    if (Number.isNaN(an) || Number.isNaN(gn)) return false;
    return an === gn;
  }
  if (type === 'TEXT_INPUT') {
    return normalizeText(a) === normalizeText(g);
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
    `SELECT id, type, difficulty, body, answer, explanation, image_url, video_kind, video_id
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
      image_url: string | null;
      video_kind: string | null;
      video_id: string | null;
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
      imageUrl: q.image_url,
      video: videoFromStored(q.video_kind, q.video_id),
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
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      // 기록은 응답을 붙잡지 않는다. 사용자에게는 내부 정보를 흘리지 않고
      // 500만 돌려준다 — 상세는 error_log에만 남는다.
      ctx.waitUntil(logError(env, request, error));
      return json({ error: 'internal error' }, { status: 500 });
    }
  },
};

/** 실제 라우팅. 여기서 던진 예외는 위 fetch()가 잡아 error_log에 남긴다. */
async function route(request: Request, env: Env): Promise<Response> {
  {
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

    // 이미지 업로드는 문항 생성과 같은 문턱을 둔다 — 로그인 + 닉네임.
    // (실제 검사는 handleUploadImage 앞의 resolveUid와 아래 requireAuthor가 한다)
    if (path === '/api/community/images' && request.method === 'POST') {
      const uid = await resolveUid(request, env);
      if (!uid) return json({ error: 'no session' }, { status: 401 });
      const author = await env.DB.prepare('SELECT is_anonymous, nickname FROM users WHERE uid = ?')
        .bind(uid)
        .first<{ is_anonymous: number; nickname: string | null }>();
      if (!author || author.is_anonymous || !author.nickname) {
        return json({ error: 'must be logged in with a nickname to upload' }, { status: 403 });
      }
      return handleUploadImage(request, env, uid);
    }

    // 업로드된 이미지 서빙. 인증 없이 열려 있다 — 문항 이미지는 플레이 중
    // 누구에게나 보여야 한다. 키가 내용 해시라 추측으로 남의 것을 열 수 없다.
    if (path.startsWith(IMAGE_PATH_PREFIX) && (request.method === 'GET' || request.method === 'HEAD')) {
      return handleServeImage(env, decodeURIComponent(path.slice(IMAGE_PATH_PREFIX.length)));
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
  }
}
