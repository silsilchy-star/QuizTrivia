// 게임 루프 통합 테스트 — 워커를 실제로 fetch해서 세션부터 판 종료까지 돌린다.
// 특히 서버 채점(PLAN 7.5절 A안)의 보안 속성을 검증한다: 정답이 채점 전에
// 클라이언트로 새지 않는가, 서버가 내지 않은 문항을 제출할 수 있는가.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ServedQuestion, StartRunResponse, SubmitStageResponse } from '../src/types';
import {
  Client,
  answerKeyFor,
  createPlayableTopic,
  createQuestion,
  createTopic,
  newSession,
} from './helpers';

describe('세션', () => {
  it('처음 부르면 익명 세션과 쿠키를 발급한다', async () => {
    const client = new Client();
    const res = await client.fetch('/api/session', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isAnonymous: true, nickname: null });
    const cookie = res.headers.get('Set-Cookie');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('쿠키를 들고 다시 부르면 같은 계정을 유지한다 — 매번 새 계정을 만들지 않는다', async () => {
    const client = await newSession();
    const first = client.uid;
    await client.json('/api/session', { method: 'POST' });
    expect(client.uid).toBe(first);

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE uid = ?')
      .bind(first)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it('세션 없이 판을 시작할 수 없다', async () => {
    const res = await new Client().fetch('/api/runs', {
      method: 'POST',
      body: JSON.stringify({ topicId: 'whatever' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('주제 목록', () => {
  it('active인 공식 주제만 노출한다 — draft와 커뮤니티 주제는 빠진다', async () => {
    const active = await createTopic({ name: '공개주제', status: 'active' });
    const draft = await createTopic({ name: '초안주제', status: 'draft' });
    const community = await createTopic({ name: '창작주제', status: 'active', source: 'community' });

    const topics = await new Client().json<{ id: string }[]>('/api/topics');
    const ids = topics.map((t) => t.id);
    expect(ids).toContain(active);
    expect(ids).not.toContain(draft);
    expect(ids).not.toContain(community);
  });
});

describe('판 시작', () => {
  let client: Client;
  beforeEach(async () => {
    client = await newSession();
  });

  it('난이도 1 문항 5개를 낸다', async () => {
    const topicId = await createPlayableTopic();
    const run = await client.json<StartRunResponse>('/api/runs', {
      method: 'POST',
      body: JSON.stringify({ topicId }),
    });
    expect(run.stage).toBe(1);
    expect(run.totalStages).toBe(12);
    expect(run.questions).toHaveLength(5);
    expect(run.questions.every((q) => q.difficulty === 1)).toBe(true);
  });

  // 서버 채점 A안의 핵심 — 정답을 미리 내려주면 서버 채점의 의미가 없다.
  it('출제 응답에 정답과 해설이 들어있지 않다', async () => {
    const topicId = await createPlayableTopic();
    const res = await client.fetch('/api/runs', { method: 'POST', body: JSON.stringify({ topicId }) });
    const raw = await res.text();
    expect(raw).not.toContain('"answer"');
    expect(raw).not.toContain('"explanation"');
  });

  it('draft 주제로는 판을 시작할 수 없다', async () => {
    const topicId = await createTopic({ status: 'draft' });
    const res = await client.fetch('/api/runs', { method: 'POST', body: JSON.stringify({ topicId }) });
    expect(res.status).toBe(404);
  });

  it('문항이 5개 미만이면 시작을 거부한다 — 빈 스테이지가 나오지 않게', async () => {
    const topicId = await createTopic({ status: 'active' });
    await createQuestion({ topicId, difficulty: 1 });
    const res = await client.fetch('/api/runs', { method: 'POST', body: JSON.stringify({ topicId }) });
    expect(res.status).toBe(409);
  });

  it('topicId가 없으면 400', async () => {
    const res = await client.fetch('/api/runs', { method: 'POST', body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });
});

describe('스테이지 채점', () => {
  let client: Client;
  let topicId: string;
  let run: StartRunResponse;

  beforeEach(async () => {
    client = await newSession();
    topicId = await createPlayableTopic();
    run = await client.json<StartRunResponse>('/api/runs', {
      method: 'POST',
      body: JSON.stringify({ topicId }),
    });
  });

  async function submit(questions: { id: string }[], correctCount: number): Promise<SubmitStageResponse> {
    const key = await answerKeyFor(questions.map((q) => q.id));
    const answers = questions.map((q, i) => ({
      questionId: q.id,
      given: i < correctCount ? key.get(q.id)! : '틀린답',
    }));
    return client.json<SubmitStageResponse>(`/api/runs/${run.runId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
    });
  }

  it('4문항 이상 맞히면 클리어하고 다음 스테이지가 나온다', async () => {
    const result = await submit(run.questions, 4);
    expect(result.correctCount).toBe(4);
    expect(result.cleared).toBe(true);
    expect(result.runOver).toBe(false);
    expect(result.nextStage?.stage).toBe(2);
    expect(result.nextStage?.questions).toHaveLength(5);
  });

  it('3문항만 맞히면 판이 거기서 끝난다', async () => {
    const result = await submit(run.questions, 3);
    expect(result.cleared).toBe(false);
    expect(result.runOver).toBe(true);
    expect(result.final?.stagesCleared).toBe(0);
  });

  it('점수는 맞힌 문항의 난이도×10 합이다 (PLAN 5.1절)', async () => {
    const result = await submit(run.questions, 5);
    // 난이도 1 문항 5개 전부 정답 → 5 × 1 × 10 = 50
    expect(result.stageScore).toBe(50);
  });

  it('채점 결과에는 정답과 해설이 들어온다 — 이 시점부터는 공개해도 된다', async () => {
    const result = await submit(run.questions, 5);
    expect(result.results).toHaveLength(5);
    expect(result.results.every((r) => typeof r.answer === 'string' && r.answer.length > 0)).toBe(true);
    expect(result.results.every((r) => typeof r.explanation === 'string')).toBe(true);
  });

  // 서버 채점 A안의 두 번째 보안 속성.
  it('서버가 내지 않은 문항을 제출하면 무시된다', async () => {
    const otherTopic = await createPlayableTopic();
    const intruder = await createQuestion({ topicId: otherTopic, difficulty: 4, answer: '가' });

    const key = await answerKeyFor(run.questions.map((q) => q.id));
    const result = await client.json<SubmitStageResponse>(`/api/runs/${run.runId}/submit`, {
      method: 'POST',
      body: JSON.stringify({
        answers: [
          ...run.questions.map((q) => ({ questionId: q.id, given: key.get(q.id)! })),
          { questionId: intruder, given: '가' }, // 낸 적 없는 난이도 4 문항
        ],
      }),
    });
    // 채점은 서버가 낸 5문항만 대상 — 침입 문항의 40점이 붙으면 안 된다.
    expect(result.results).toHaveLength(5);
    expect(result.stageScore).toBe(50);
    expect(result.results.some((r) => r.questionId === intruder)).toBe(false);
  });

  it('남의 판은 채점할 수 없다', async () => {
    const other = await newSession();
    const res = await other.fetch(`/api/runs/${run.runId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers: [] }),
    });
    expect(res.status).toBe(404);
  });

  it('이미 끝난 판에는 다시 제출할 수 없다', async () => {
    await submit(run.questions, 0);
    const res = await client.fetch(`/api/runs/${run.runId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers: [] }),
    });
    expect(res.status).toBe(409);
  });

  it('answers가 배열이 아니면 400', async () => {
    const res = await client.fetch(`/api/runs/${run.runId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers: 'nope' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('12스테이지 완주', () => {
  it('만점은 1500점이고, 판 전체에서 문항이 한 번도 겹치지 않는다 (PLAN 4.3절)', async () => {
    const client = await newSession();
    const topicId = await createPlayableTopic();
    let current = await client.json<StartRunResponse>('/api/runs', {
      method: 'POST',
      body: JSON.stringify({ topicId }),
    });

    const seen: string[] = [];
    let stage = 1;
    let last: SubmitStageResponse | null = null;

    while (true) {
      const questions: ServedQuestion[] = stage === 1 ? current.questions : last!.nextStage!.questions;
      expect(questions.every((q) => q.difficulty === Math.min(4, Math.ceil(stage / 3)))).toBe(true);
      seen.push(...questions.map((q) => q.id));

      const key = await answerKeyFor(questions.map((q) => q.id));
      last = await client.json<SubmitStageResponse>(`/api/runs/${current.runId}/submit`, {
        method: 'POST',
        body: JSON.stringify({
          answers: questions.map((q) => ({ questionId: q.id, given: key.get(q.id)! })),
        }),
      });
      if (last.runOver) break;
      stage += 1;
    }

    expect(stage).toBe(12);
    expect(last.final?.stagesCleared).toBe(12);
    expect(last.final?.totalScore).toBe(1500);
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60); // 무중복
  });
});

describe('문항 통계', () => {
  it('출제·정답 수가 question_stats에 쌓인다 (난이도 재검토의 근거)', async () => {
    const client = await newSession();
    const topicId = await createPlayableTopic();
    const run = await client.json<StartRunResponse>('/api/runs', {
      method: 'POST',
      body: JSON.stringify({ topicId }),
    });
    const key = await answerKeyFor(run.questions.map((q) => q.id));
    await client.fetch(`/api/runs/${run.runId}/submit`, {
      method: 'POST',
      body: JSON.stringify({
        answers: run.questions.map((q, i) => ({
          questionId: q.id,
          given: i < 2 ? key.get(q.id)! : '틀린답',
        })),
      }),
    });

    const ids = run.questions.map((q) => q.id);
    const { results } = await env.DB.prepare(
      `SELECT served_count, correct_count FROM question_stats WHERE question_id IN (${ids.map(() => '?').join(',')})`,
    )
      .bind(...ids)
      .all<{ served_count: number; correct_count: number }>();

    expect(results).toHaveLength(5);
    expect(results!.every((r) => r.served_count === 1)).toBe(true);
    expect(results!.reduce((sum, r) => sum + r.correct_count, 0)).toBe(2);
  });
});
