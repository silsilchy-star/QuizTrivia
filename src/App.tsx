import { useEffect, useState } from 'react';
import { ensureSession, getTopics, startRun, submitStage } from './api';
import type { RunFinalSummary, ServedQuestion, SubmitStageResponse, Topic } from './types';
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
  | { kind: 'final'; topicName: string; result: RunFinalSummary };

function App() {
  const [uid, setUid] = useState<string | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });

  useEffect(() => {
    (async () => {
      try {
        const session = await ensureSession();
        setUid(session.uid);
        setTopics(await getTopics());
        setScreen({ kind: 'topics' });
      } catch (err) {
        setScreen({ kind: 'error', message: (err as Error).message });
      }
    })();
  }, []);

  async function onPick(topic: Topic) {
    setScreen({ kind: 'loading' });
    try {
      const started = await startRun(topic.id);
      setScreen({
        kind: 'playing',
        run: {
          runId: started.runId,
          topicId: started.topicId,
          topicName: topic.name,
          stage: started.stage,
          totalStages: started.totalStages,
          questions: started.questions,
        },
      });
    } catch (err) {
      setScreen({ kind: 'error', message: (err as Error).message });
    }
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
      setScreen({ kind: 'final', topicName: run.topicName, result: result.final! });
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
        {uid && <p className="uid">uid {uid.slice(0, 8)}…</p>}
      </header>

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
          topicName={screen.topicName}
          result={screen.result}
          onAgain={() => setScreen({ kind: 'topics' })}
        />
      )}
    </main>
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
              <span>{t.tagline}</span>
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
  topicName,
  result,
  onAgain,
}: {
  topicName: string;
  result: RunFinalSummary;
  onAgain: () => void;
}) {
  const complete = result.stagesCleared >= 12;
  return (
    <section>
      <h2>{topicName} 결과</h2>
      <p className="final-score">{result.totalScore}점</p>
      <p className={complete ? 'ok' : 'ng'}>
        {complete ? '12스테이지 전부 클리어!' : `스테이지 ${result.stagesCleared}까지 클리어`}
        {result.isNewBest && ' · 최고 기록 갱신'}
      </p>
      <p className="meta">
        이 주제 최고 {result.topicBestScore}점 · 통합 {result.globalScore}점
      </p>
      <button className="primary" onClick={onAgain}>
        다시 하기
      </button>
    </section>
  );
}

export default App;
