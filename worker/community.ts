// 유저 창작마당 — 플레이어가 직접 주제를 만들고 문제를 채워 넣는 기능.
//
// 공식 콘텐츠(data/*.json → build-seed)와는 완전히 분리된 경로다:
//   - 사람 검수 없음. 자동 검증만 통과하면 그 자리에서 바로 공개된다.
//   - 랭킹(topic_best/global_score/ranking_cache)에 전혀 반영되지 않는다 —
//     품질 편차·어뷰징 위험이 있는 콘텐츠가 공식 랭킹에 섞이지 않게 하는 것이
//     이 기능의 가장 중요한 경계선이다.
//   - 활성화 하한도 공식 주제(난이도당 20문항)보다 훨씬 낮다 — 혼자 만드는
//     사람이 실제로 채울 수 있는 양이어야 하기 때문.
import type { CommunityQuestion, Difficulty, QuestionType } from '../src/types';
import { MEDIA_URL_MAX, checkImageUrl, parseVideoUrl, videoFromStored } from '../src/media';
import { ADD_QUESTION, CREATE_TOPIC, checkRateLimit, tooManyRequests } from './ratelimit';

// 이미지 경로 판정은 src/media.ts로 옮겼다(프론트도 같은 규칙을 써야 하므로).
// 여기서 다시 내보내는 건 예전 import 경로를 살려두기 위한 것.
export { isUploadedImagePath } from '../src/media';

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

/** 작성자에게만 내려가는 문항 — 정답·해설이 들어있다 (src/types.ts와 같은 모양). */
type CommunityQuestionPayload = CommunityQuestion;

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

  const limited = await checkRateLimit(env, CREATE_TOPIC, uid);
  if (!limited.ok) return tooManyRequests(limited);

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

export interface NewQuestionBody {
  type?: QuestionType;
  difficulty?: Difficulty;
  body?: string;
  choices?: string[] | null;
  answer?: string;
  explanation?: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
}

const QUESTION_TYPES: QuestionType[] = ['MULTIPLE_CHOICE', 'NUMERIC_INPUT', 'TEXT_INPUT'];

/** 사람 검수가 없으므로, 기계가 잡을 수 있는 형식 오류만은 반드시 막는다
 *  (scripts/validate.mjs의 ERROR 규칙과 같은 것들 — PLAN 6.6절 [3]). */
export function validateQuestion(q: NewQuestionBody): string | null {
  if (!q.type || !QUESTION_TYPES.includes(q.type)) return 'type이 잘못됨';
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
  } else if (q.type === 'NUMERIC_INPUT') {
    if (q.choices != null) return 'NUMERIC_INPUT은 선택지가 없어야 한다';
    if (Number.isNaN(Number(q.answer))) return '정답이 숫자로 파싱되지 않는다';
  } else {
    if (q.choices != null) return 'TEXT_INPUT은 선택지가 없어야 한다';
  }

  // 미디어는 문항당 하나만 — 이미지와 영상을 동시에 붙일 수 있게 하면
  // 화면에서 뭘 먼저 보여줄지가 애매해지고, 문제를 읽기도 어려워진다.
  const imageUrl = q.imageUrl?.trim() || null;
  const videoUrl = q.videoUrl?.trim() || null;
  if (imageUrl && videoUrl) return '이미지와 영상은 함께 붙일 수 없다 — 하나만 고른다';

  if (imageUrl) {
    switch (checkImageUrl(imageUrl)) {
      case 'too-long':
        return `이미지 URL이 너무 길다 (${MEDIA_URL_MAX}자 이내)`;
      case 'is-video':
        return '유튜브 링크는 이미지가 아니라 영상 칸에 넣는다';
      case 'not-https':
        return '이미지는 직접 올리거나 https:// 링크여야 한다';
    }
  }

  if (videoUrl) {
    if (videoUrl.length > MEDIA_URL_MAX) return `영상 URL이 너무 길다 (${MEDIA_URL_MAX}자 이내)`;
    if (!parseVideoUrl(videoUrl)) {
      return '영상은 유튜브 링크여야 한다 (youtube.com/watch, youtu.be, /shorts)';
    }
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

  const limited = await checkRateLimit(env, ADD_QUESTION, uid);
  if (!limited.ok) return tooManyRequests(limited);

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

  const imageUrl = q.imageUrl?.trim() || null;
  // 유저가 준 URL은 여기서 버리고 id만 남긴다 — 저장되는 건 파싱 결과뿐이다.
  const video = q.videoUrl?.trim() ? parseVideoUrl(q.videoUrl.trim()) : null;

  const existing = await env.DB.prepare(
    `SELECT q.body, q.image_url, q.video_id FROM questions q JOIN question_topics qt ON qt.question_id = q.id WHERE qt.topic_id = ?`,
  )
    .bind(topicId)
    .all<{ body: string; image_url: string | null; video_id: string | null }>();
  // 미디어 문제는 문구가 같아도 사진·영상이 다르면 다른 문항이다
  // ("이 새의 학명은?" + 사진). 붙은 미디어까지 같아야 진짜 중복.
  const dupe = (existing.results ?? []).some(
    (r) =>
      normalize(r.body) === normalize(q.body!.trim()) &&
      (r.image_url ?? null) === imageUrl &&
      (r.video_id ?? null) === (video?.id ?? null),
  );
  if (dupe) return json({ error: '이미 같은 문항이 있다' }, { status: 409 });

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const choicesJson = q.type === 'MULTIPLE_CHOICE' ? JSON.stringify(q.choices) : null;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO questions
         (id, type, difficulty, body, choices_json, answer, explanation, status, source, generated_by, author_uid, created_at, image_url, video_kind, video_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', 'manual', NULL, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      q.type,
      q.difficulty,
      q.body!.trim(),
      choicesJson,
      q.answer,
      q.explanation!.trim(),
      uid,
      now,
      imageUrl,
      video?.kind ?? null,
      video?.id ?? null,
    ),
    env.DB.prepare('INSERT INTO question_topics (question_id, topic_id) VALUES (?, ?)').bind(id, topicId),
  ]);

  return json(await recountTopic(env, topicId, now, author.nickname));
}

/** 문항이 늘거나 줄 때마다 주제의 문항 수와 하한 게이트를 다시 계산한다.
 *
 *  추가와 삭제가 **반드시 같은 규칙**을 써야 한다. 한쪽만 고치면 문항을
 *  지웠는데 active로 남아 있는(=플레이하면 문항이 모자라는) 주제가 생긴다.
 *  그래서 양쪽이 이 함수 하나를 부른다. */
async function recountTopic(
  env: CommunityEnv,
  topicId: string,
  now: string,
  authorNickname: string,
): Promise<CommunityTopicPayload> {
  // build-seed.mjs와 같은 규칙, 다만 공식 주제보다 훨씬 낮은 기준으로.
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

  // 하한 아래로 내려가면 active였던 주제도 draft로 되돌린다.
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

  return {
    id: topicId,
    name: topicRow?.name ?? '',
    tagline: topicRow?.tagline ?? null,
    status,
    questionCount: { '1': byDiff[1], '2': byDiff[2], '3': byDiff[3], '4': byDiff[4] },
    authorNickname,
    isMine: true,
    createdAt: topicRow?.created_at ?? now,
  };
}

/** 주제가 존재하고 그 주인이 나인지 확인한다. 문항 목록·삭제가 공유한다. */
async function requireTopicOwner(
  env: CommunityEnv,
  uid: string,
  topicId: string,
  what: string,
): Promise<{ ok: true; authorUid: string } | { ok: false; res: Response }> {
  const topic = await env.DB.prepare(
    "SELECT author_uid FROM topics WHERE id = ? AND source = 'community'",
  )
    .bind(topicId)
    .first<{ author_uid: string }>();
  if (!topic) return { ok: false, res: json({ error: 'community topic not found' }, { status: 404 }) };
  if (topic.author_uid !== uid) {
    return { ok: false, res: json({ error: `only the topic author can ${what}` }, { status: 403 }) };
  }
  return { ok: true, authorUid: topic.author_uid };
}

/** ⚠ **작성자 본인에게만** 준다. 응답에 정답과 해설이 실려 나가기 때문이다 —
 *  남이 이걸 볼 수 있으면 그 주제는 정답표를 펴놓고 푸는 것과 같아진다.
 *  (서버 채점을 두고 출제 시점에 정답을 안 내려보내는 것과 같은 경계선이다.)
 *
 *  자기 문항을 볼 수 있어야 하는 이유: 오타나 죽은 영상 링크를 발견해도
 *  예전엔 주제를 통째로 지우는 것 말고는 손쓸 방법이 없었다. */
export async function handleListCommunityQuestions(
  env: CommunityEnv,
  uid: string,
  topicId: string,
): Promise<Response> {
  const owner = await requireTopicOwner(env, uid, topicId, 'list questions');
  if (!owner.ok) return owner.res;

  const { results } = await env.DB.prepare(
    `SELECT q.id, q.type, q.difficulty, q.body, q.choices_json, q.answer, q.explanation,
            q.image_url, q.video_kind, q.video_id, q.created_at
       FROM questions q JOIN question_topics qt ON qt.question_id = q.id
      WHERE qt.topic_id = ?
      ORDER BY q.difficulty, q.created_at`,
  )
    .bind(topicId)
    .all<{
      id: string;
      type: QuestionType;
      difficulty: Difficulty;
      body: string;
      choices_json: string | null;
      answer: string;
      explanation: string;
      image_url: string | null;
      video_kind: string | null;
      video_id: string | null;
      created_at: string;
    }>();

  const questions: CommunityQuestionPayload[] = (results ?? []).map((r) => ({
    id: r.id,
    type: r.type,
    difficulty: r.difficulty,
    body: r.body,
    choices: r.choices_json ? (JSON.parse(r.choices_json) as string[]) : null,
    answer: r.answer,
    explanation: r.explanation,
    imageUrl: r.image_url,
    video: videoFromStored(r.video_kind, r.video_id),
    createdAt: r.created_at,
  }));
  return json(questions);
}

/** 문항 하나만 지운다. 주제 전체를 날리지 않고 실수를 고칠 수 있는 유일한 길
 *  (고치기 = 지우고 다시 넣기). 지운 뒤 게이트를 다시 계산하므로, 하한 아래로
 *  내려가면 active였던 주제가 draft로 되돌아간다. */
export async function handleDeleteCommunityQuestion(
  env: CommunityEnv,
  uid: string,
  topicId: string,
  questionId: string,
): Promise<Response> {
  const owner = await requireTopicOwner(env, uid, topicId, 'delete questions');
  if (!owner.ok) return owner.res;

  // 이 문항이 정말 이 주제에 속하는지 확인한다 — 없으면 남의 문항 id를 넣어
  // 지우는 경로가 된다. 주제 소유 확인만으로는 부족하다.
  const linked = await env.DB.prepare(
    'SELECT 1 AS x FROM question_topics WHERE topic_id = ? AND question_id = ?',
  )
    .bind(topicId, questionId)
    .first<{ x: number }>();
  if (!linked) return json({ error: 'question not found in this topic' }, { status: 404 });

  const author = await requireAuthor(env, uid);
  if (!author.ok) return author.res;

  await env.DB.batch([
    // question_stats에는 questions(id) FK가 없다 — 그냥 두면 참조 대상이
    // 사라진 행이 남으므로 먼저 지운다.
    env.DB.prepare('DELETE FROM question_stats WHERE question_id = ?').bind(questionId),
    env.DB.prepare('DELETE FROM question_topics WHERE topic_id = ? AND question_id = ?').bind(topicId, questionId),
    // author_uid 조건은 공식 문항 보호용. NOT EXISTS는 혹시 이 문항이 다른
    // 주제에도 걸려 있다면 남겨두기 위한 것 — 지금 커뮤니티 문항은 주제
    // 하나에만 붙지만, 조건이 안전하게 쓰여 있어야 나중에 다치지 않는다.
    env.DB.prepare(
      `DELETE FROM questions
        WHERE id = ? AND author_uid = ?
          AND NOT EXISTS (SELECT 1 FROM question_topics WHERE question_id = ?)`,
    ).bind(questionId, uid, questionId),
  ]);

  return json(await recountTopic(env, topicId, new Date().toISOString(), author.nickname));
}

/** 작성자 본인만, 언제든(초안이든 활성이든) 자기 주제를 지울 수 있다.
 *  FK 제약 때문에 이 주제를 참조하는 행을 전부 먼저 지운 뒤 topics를 지운다. */
export async function handleDeleteCommunityTopic(env: CommunityEnv, uid: string, topicId: string): Promise<Response> {
  const topic = await env.DB.prepare(
    "SELECT author_uid FROM topics WHERE id = ? AND source = 'community'",
  )
    .bind(topicId)
    .first<{ author_uid: string }>();
  if (!topic) return json({ error: 'community topic not found' }, { status: 404 });
  if (topic.author_uid !== uid) return json({ error: 'only the topic author can delete it' }, { status: 403 });

  const linked = await env.DB.prepare('SELECT question_id FROM question_topics WHERE topic_id = ?')
    .bind(topicId)
    .all<{ question_id: string }>();
  const questionIds = (linked.results ?? []).map((r) => r.question_id);

  const stmts = [
    env.DB.prepare('DELETE FROM question_topics WHERE topic_id = ?').bind(topicId),
    env.DB.prepare('DELETE FROM runs WHERE topic_id = ?').bind(topicId),
    env.DB.prepare('DELETE FROM topic_best WHERE topic_id = ?').bind(topicId),
    env.DB.prepare('DELETE FROM topic_best_weekly WHERE topic_id = ?').bind(topicId),
  ];
  if (questionIds.length) {
    const placeholders = questionIds.map(() => '?').join(',');
    // question_stats도 questions(id)를 참조한다 — 이 문항들이 한 번이라도 출제됐다면
    // (worker/index.ts의 statsUpdates) 행이 생겨 있으므로 먼저 지워야 FK를 안 어긴다.
    stmts.push(env.DB.prepare(`DELETE FROM question_stats WHERE question_id IN (${placeholders})`).bind(...questionIds));
    stmts.push(env.DB.prepare(`DELETE FROM questions WHERE id IN (${placeholders})`).bind(...questionIds));
  }
  stmts.push(env.DB.prepare('DELETE FROM topics WHERE id = ?').bind(topicId));
  await env.DB.batch(stmts);

  return json({ deleted: true });
}

/** finalizeRun이 랭킹 반영 여부를 결정하려고 부른다 (worker/index.ts). */
export async function isRankedTopic(env: CommunityEnv, topicId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT source FROM topics WHERE id = ?').bind(topicId).first<{ source: string }>();
  return (row?.source ?? 'official') === 'official';
}
