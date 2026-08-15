// 창작마당 + 랭킹 경계선 테스트.
//
// 이 프로젝트에서 가장 중요한 불변식은 "커뮤니티 콘텐츠는 랭킹에 절대
// 반영되지 않는다"이다. 사람 검수가 없는 콘텐츠가 공식 랭킹에 섞이면
// 랭킹 전체의 신뢰가 무너지기 때문이다. 그 경계가 코드 여기저기에
// 흩어져 있어서(finalizeRun / isRankedTopic / handleTopics), 테스트로
// 못을 박아 둔다.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type {
  CommunityQuestion,
  CommunityTopic,
  Difficulty,
  RankingBoardResponse,
  RunFinalSummary,
  StartRunResponse,
  SubmitStageResponse,
} from '../src/types';
import { Client, createPlayableTopic, createQuestion, createTopic, logIn, newSession } from './helpers';

/** RunFinalSummary는 ranked로 갈라지는 판별 유니온이다 — 랭킹 필드를 보려면
 *  먼저 ranked=true임을 확인해야 한다. 타입 자체가 경계선을 강제한다. */
function expectRanked(final: RunFinalSummary | undefined) {
  expect(final).toBeDefined();
  if (!final?.ranked) throw new Error('랭킹 반영된 판이 아니다');
  return final;
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

describe('문항에 붙는 미디어 — 이미지 링크와 유튜브 영상', () => {
  const ID = 'dQw4w9WgXcQ';

  /** 로그인된 창작자 + 빈 주제 하나. */
  async function author(nickname: string) {
    const client = await newSession();
    await logIn(client, nickname);
    const topic = await client.json<{ id: string }>('/api/community/topics', {
      method: 'POST',
      body: JSON.stringify({ name: `${nickname}주제` }),
    });
    return { client, topicId: topic.id };
  }

  function question(extra: Record<string, unknown>) {
    return JSON.stringify({
      type: 'TEXT_INPUT',
      difficulty: 1,
      body: '이 영상 속 곡의 제목은?',
      answer: '정답',
      explanation: '해설',
      ...extra,
    });
  }

  it.each([
    ['watch 링크', `https://www.youtube.com/watch?v=${ID}`],
    ['단축 링크', `https://youtu.be/${ID}`],
    ['쇼츠', `https://www.youtube.com/shorts/${ID}`],
  ])('%s로 영상 문항을 만들 수 있다', async (label, videoUrl) => {
    const { client, topicId } = await author(`영상${label}`);
    const res = await client.fetch(`/api/community/topics/${topicId}/questions`, {
      method: 'POST',
      body: question({ videoUrl }),
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare(
      `SELECT q.video_kind, q.video_id, q.image_url FROM questions q
         JOIN question_topics qt ON qt.question_id = q.id WHERE qt.topic_id = ?`,
    )
      .bind(topicId)
      .first<{ video_kind: string | null; video_id: string | null; image_url: string | null }>();

    // 저장되는 건 파싱 결과뿐 — 유저가 준 URL은 어디에도 남지 않는다.
    expect(row).toEqual({ video_kind: 'youtube', video_id: ID, image_url: null });
  });

  it('출제·채점 응답에는 서버가 조립한 임베드 주소가 내려간다', async () => {
    const topicId = await createTopic({ name: '영상주제' });
    for (let i = 0; i < 5; i += 1) {
      await createQuestion({ topicId, difficulty: 1, videoKind: 'youtube', videoId: ID });
    }

    const client = await newSession();
    const start = await client.json<StartRunResponse>('/api/runs', {
      method: 'POST',
      body: JSON.stringify({ topicId }),
    });

    for (const q of start.questions) {
      expect(q.video).toEqual({
        kind: 'youtube',
        id: ID,
        embedUrl: `https://www.youtube-nocookie.com/embed/${ID}?rel=0&playsinline=1`,
      });
    }

    // 채점 결과(리뷰 화면)에도 같은 영상이 실려야 다시 볼 수 있다.
    const ids = start.questions.map((q) => q.id);
    const graded = await client.json<SubmitStageResponse>(`/api/runs/${start.runId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers: ids.map((id) => ({ questionId: id, given: '가' })) }),
    });
    for (const r of graded.results) {
      expect(r.video?.id).toBe(ID);
    }
  });

  it('영상이 없는 문항은 video가 null로 내려간다', async () => {
    const topicId = await createTopic({ name: '영상없는주제' });
    for (let i = 0; i < 5; i += 1) await createQuestion({ topicId, difficulty: 1 });

    const client = await newSession();
    const start = await client.json<StartRunResponse>('/api/runs', {
      method: 'POST',
      body: JSON.stringify({ topicId }),
    });
    for (const q of start.questions) expect(q.video).toBeNull();
  });

  it('이미지와 영상을 함께 붙일 수는 없다', async () => {
    const { client, topicId } = await author('둘다');
    const res = await client.fetch(`/api/community/topics/${topicId}/questions`, {
      method: 'POST',
      body: question({
        imageUrl: 'https://example.test/a.jpg',
        videoUrl: `https://youtu.be/${ID}`,
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toContain('함께');
  });

  it('유튜브 링크를 이미지 칸에 넣으면 어디에 넣어야 하는지 알려준다', async () => {
    const { client, topicId } = await author('이미지칸유튜브');
    const res = await client.fetch(`/api/community/topics/${topicId}/questions`, {
      method: 'POST',
      body: question({ imageUrl: `https://www.youtube.com/watch?v=${ID}` }),
    });
    // 예전엔 https로 시작하기만 하면 통과해서 화면에 깨진 이미지가 떴다.
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toContain('영상 칸');
  });

  it.each([
    ['유튜브가 아닌 영상 사이트', 'https://vimeo.com/123456789'],
    ['유튜브를 흉내낸 호스트', `https://youtube.com.evil.test/watch?v=${ID}`],
    ['javascript 스킴', 'javascript:alert(1)'],
    ['영상 id가 깨진 링크', 'https://www.youtube.com/watch?v=tooshort'],
  ])('%s는 영상으로 받지 않는다', async (label, videoUrl) => {
    const { client, topicId } = await author(`거부${label.slice(0, 6)}`);
    const res = await client.fetch(`/api/community/topics/${topicId}/questions`, {
      method: 'POST',
      body: question({ videoUrl }),
    });
    expect(res.status).toBe(400);

    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM question_topics WHERE topic_id = ?',
    )
      .bind(topicId)
      .first<{ n: number }>();
    expect(row!.n, '거부된 문항이 저장되면 안 된다').toBe(0);
  });

  it('문구가 같아도 영상이 다르면 다른 문항이다', async () => {
    const { client, topicId } = await author('영상중복');
    const first = await client.fetch(`/api/community/topics/${topicId}/questions`, {
      method: 'POST',
      body: question({ videoUrl: `https://youtu.be/${ID}` }),
    });
    expect(first.status).toBe(200);

    // 같은 영상 + 같은 문구면 중복.
    const same = await client.fetch(`/api/community/topics/${topicId}/questions`, {
      method: 'POST',
      body: question({ videoUrl: `https://www.youtube.com/watch?v=${ID}` }),
    });
    expect(same.status).toBe(409);

    // 영상이 다르면 별개의 문항으로 받아준다.
    const other = await client.fetch(`/api/community/topics/${topicId}/questions`, {
      method: 'POST',
      body: question({ videoUrl: 'https://youtu.be/abcdefghijk' }),
    });
    expect(other.status).toBe(200);
  });
});

describe('내 문항 목록과 개별 삭제', () => {
  /** 로그인된 창작자 + 주제 + 문항 n개(난이도 d). */
  async function withQuestions(nickname: string, d: Difficulty, n: number) {
    const client = await newSession();
    await logIn(client, nickname);
    const topic = await client.json<{ id: string }>('/api/community/topics', {
      method: 'POST',
      body: JSON.stringify({ name: `${nickname}주제` }),
    });
    for (let i = 0; i < n; i += 1) {
      await client.fetch(`/api/community/topics/${topic.id}/questions`, {
        method: 'POST',
        body: JSON.stringify({
          type: 'TEXT_INPUT',
          difficulty: d,
          body: `${nickname} 문항 ${i}`,
          answer: `정답${i}`,
          explanation: '해설',
        }),
      });
    }
    return { client, topicId: topic.id };
  }

  it('작성자는 자기 문항을 정답까지 볼 수 있다', async () => {
    const { client, topicId } = await withQuestions('목록주인', 2, 3);
    const questions = await client.json<CommunityQuestion[]>(`/api/community/topics/${topicId}/questions`);

    expect(questions).toHaveLength(3);
    expect(questions[0].answer).toBe('정답0');
    expect(questions[0].difficulty).toBe(2);
    expect(questions.every((q) => q.explanation === '해설')).toBe(true);
  });

  // ⚠ 이 경계가 무너지면 남의 창작 주제를 정답표 펴놓고 푸는 것과 같아진다.
  it('남은 그 목록을 볼 수 없다 — 정답이 실려 있기 때문', async () => {
    const { topicId } = await withQuestions('목록주인2', 1, 2);

    const stranger = await newSession();
    await logIn(stranger, '남의목록');
    const res = await stranger.fetch(`/api/community/topics/${topicId}/questions`);
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain('정답');
  });

  it('로그인하지 않으면 목록을 볼 수 없다', async () => {
    const { topicId } = await withQuestions('목록주인3', 1, 1);
    const anon = await newSession();
    const res = await anon.fetch(`/api/community/topics/${topicId}/questions`);
    expect(res.status).toBe(403);
  });

  it('문항 하나만 지워지고 나머지는 남는다', async () => {
    const { client, topicId } = await withQuestions('삭제주인', 3, 3);
    const before = await client.json<CommunityQuestion[]>(`/api/community/topics/${topicId}/questions`);

    const topic = await client.json<CommunityTopic>(
      `/api/community/topics/${topicId}/questions/${before[1].id}`,
      { method: 'DELETE' },
    );
    expect(topic.questionCount['3']).toBe(2);

    const after = await client.json<CommunityQuestion[]>(`/api/community/topics/${topicId}/questions`);
    expect(after.map((q) => q.id)).toEqual([before[0].id, before[2].id]);

    // 문항 행 자체가 사라져야 한다 — 연결만 끊고 남으면 고아가 된다.
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM questions WHERE id = ?')
      .bind(before[1].id)
      .first<{ n: number }>();
    expect(row!.n).toBe(0);
  });

  it('남의 문항은 지울 수 없다', async () => {
    const { client, topicId } = await withQuestions('삭제주인2', 1, 2);
    const mine = await client.json<CommunityQuestion[]>(`/api/community/topics/${topicId}/questions`);

    const stranger = await newSession();
    await logIn(stranger, '남의삭제');
    const res = await stranger.fetch(`/api/community/topics/${topicId}/questions/${mine[0].id}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(403);

    const still = await env.DB.prepare('SELECT COUNT(*) AS n FROM questions WHERE id = ?')
      .bind(mine[0].id)
      .first<{ n: number }>();
    expect(still!.n).toBe(1);
  });

  // 내 주제를 소유하고 있어도, 그 주제에 없는 문항 id를 넣어 남의 것을
  // 지울 수 있으면 안 된다.
  it('내 주제에 속하지 않은 문항 id로는 지울 수 없다', async () => {
    const victim = await withQuestions('피해자', 1, 1);
    const victimQs = await victim.client.json<CommunityQuestion[]>(
      `/api/community/topics/${victim.topicId}/questions`,
    );

    const attacker = await withQuestions('공격자', 1, 1);
    const res = await attacker.client.fetch(
      `/api/community/topics/${attacker.topicId}/questions/${victimQs[0].id}`,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(404);

    const still = await env.DB.prepare('SELECT COUNT(*) AS n FROM questions WHERE id = ?')
      .bind(victimQs[0].id)
      .first<{ n: number }>();
    expect(still!.n, '남의 문항이 지워졌다').toBe(1);
  });

  it('하한 아래로 내려가면 active였던 주제가 draft로 되돌아간다', async () => {
    const client = await newSession();
    await logIn(client, '강등테스트');
    const topic = await client.json<{ id: string }>('/api/community/topics', {
      method: 'POST',
      body: JSON.stringify({ name: '강등주제' }),
    });

    let last: CommunityTopic | null = null;
    for (const d of [1, 2, 3, 4] as const) {
      for (let i = 0; i < 5; i += 1) {
        last = await client.json<CommunityTopic>(`/api/community/topics/${topic.id}/questions`, {
          method: 'POST',
          body: JSON.stringify({
            type: 'TEXT_INPUT',
            difficulty: d,
            body: `강등 난이도${d} 문항${i}`,
            answer: '답',
            explanation: '해설',
          }),
        });
      }
    }
    expect(last!.status).toBe('active');

    const questions = await client.json<CommunityQuestion[]>(`/api/community/topics/${topic.id}/questions`);
    const victim = questions.find((q) => q.difficulty === 1)!;
    const after = await client.json<CommunityTopic>(
      `/api/community/topics/${topic.id}/questions/${victim.id}`,
      { method: 'DELETE' },
    );

    expect(after.status).toBe('draft');
    expect(after.questionCount['1']).toBe(4);
  });

  it('이미 출제된 적 있는 문항도 지울 수 있다 — question_stats가 걸리지 않는다', async () => {
    const { client, topicId } = await withQuestions('통계있는주인', 1, 1);
    const [q] = await client.json<CommunityQuestion[]>(`/api/community/topics/${topicId}/questions`);

    // 출제되면 생기는 통계 행을 직접 만든다 (worker/index.ts의 statsUpdates와 같은 모양).
    await env.DB.prepare(
      'INSERT INTO question_stats (question_id, served_count, correct_count, updated_at) VALUES (?, 3, 1, ?)',
    )
      .bind(q.id, new Date().toISOString())
      .run();

    const res = await client.fetch(`/api/community/topics/${topicId}/questions/${q.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const stats = await env.DB.prepare('SELECT COUNT(*) AS n FROM question_stats WHERE question_id = ?')
      .bind(q.id)
      .first<{ n: number }>();
    expect(stats!.n, '통계 행이 고아로 남았다').toBe(0);
  });

  it('영상 문항도 목록에 임베드 주소와 함께 나온다', async () => {
    const client = await newSession();
    await logIn(client, '영상목록');
    const topic = await client.json<{ id: string }>('/api/community/topics', {
      method: 'POST',
      body: JSON.stringify({ name: '영상목록주제' }),
    });
    await client.fetch(`/api/community/topics/${topic.id}/questions`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'TEXT_INPUT',
        difficulty: 1,
        body: '이 영상은?',
        answer: '답',
        explanation: '해설',
        videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
      }),
    });

    const [q] = await client.json<CommunityQuestion[]>(`/api/community/topics/${topic.id}/questions`);
    // 잘못 붙인 링크를 목록에서 눈으로 찾을 수 있어야 한다.
    expect(q.video).toEqual({
      kind: 'youtube',
      id: 'dQw4w9WgXcQ',
      embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1',
    });
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
