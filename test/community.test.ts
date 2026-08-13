// 창작마당 + 랭킹 경계선 테스트.
//
// 이 프로젝트에서 가장 중요한 불변식은 "커뮤니티 콘텐츠는 랭킹에 절대
// 반영되지 않는다"이다. 사람 검수가 없는 콘텐츠가 공식 랭킹에 섞이면
// 랭킹 전체의 신뢰가 무너지기 때문이다. 그 경계가 코드 여기저기에
// 흩어져 있어서(finalizeRun / isRankedTopic / handleTopics), 테스트로
// 못을 박아 둔다.
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type {
  RankingBoardResponse,
  RunFinalSummary,
  StartRunResponse,
  SubmitStageResponse,
} from '../src/types';
import { createPlayableTopic, createTopic, uniqueId } from './helpers';

/** RunFinalSummary는 ranked로 갈라지는 판별 유니온이다 — 랭킹 필드를 보려면
 *  먼저 ranked=true임을 확인해야 한다. 타입 자체가 경계선을 강제한다. */
function expectRanked(final: RunFinalSummary | undefined) {
  expect(final).toBeDefined();
  if (!final?.ranked) throw new Error('랭킹 반영된 판이 아니다');
  return final;
}

class Client {
  cookie = '';

  async fetch(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    headers.set('Content-Type', 'application/json');
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
    return (await (await this.fetch(path, init)).json()) as T;
  }

  get uid(): string {
    return this.cookie.replace('session=', '');
  }
}

async function newSession(): Promise<Client> {
  const client = new Client();
  await client.fetch('/api/session', { method: 'POST' });
  return client;
}

/** 구글 로그인을 흉내 낸다 — OAuth 왕복 없이 계정 승계 이후 상태만 만든다. */
async function logIn(client: Client, nickname: string): Promise<void> {
  await env.DB.prepare('UPDATE users SET is_anonymous = 0, google_sub = ?, updated_at = ? WHERE uid = ?')
    .bind(uniqueId('sub'), new Date().toISOString(), client.uid)
    .run();
  await client.fetch('/api/nickname', { method: 'POST', body: JSON.stringify({ nickname }) });
}

/** 주제를 끝까지(또는 실패할 때까지) 플레이하고 최종 요약을 돌려준다. */
async function playFullRun(client: Client, topicId: string): Promise<SubmitStageResponse['final']> {
  const start = await client.json<StartRunResponse>('/api/runs', {
    method: 'POST',
    body: JSON.stringify({ topicId }),
  });
  let questions = start.questions;
  while (true) {
    const ids = questions.map((q) => q.id);
    const { results } = await env.DB.prepare(
      `SELECT id, answer FROM questions WHERE id IN (${ids.map(() => '?').join(',')})`,
    )
      .bind(...ids)
      .all<{ id: string; answer: string }>();
    const key = new Map((results ?? []).map((r) => [r.id, r.answer]));

    const res = await client.json<SubmitStageResponse>(`/api/runs/${start.runId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers: ids.map((id) => ({ questionId: id, given: key.get(id)! })) }),
    });
    if (res.runOver) return res.final;
    questions = res.nextStage!.questions;
  }
}

describe('창작마당 권한', () => {
  it('익명 유저는 주제를 만들 수 없다', async () => {
    const client = await newSession();
    const res = await client.fetch('/api/community/topics', {
      method: 'POST',
      body: JSON.stringify({ name: '내주제' }),
    });
    expect(res.status).toBe(403);
  });

  it('로그인했어도 닉네임이 없으면 만들 수 없다', async () => {
    const client = await newSession();
    await env.DB.prepare('UPDATE users SET is_anonymous = 0 WHERE uid = ?').bind(client.uid).run();
    const res = await client.fetch('/api/community/topics', {
      method: 'POST',
      body: JSON.stringify({ name: '내주제' }),
    });
    expect(res.status).toBe(403);
  });

  it('로그인 + 닉네임이 있으면 draft 주제가 만들어진다', async () => {
    const client = await newSession();
    await logIn(client, '창작자');
    const topic = await client.json<{ id: string; status: string; isMine: boolean }>('/api/community/topics', {
      method: 'POST',
      body: JSON.stringify({ name: '내주제', tagline: '설명' }),
    });
    expect(topic.status).toBe('draft');
    expect(topic.isMine).toBe(true);
  });

  it('이름이 비었거나 30자를 넘으면 거부한다', async () => {
    const client = await newSession();
    await logIn(client, '창작자');
    for (const name of ['', ' ', 'ㄱ'.repeat(31)]) {
      const res = await client.fetch('/api/community/topics', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      expect(res.status).toBe(400);
    }
  });

  it('남의 주제에는 문항을 추가할 수 없다', async () => {
    const owner = await newSession();
    await logIn(owner, '주인');
    const topic = await owner.json<{ id: string }>('/api/community/topics', {
      method: 'POST',
      body: JSON.stringify({ name: '주인주제' }),
    });

    const stranger = await newSession();
    await logIn(stranger, '남');
    const res = await stranger.fetch(`/api/community/topics/${topic.id}/questions`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'MULTIPLE_CHOICE',
        difficulty: 1,
        body: '문제',
        choices: ['가', '나', '다', '라'],
        answer: '가',
        explanation: '해설',
      }),
    });
    expect(res.status).toBe(403);
  });

  it('남의 주제는 삭제할 수 없다', async () => {
    const owner = await newSession();
    await logIn(owner, '주인2');
    const topic = await owner.json<{ id: string }>('/api/community/topics', {
      method: 'POST',
      body: JSON.stringify({ name: '주인주제2' }),
    });

    const stranger = await newSession();
    await logIn(stranger, '남2');
    const res = await stranger.fetch(`/api/community/topics/${topic.id}`, { method: 'DELETE' });
    expect(res.status).toBe(403);

    const still = await env.DB.prepare('SELECT id FROM topics WHERE id = ?').bind(topic.id).first();
    expect(still).not.toBeNull();
  });
});

describe('창작마당 하한 게이트', () => {
  it('난이도당 5문항을 채우면 draft에서 active로 올라간다', async () => {
    const client = await newSession();
    await logIn(client, '성실한창작자');
    const topic = await client.json<{ id: string }>('/api/community/topics', {
      method: 'POST',
      body: JSON.stringify({ name: '게이트주제' }),
    });

    let last: { status: string; questionCount: Record<string, number> } | null = null;
    for (const d of [1, 2, 3, 4]) {
      for (let i = 0; i < 5; i += 1) {
        last = await client.json(`/api/community/topics/${topic.id}/questions`, {
          method: 'POST',
          body: JSON.stringify({
            type: 'MULTIPLE_CHOICE',
            difficulty: d,
            body: `난이도${d} 문항${i}`,
            choices: ['가', '나', '다', '라'],
            answer: '가',
            explanation: '해설',
          }),
        });
        // 마지막 한 문항이 채워지기 전까지는 계속 draft여야 한다.
        if (!(d === 4 && i === 4)) expect(last!.status).toBe('draft');
      }
    }
    expect(last!.status).toBe('active');
    expect(last!.questionCount).toEqual({ '1': 5, '2': 5, '3': 5, '4': 5 });
  });

  it('같은 주제에 같은 문항을 두 번 넣을 수 없다', async () => {
    const client = await newSession();
    await logIn(client, '중복테스트');
    const topic = await client.json<{ id: string }>('/api/community/topics', {
      method: 'POST',
      body: JSON.stringify({ name: '중복주제' }),
    });
    const question = {
      type: 'MULTIPLE_CHOICE',
      difficulty: 1,
      body: '똑같은 문제',
      choices: ['가', '나', '다', '라'],
      answer: '가',
      explanation: '해설',
    };
    const first = await client.fetch(`/api/community/topics/${topic.id}/questions`, {
      method: 'POST',
      body: JSON.stringify(question),
    });
    expect(first.status).toBe(200);

    // 문장부호와 공백만 다른 것도 같은 문항으로 본다.
    const second = await client.fetch(`/api/community/topics/${topic.id}/questions`, {
      method: 'POST',
      body: JSON.stringify({ ...question, body: '똑 같은 문제?' }),
    });
    expect(second.status).toBe(409);
  });
});

describe('⚠ 랭킹 경계선 — 커뮤니티 주제는 랭킹에 반영되지 않는다', () => {
  it('커뮤니티 주제를 완주해도 ranked=false이고 점수가 남지 않는다', async () => {
    const client = await newSession();
    await logIn(client, '커뮤니티플레이어');
    const topicId = await createPlayableTopic(15, 'community');
    await env.DB.prepare("UPDATE topics SET status = 'active' WHERE id = ?").bind(topicId).run();

    const final = await playFullRun(client, topicId);

    expect(final?.ranked).toBe(false);
    expect(final?.totalScore).toBe(1500); // 판 점수 자체는 나온다

    // 그런데 랭킹 관련 테이블에는 아무것도 남지 않아야 한다.
    const best = await env.DB.prepare('SELECT COUNT(*) AS n FROM topic_best WHERE uid = ?')
      .bind(client.uid)
      .first<{ n: number }>();
    const weekly = await env.DB.prepare('SELECT COUNT(*) AS n FROM topic_best_weekly WHERE uid = ?')
      .bind(client.uid)
      .first<{ n: number }>();
    const user = await env.DB.prepare('SELECT global_score, play_count FROM users WHERE uid = ?')
      .bind(client.uid)
      .first<{ global_score: number; play_count: number }>();

    expect(best?.n).toBe(0);
    expect(weekly?.n).toBe(0);
    expect(user?.global_score).toBe(0);
    expect(user?.play_count).toBe(1); // 플레이 횟수는 세되, 점수는 안 준다
  });

  it('공식 주제는 반대로 ranked=true이고 통합 점수에 합산된다', async () => {
    const client = await newSession();
    await logIn(client, '공식플레이어');
    const topicId = await createPlayableTopic();

    const final = expectRanked(await playFullRun(client, topicId));

    expect(final.ranked).toBe(true);
    expect(final.isNewBest).toBe(true);
    expect(final.globalScore).toBe(1500);
  });

  it('여러 공식 주제 점수가 합산된다 — 폭 보상형 랭킹(D-7)', async () => {
    const client = await newSession();
    await logIn(client, '폭넓은플레이어');
    const a = await createPlayableTopic();
    const b = await createPlayableTopic();

    await playFullRun(client, a);
    const second = expectRanked(await playFullRun(client, b));

    expect(second.globalScore).toBe(3000);
  });

  it('같은 주제를 다시 완주해도 최고점만 남는다 — 반복 플레이로 점수가 누적되지 않는다', async () => {
    const client = await newSession();
    await logIn(client, '반복플레이어');
    const topicId = await createPlayableTopic();

    await playFullRun(client, topicId);
    const again = expectRanked(await playFullRun(client, topicId));

    expect(again.globalScore).toBe(1500);
    expect(again.isNewBest).toBe(false);
  });
});

describe('랭킹 보드', () => {
  it('로그인한 유저만 보드에 오른다 — 익명 기록은 집계되지 않는다', async () => {
    const anon = await newSession();
    const topicId = await createPlayableTopic();
    await playFullRun(anon, topicId);

    const named = await newSession();
    await logIn(named, '보드유저');
    await playFullRun(named, topicId);

    const board = await named.json<RankingBoardResponse>('/api/rankings/global_all_time');
    const nicknames = board.top.map((e) => e.nickname);
    expect(nicknames).toContain('보드유저');
    expect(board.top.every((e) => e.nickname !== null)).toBe(true);
  });

  it('보드 응답에 다른 사람의 uid가 들어있지 않다', async () => {
    const client = await newSession();
    await logIn(client, '노출테스트');
    await playFullRun(client, await createPlayableTopic());

    const raw = await (await client.fetch('/api/rankings/global_all_time')).text();
    expect(raw).not.toContain(client.uid);
    expect(raw).not.toContain('"uid"');
  });

  it('알 수 없는 보드 id는 404', async () => {
    const res = await new Client().fetch('/api/rankings/global_daily');
    expect(res.status).toBe(404);
  });

  it('주제별 순위는 그 주제 점수만 보여준다', async () => {
    const client = await newSession();
    await logIn(client, '주제별유저');
    const a = await createPlayableTopic();
    const b = await createPlayableTopic();
    await playFullRun(client, a);
    await playFullRun(client, b);

    const board = await client.json<{ me: { score: number; rank: number } | null }>(
      `/api/rankings/topic/${a}`,
    );
    expect(board.me?.score).toBe(1500); // 통합 3000이 아니라 이 주제 점수
    expect(board.me?.rank).toBe(1);
  });
});

describe('주제 삭제', () => {
  it('내 주제를 지우면 문항·연결·통계까지 함께 사라진다', async () => {
    const client = await newSession();
    await logIn(client, '삭제테스트');
    const topic = await client.json<{ id: string }>('/api/community/topics', {
      method: 'POST',
      body: JSON.stringify({ name: '지울주제' }),
    });
    await client.fetch(`/api/community/topics/${topic.id}/questions`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'MULTIPLE_CHOICE',
        difficulty: 1,
        body: '지워질 문제',
        choices: ['가', '나', '다', '라'],
        answer: '가',
        explanation: '해설',
      }),
    });

    const res = await client.fetch(`/api/community/topics/${topic.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const t = await env.DB.prepare('SELECT id FROM topics WHERE id = ?').bind(topic.id).first();
    const links = await env.DB.prepare('SELECT COUNT(*) AS n FROM question_topics WHERE topic_id = ?')
      .bind(topic.id)
      .first<{ n: number }>();
    const orphans = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM questions WHERE author_uid = ? AND body = ?',
    )
      .bind(client.uid, '지워질 문제')
      .first<{ n: number }>();

    expect(t).toBeNull();
    expect(links?.n).toBe(0);
    expect(orphans?.n).toBe(0);
  });

  it('공식 주제는 창작마당 API로 지울 수 없다', async () => {
    const client = await newSession();
    await logIn(client, '공식삭제시도');
    const official = await createTopic({ status: 'active', source: 'official' });
    const res = await client.fetch(`/api/community/topics/${official}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
