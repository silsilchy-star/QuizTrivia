// 랭킹 보드 (PLAN 5.2·5.3절). 통합 2개 보드(global_all_time/global_weekly)만
// UI 메뉴에 노출하고, 주제별 순위는 그 주제 결과 화면 안에서만 보여준다 —
// 데이터가 아니라 UI 층에서 보드 수 폭증을 막는다 (D-15/D-16 대응).
//
// "랭킹 등록은 로그인해야만"(PLAN 5.4절)은 별도 플래그 없이 익명 상태로
// 구현한다: topic_best/topic_best_weekly는 익명 uid에도 처음부터 쌓이지만,
// 모든 랭킹 쿼리가 users.is_anonymous = 0으로 필터링하므로 실제로 화면에
// 뜨는 건 로그인(계정 승계 포함)한 사용자뿐이다. 로그인하는 순간 같은 uid의
// 기존 기록이 그대로 랭킹에 나타나는 것이 곧 "승계"다.
import type { RankingBoardResponse, RankingEntry, TopicRankingResponse } from '../src/types';

export interface RankingEnv {
  DB: D1Database;
}

interface CachedEntry {
  rank: number;
  uid: string;
  nickname: string | null;
  score: number;
}

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

/** ISO 8601 주차. 매주 리셋되는 주간 보드의 키로 쓴다 (PLAN 5.2절 "주간 보드"). */
export function isoWeekId(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // 월=0 ... 일=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // 이번 ISO 주의 목요일로 이동
  const isoYear = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const week = Math.floor((d.getTime() - week1Monday.getTime()) / (7 * 86400000)) + 1;
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** 이번 주 주제별 최고점을 갱신한다. 이미 최고면 아무것도 하지 않고 false를 반환한다. */
export async function upsertWeeklyBest(
  env: RankingEnv,
  uid: string,
  topicId: string,
  score: number,
  now: string,
): Promise<boolean> {
  const weekId = isoWeekId(new Date(now));
  const prev = await env.DB.prepare(
    'SELECT score FROM topic_best_weekly WHERE uid = ? AND topic_id = ? AND week_id = ?',
  )
    .bind(uid, topicId, weekId)
    .first<{ score: number }>();
  const isNew = !prev || score > prev.score;
  if (isNew) {
    await env.DB.prepare(
      `INSERT INTO topic_best_weekly (uid, topic_id, week_id, score, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(uid, topic_id, week_id) DO UPDATE SET
         score = excluded.score, updated_at = excluded.updated_at
         WHERE excluded.score > topic_best_weekly.score`,
    )
      .bind(uid, topicId, weekId, score, now)
      .run();
  }
  return isNew;
}

async function refreshBoard(
  env: RankingEnv,
  boardId: 'global_all_time' | 'global_weekly',
  sql: string,
  params: unknown[],
): Promise<void> {
  const { results } = await env.DB.prepare(sql)
    .bind(...params)
    .all<{ uid: string; nickname: string | null; score: number }>();
  const top: CachedEntry[] = (results ?? []).map((r, i) => ({
    rank: i + 1,
    uid: r.uid,
    nickname: r.nickname,
    score: r.score,
  }));
  const cutoff = top.length === 30 ? top[29].score : null;
  await env.DB.prepare(
    `INSERT INTO ranking_cache (board_id, top_json, cutoff_score, generated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(board_id) DO UPDATE SET
       top_json = excluded.top_json, cutoff_score = excluded.cutoff_score, generated_at = excluded.generated_at`,
  )
    .bind(boardId, JSON.stringify(top), cutoff, new Date().toISOString())
    .run();
}

/** 점수가 실제로 바뀐 판이 끝난 직후에만 호출한다 — 매 판마다 부르면 낭비다 (5.3절). */
export async function refreshGlobalCaches(env: RankingEnv, now: string): Promise<void> {
  const weekId = isoWeekId(new Date(now));
  await refreshBoard(
    env,
    'global_all_time',
    `SELECT uid, nickname, global_score AS score FROM users
      WHERE is_anonymous = 0 AND global_score > 0
      ORDER BY global_score DESC LIMIT 30`,
    [],
  );
  await refreshBoard(
    env,
    'global_weekly',
    `SELECT tbw.uid AS uid, u.nickname AS nickname, SUM(tbw.score) AS score
       FROM topic_best_weekly tbw
       JOIN users u ON u.uid = tbw.uid
      WHERE tbw.week_id = ? AND u.is_anonymous = 0
      GROUP BY tbw.uid
      ORDER BY score DESC LIMIT 30`,
    [weekId],
  );
}

function toPublicEntries(cached: CachedEntry[], viewerUid: string | null): RankingEntry[] {
  return cached.map((e) => ({
    rank: e.rank,
    nickname: e.nickname,
    score: e.score,
    isMe: e.uid === viewerUid,
  }));
}

export async function handleGlobalRanking(
  env: RankingEnv,
  boardId: string,
  viewerUid: string | null,
): Promise<Response> {
  if (boardId !== 'global_all_time' && boardId !== 'global_weekly') {
    return json({ error: 'unknown board' }, { status: 404 });
  }

  const cache = await env.DB.prepare('SELECT top_json, cutoff_score, generated_at FROM ranking_cache WHERE board_id = ?')
    .bind(boardId)
    .first<{ top_json: string | null; cutoff_score: number | null; generated_at: string | null }>();
  const cached: CachedEntry[] = cache?.top_json ? JSON.parse(cache.top_json) : [];
  const top = toPublicEntries(cached, viewerUid);
  const inTop = viewerUid ? cached.some((e) => e.uid === viewerUid) : false;

  let me: RankingBoardResponse['me'] = null;
  if (viewerUid) {
    const viewer = await env.DB.prepare('SELECT is_anonymous, global_score FROM users WHERE uid = ?')
      .bind(viewerUid)
      .first<{ is_anonymous: number; global_score: number }>();
    if (viewer && !viewer.is_anonymous) {
      if (boardId === 'global_all_time') {
        me = { score: viewer.global_score, inTop };
      } else {
        const weekId = isoWeekId(new Date());
        const weekly = await env.DB.prepare(
          'SELECT COALESCE(SUM(score), 0) AS score FROM topic_best_weekly WHERE uid = ? AND week_id = ?',
        )
          .bind(viewerUid, weekId)
          .first<{ score: number }>();
        me = { score: weekly?.score ?? 0, inTop };
      }
    }
  }

  const payload: RankingBoardResponse = {
    boardId,
    top,
    cutoffScore: cache?.cutoff_score ?? null,
    generatedAt: cache?.generated_at ?? null,
    me,
  };
  return json(payload);
}

/** 주제별 순위는 캐시하지 않는다 — topic_id로 이미 좁혀진 인덱스 조회라 저렴하다 (5.3절). */
export async function handleTopicRanking(
  env: RankingEnv,
  topicId: string,
  viewerUid: string | null,
): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT tb.uid AS uid, u.nickname AS nickname, tb.score AS score
       FROM topic_best tb
       JOIN users u ON u.uid = tb.uid
      WHERE tb.topic_id = ? AND u.is_anonymous = 0
      ORDER BY tb.score DESC LIMIT 30`,
  )
    .bind(topicId)
    .all<{ uid: string; nickname: string | null; score: number }>();
  const cached: CachedEntry[] = (results ?? []).map((r, i) => ({ rank: i + 1, ...r }));
  const top = toPublicEntries(cached, viewerUid);

  let me: TopicRankingResponse['me'] = null;
  if (viewerUid) {
    const mine = await env.DB.prepare(
      `SELECT tb.score AS score
         FROM topic_best tb JOIN users u ON u.uid = tb.uid
        WHERE tb.uid = ? AND tb.topic_id = ? AND u.is_anonymous = 0`,
    )
      .bind(viewerUid, topicId)
      .first<{ score: number }>();
    if (mine) {
      const higher = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM topic_best tb JOIN users u ON u.uid = tb.uid
          WHERE tb.topic_id = ? AND u.is_anonymous = 0 AND tb.score > ?`,
      )
        .bind(topicId, mine.score)
        .first<{ n: number }>();
      me = { score: mine.score, rank: (higher?.n ?? 0) + 1 };
    }
  }

  const payload: TopicRankingResponse = { topicId, top, me };
  return json(payload);
}
