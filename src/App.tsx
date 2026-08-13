import { useEffect, useState } from 'react';
import {
  ensureSession,
  getGlobalRanking,
  getTopicRanking,
  getTopics,
  goToGoogleLogin,
  setNickname,
  startRun,
  submitStage,
} from './api';
import type {
  GlobalBoardId,
  RankingBoardResponse,
  RunFinalSummary,
  SessionResponse,
  ServedQuestion,
  SubmitStageResponse,
  Topic,
  TopicRankingResponse,
} from './types';
import { Workshop } from './Workshop';
import './App.css';

interface RunState {
  runId: string;
  topicId: string;
  topicName: string;
  stage: number;
  totalStages: number;
  questions: ServedQuestion[];
}

type Screen =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'topics' }
  | { kind: 'playing'; run: RunState }
  | { kind: 'stageResult'; run: RunState; result: SubmitStageResponse }
  | { kind: 'final'; topicId: string; topicName: string; result: RunFinalSummary }
  | { kind: 'ranking'; board: GlobalBoardId }
  | { kind: 'workshop' };

/** URL의 ?auth= 결과를 한 번만 읽고 지운다 (OAuth 콜백 리다이렉트가 남긴 신호). */
function readAuthNotice(): string | null {
  const params = new URLSearchParams(location.search);
  const auth = params.get('auth');
  if (!auth) return null;
  history.replaceState(null, '', location.pathname);
  if (auth === 'linked') return '로그인 완료 — 기존 플레이 기록이 그대로 이어집니다.';
  if (auth === 'switched') return '이 구글 계정은 이미 다른 기록과 연결되어 있어 그 계정으로 전환했습니다.';
  return '로그인 중 문제가 발생했습니다. 다시 시도해 주세요.';
}

function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });

  useEffect(() => {
    setNotice(readAuthNotice());
    (async () => {
      try {
        setSession(await ensureSession());
        setTopics(await getTopics());
        setScreen({ kind: 'topics' });
      } catch (err) {
        setScreen({ kind: 'error', message: (err as Error).message });
      }
    })();
  }, []);

  async function onSaveNickname(name: string) {
    const res = await setNickname(name);
    setSession((prev) => (prev ? { ...prev, nickname: res.nickname } : prev));
  }

  async function startPlaying(topicId: string, topicName: string) {
    setScreen({ kind: 'loading' });
    try {
      const started = await startRun(topicId);
      setScreen({
        kind: 'playing',
        run: {
          runId: started.runId,
          topicId: started.topicId,
          topicName,
          stage: started.stage,
          totalStages: started.totalStages,
          questions: started.questions,
        },
      });
    } catch (err) {
      setScreen({ kind: 'error', message: (err as Error).message });
    }
  }

  function onPick(topic: Topic) {
    return startPlaying(topic.id, topic.name);
  }

  async function onSubmit(run: RunState, given: Record<string, string>) {
    setScreen({ kind: 'loading' });
    try {
      const answers = run.questions.map((q) => ({ questionId: q.id, given: given[q.id] ?? '' }));
      const result = await submitStage(run.runId, answers);
      setScreen({ kind: 'stageResult', run, result });
    } catch (err) {
      setScreen({ kind: 'error', message: (err as Error).message });
    }
  }

  function onContinue(run: RunState, result: SubmitStageResponse) {
    if (result.runOver || !result.nextStage) {
      setScreen({ kind: 'final', topicId: run.topicId, topicName: run.topicName, result: result.final! });
      return;
    }
    setScreen({
      kind: 'playing',
      run: { ...run, stage: result.nextStage.stage, questions: result.nextStage.questions },
    });
  }

  return (
    <main>
      <header>
        <h1>QuizTrivia</h1>
        <nav className="topnav">
          <button className="ghost" onClick={() => setScreen({ kind: 'topics' })}>
            주제
          </button>
          <button className="ghost" onClick={() => setScreen({ kind: 'ranking', board: 'global_all_time' })}>
            랭킹
          </button>
          <button className="ghost" onClick={() => setScreen({ kind: 'workshop' })}>
            창작마당
          </button>
        </nav>
        <AuthStatus session={session} onSaveNickname={onSaveNickname} />
      </header>

      {notice && (
        <p className="notice">
          {notice}
          <button className="dismiss" onClick={() => setNotice(null)} aria-label="닫기">
            ×
          </button>
        </p>
      )}

      {screen.kind === 'loading' && <p>불러오는 중…</p>}

      {screen.kind === 'error' && (
        <section>
          <p className="error">{screen.message}</p>
          <button onClick={() => location.reload()}>다시 시도</button>
        </section>
      )}

      {screen.kind === 'topics' && <TopicList topics={topics} onPick={onPick} />}

      {screen.kind === 'playing' && (
        <Quiz run={screen.run} onSubmit={(given) => onSubmit(screen.run, given)} />
      )}

      {screen.kind === 'stageResult' && (
        <StageResult
          run={screen.run}
          result={screen.result}
          onContinue={() => onContinue(screen.run, screen.result)}
        />
      )}

      {screen.kind === 'final' && (
        <Final
          topicId={screen.topicId}
          topicName={screen.topicName}
          result={screen.result}
          session={session}
          onAgain={() => setScreen({ kind: 'topics' })}
        />
      )}

      {screen.kind === 'ranking' && (
        <Ranking board={screen.board} onSwitchBoard={(board) => setScreen({ kind: 'ranking', board })} />
      )}

      {screen.kind === 'workshop' && <Workshop session={session} onPlay={startPlaying} />}
    </main>
  );
}

function AuthStatus({
  session,
  onSaveNickname,
}: {
  session: SessionResponse | null;
  onSaveNickname: (name: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  if (!session) return null;

  if (session.isAnonymous) {
    return (
      <button className="ghost" onClick={() => goToGoogleLogin()}>
        구글로 랭킹 등록
      </button>
    );
  }

  if (!session.nickname || editing) {
    return (
      <form
        className="nickname-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          setSaving(true);
          await onSaveNickname(draft.trim());
          setSaving(false);
          setEditing(false);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="닉네임"
          maxLength={20}
          autoFocus={editing}
        />
        <button type="submit" disabled={saving || !draft.trim()}>
          저장
        </button>
      </form>
    );
  }

  return (
    <button className="ghost" onClick={() => { setDraft(session.nickname ?? ''); setEditing(true); }}>
      {session.nickname}님
    </button>
  );
}

function TopicList({ topics, onPick }: { topics: Topic[]; onPick: (topic: Topic) => void }) {
  if (topics.length === 0) {
    return <p>플레이할 수 있는 주제가 아직 없습니다. (문항 하한 미달)</p>;
  }
  return (
    <section>
      <h2>주제 선택</h2>
      <ul className="topics">
        {topics.map((t) => (
          <li key={t.id}>
            <button onClick={() => onPick(t)}>
              <strong>{t.name}</strong>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function stageBand(stage: number): string {
  if (stage <= 3) return '1–3';
  if (stage <= 6) return '4–6';
  if (stage <= 9) return '7–9';
  return '10–12';
}

function Quiz({
  run,
  onSubmit,
}: {
  run: RunState;
  onSubmit: (given: Record<string, string>) => void;
}) {
  const [given, setGiven] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const q = run.questions[index];
  const isLast = index === run.questions.length - 1;
  const answered = (given[q.id] ?? '') !== '';

  function record(value: string) {
    setGiven((prev) => ({ ...prev, [q.id]: value }));
  }

  return (
    <section>
      <p className="stage-banner">
        {run.topicName} · 스테이지 {run.stage}/{run.totalStages}
        <span className="band">난이도 {q.difficulty} 구간 ({stageBand(run.stage)})</span>
      </p>
      <p className="progress">
        문항 {index + 1} / {run.questions.length}
      </p>
      <h2 className="body">{q.body}</h2>

      {q.imageUrl && (
        <img className="question-image" src={q.imageUrl} alt="" />
      )}

      {q.type === 'MULTIPLE_CHOICE' && q.choices && (
        <ul className="choices">
          {q.choices.map((c) => (
            <li key={c}>
              <button
                className={given[q.id] === c ? 'selected' : undefined}
                onClick={() => record(c)}
              >
                {c}
              </button>
            </li>
          ))}
        </ul>
      )}

      {q.type === 'NUMERIC_INPUT' && (
        <input
          type="number"
          inputMode="decimal"
          value={given[q.id] ?? ''}
          onChange={(e) => record(e.target.value)}
          placeholder="숫자를 입력하세요"
        />
      )}

      {q.type === 'TEXT_INPUT' && (
        <input
          type="text"
          value={given[q.id] ?? ''}
          onChange={(e) => record(e.target.value)}
          placeholder="정답을 입력하세요"
        />
      )}

      <button
        className="primary"
        disabled={!answered}
        onClick={() => (isLast ? onSubmit(given) : setIndex(index + 1))}
      >
        {isLast ? '제출' : '다음'}
      </button>
    </section>
  );
}

function StageResult({
  run,
  result,
  onContinue,
}: {
  run: RunState;
  result: SubmitStageResponse;
  onContinue: () => void;
}) {
  return (
    <section>
      <p className="stage-banner">
        {run.topicName} · 스테이지 {result.stage}/{result.totalStages}
      </p>
      <h2>
        {result.correctCount} / {result.total} 정답 · +{result.stageScore}점
      </h2>
      <p className={result.cleared ? 'ok' : 'ng'}>
        {result.cleared ? '스테이지 클리어' : '클리어 실패 (4문항 이상 필요)'}
      </p>

      <ol className="review">
        {result.results.map((r) => (
          <li key={r.questionId} className={r.correct ? 'ok' : 'ng'}>
            {r.imageUrl && <img className="question-image review-image" src={r.imageUrl} alt="" />}
            <p className="body">{r.body}</p>
            <p>
              내 답 <strong>{r.given || '무응답'}</strong>
              {!r.correct && (
                <>
                  {' · 정답 '}
                  <strong>{r.answer}</strong>
                </>
              )}
            </p>
            <p className="explanation">{r.explanation}</p>
          </li>
        ))}
      </ol>

      <button className="primary" onClick={onContinue}>
        {result.runOver ? '최종 결과 보기' : '다음 스테이지'}
      </button>
    </section>
  );
}

function Final({
  topicId,
  topicName,
  result,
  session,
  onAgain,
}: {
  topicId: string;
  topicName: string;
  result: RunFinalSummary;
  session: SessionResponse | null;
  onAgain: () => void;
}) {
  const complete = result.stagesCleared >= 12;
  const [topicRank, setTopicRank] = useState<TopicRankingResponse['me']>(null);

  useEffect(() => {
    if (!result.ranked) return;
    let cancelled = false;
    getTopicRanking(topicId)
      .then((res) => {
        if (!cancelled) setTopicRank(res.me);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [topicId, result.ranked]);

  return (
    <section>
      <h2>{topicName} 결과</h2>
      <p className="final-score">{result.totalScore}점</p>
      <p className={complete ? 'ok' : 'ng'}>
        {complete ? '12스테이지 전부 클리어!' : `스테이지 ${result.stagesCleared}까지 클리어`}
        {result.ranked && result.isNewBest && ' · 최고 기록 갱신'}
      </p>
      {result.ranked ? (
        <p className="meta">
          이 주제 최고 {result.topicBestScore}점 · 통합 {result.globalScore}점
          {topicRank && ` · 이 주제 순위 ${topicRank.rank}위`}
        </p>
      ) : (
        <p className="meta">창작마당 주제는 랭킹에 반영되지 않습니다.</p>
      )}
      {session?.isAnonymous && (
        <p className="hint">
          지금은 익명 기록입니다.{' '}
          <button className="link" onClick={() => goToGoogleLogin()}>
            구글로 로그인
          </button>
          하면 이 기록 그대로 랭킹에 올릴 수 있어요.
        </p>
      )}
      <button className="primary" onClick={onAgain}>
        다시 하기
      </button>
    </section>
  );
}

function Ranking({
  board,
  onSwitchBoard,
}: {
  board: GlobalBoardId;
  onSwitchBoard: (board: GlobalBoardId) => void;
}) {
  const [data, setData] = useState<RankingBoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    getGlobalRanking(board)
      .then(setData)
      .catch((err) => setError((err as Error).message));
  }, [board]);

  return (
    <section>
      <h2>랭킹</h2>
      <div className="board-tabs">
        <button
          className={board === 'global_all_time' ? 'ghost active' : 'ghost'}
          onClick={() => onSwitchBoard('global_all_time')}
        >
          전체 기간
        </button>
        <button
          className={board === 'global_weekly' ? 'ghost active' : 'ghost'}
          onClick={() => onSwitchBoard('global_weekly')}
        >
          이번 주
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {!error && !data && <p>불러오는 중…</p>}

      {data && data.top.length === 0 && <p>아직 랭킹에 등록된 기록이 없습니다.</p>}

      {data && data.top.length > 0 && (
        <ol className="ranking">
          {data.top.map((e) => (
            <li key={e.rank} className={e.isMe ? 'me' : undefined}>
              <span className="rank">{e.rank}</span>
              <span className="nickname">{e.nickname ?? '(닉네임 없음)'}</span>
              <span className="score">{e.score}점</span>
            </li>
          ))}
        </ol>
      )}

      {data?.me && !data.me.inTop && (
        <p className="meta">
          내 점수 {data.me.score}점
          {data.cutoffScore != null && ` · 30위 커트라인 ${data.cutoffScore}점`}
        </p>
      )}
      {data && !data.me && (
        <p className="hint">구글로 로그인하면 여기 랭킹에 이름이 오릅니다.</p>
      )}
    </section>
  );
}

export default App;
