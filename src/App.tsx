import { useEffect, useState } from 'react';
import { ensureSession, getTopics, startRun, submitRun } from './api';
import type { StartRunResponse, SubmitRunResponse, Topic } from './types';
import './App.css';

type Screen =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'topics' }
  | { kind: 'playing'; run: StartRunResponse }
  | { kind: 'result'; result: SubmitRunResponse };

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

  async function onPick(topicId: string) {
    setScreen({ kind: 'loading' });
    try {
      setScreen({ kind: 'playing', run: await startRun(topicId) });
    } catch (err) {
      setScreen({ kind: 'error', message: (err as Error).message });
    }
  }

  async function onSubmit(run: StartRunResponse, given: Record<string, string>) {
    setScreen({ kind: 'loading' });
    try {
      const answers = run.questions.map((q) => ({ questionId: q.id, given: given[q.id] ?? '' }));
      setScreen({ kind: 'result', result: await submitRun(run.runId, answers) });
    } catch (err) {
      setScreen({ kind: 'error', message: (err as Error).message });
    }
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

      {screen.kind === 'result' && (
        <Result result={screen.result} onAgain={() => setScreen({ kind: 'topics' })} />
      )}
    </main>
  );
}

function TopicList({ topics, onPick }: { topics: Topic[]; onPick: (id: string) => void }) {
  if (topics.length === 0) {
    return <p>플레이할 수 있는 주제가 아직 없습니다. (문항 하한 미달)</p>;
  }
  return (
    <section>
      <h2>주제 선택</h2>
      <ul className="topics">
        {topics.map((t) => (
          <li key={t.id}>
            <button onClick={() => onPick(t.id)}>
              <strong>{t.name}</strong>
              <span>{t.tagline}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Quiz({
  run,
  onSubmit,
}: {
  run: StartRunResponse;
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
      <p className="progress">
        {index + 1} / {run.questions.length} · 난이도 {q.difficulty}
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

function Result({ result, onAgain }: { result: SubmitRunResponse; onAgain: () => void }) {
  return (
    <section>
      <h2>
        {result.correctCount} / {result.total} 정답 · {result.score}점
      </h2>
      <p className={result.cleared ? 'ok' : 'ng'}>
        {result.cleared ? '스테이지 클리어' : '클리어 실패 (4문항 이상 필요)'}
        {result.isNewBest && ' · 최고 기록 갱신'}
      </p>
      <p className="meta">
        이 주제 최고 {result.topicBestScore}점 · 통합 {result.globalScore}점
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

      <button className="primary" onClick={onAgain}>
        다시 하기
      </button>
    </section>
  );
}

export default App;
