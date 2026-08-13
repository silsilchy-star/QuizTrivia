// 유저 창작마당 — 플레이어가 직접 주제를 만들고 문제를 채워 넣는 화면.
// 검수 없이 자동 검증만 통과하면 바로 공개되고, 랭킹에는 반영되지 않는다
// (worker/community.ts와 짝을 이룬다).
import { useEffect, useState, type FormEvent } from 'react';
import { addCommunityQuestion, createCommunityTopic, getCommunityTopics } from './api';
import type { CommunityTopic, Difficulty, NewCommunityQuestionInput, QuestionType, SessionResponse } from './types';

/** worker/community.ts의 COMMUNITY_GATE_PER_DIFFICULTY와 같은 값 — 표시용. */
const GATE_PER_DIFFICULTY = 5;

type WorkshopScreen = { kind: 'list' } | { kind: 'new-topic' } | { kind: 'detail'; topicId: string };

export function Workshop({
  session,
  onPlay,
}: {
  session: SessionResponse | null;
  onPlay: (topicId: string, topicName: string) => void;
}) {
  const [screen, setScreen] = useState<WorkshopScreen>({ kind: 'list' });
  const [topics, setTopics] = useState<CommunityTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    try {
      setTopics(await getCommunityTopics());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  const canCreate = !!session && !session.isAnonymous && !!session.nickname;

  if (screen.kind === 'new-topic') {
    return (
      <NewTopicForm
        onCancel={() => setScreen({ kind: 'list' })}
        onCreated={(topic) => {
          setTopics((prev) => [topic, ...prev]);
          setScreen({ kind: 'detail', topicId: topic.id });
        }}
      />
    );
  }

  if (screen.kind === 'detail') {
    const topic = topics.find((t) => t.id === screen.topicId);
    if (!topic) return <p>주제를 찾을 수 없습니다.</p>;
    return (
      <TopicDetail
        topic={topic}
        onBack={() => setScreen({ kind: 'list' })}
        onPlay={() => onPlay(topic.id, topic.name)}
        onQuestionAdded={(updated) =>
          setTopics((prev) => prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)))
        }
      />
    );
  }

  return (
    <section>
      <h2>창작마당</h2>
      <p className="meta">
        누구나 주제를 만들고 문제를 채울 수 있어요. 난이도별 {GATE_PER_DIFFICULTY}문항 이상 채우면
        플레이할 수 있습니다. 검수 없이 바로 공개되지만, 랭킹에는 반영되지 않아요.
      </p>

      {canCreate ? (
        <button className="primary" onClick={() => setScreen({ kind: 'new-topic' })}>
          + 새 주제 만들기
        </button>
      ) : (
        <p className="hint">주제를 만들려면 구글 로그인과 닉네임 설정이 필요합니다.</p>
      )}

      {loading && <p>불러오는 중…</p>}
      {error && <p className="error">{error}</p>}
      {!loading && !error && topics.length === 0 && <p>아직 만들어진 주제가 없습니다.</p>}

      <ul className="workshop-list">
        {topics.map((t) => (
          <li key={t.id}>
            <button onClick={() => setScreen({ kind: 'detail', topicId: t.id })}>
              <strong>{t.name}</strong>
              <span className={t.status === 'active' ? 'ok' : 'muted'}>
                {t.status === 'active' ? '플레이 가능' : '준비 중'}
              </span>
              <span className="workshop-meta">
                {t.authorNickname ?? '익명'}님 작성
                {t.isMine && ' · 내 주제'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NewTopicForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (topic: CommunityTopic) => void;
}) {
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      onCreated(await createCommunityTopic(name.trim(), tagline.trim()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2>새 주제 만들기</h2>
      <form onSubmit={submit}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="주제 이름"
          maxLength={30}
          autoFocus
        />
        <input
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          placeholder="한 줄 설명 (선택)"
          maxLength={60}
        />
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit" disabled={saving || !name.trim()}>
          만들기
        </button>
      </form>
      <button className="link" onClick={onCancel}>
        취소
      </button>
    </section>
  );
}

function TopicDetail({
  topic,
  onBack,
  onPlay,
  onQuestionAdded,
}: {
  topic: CommunityTopic;
  onBack: () => void;
  onPlay: () => void;
  onQuestionAdded: (topic: CommunityTopic) => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <section>
      <button className="link" onClick={onBack}>
        ← 목록으로
      </button>
      <h2>{topic.name}</h2>
      {topic.tagline && <p className="meta">{topic.tagline}</p>}
      <p className="meta">{topic.authorNickname ?? '익명'}님 작성</p>

      <ul className="gate-bars">
        {(['1', '2', '3', '4'] as const).map((d) => (
          <li key={d}>
            <span>난이도 {d}</span>
            <div className="gate-bar">
              <div
                className="gate-bar-fill"
                style={{ width: `${Math.min(100, (topic.questionCount[d] / GATE_PER_DIFFICULTY) * 100)}%` }}
              />
            </div>
            <span>
              {topic.questionCount[d]} / {GATE_PER_DIFFICULTY}
            </span>
          </li>
        ))}
      </ul>

      {topic.status === 'active' ? (
        <button className="primary" onClick={onPlay}>
          플레이하기
        </button>
      ) : (
        <p className="hint">난이도별 {GATE_PER_DIFFICULTY}문항 이상 채우면 플레이할 수 있어요.</p>
      )}

      {topic.isMine &&
        (adding ? (
          <NewQuestionForm topicId={topic.id} onDone={onQuestionAdded} onClose={() => setAdding(false)} />
        ) : (
          <button className="ghost" onClick={() => setAdding(true)}>
            + 문제 추가
          </button>
        ))}
    </section>
  );
}

function NewQuestionForm({
  topicId,
  onDone,
  onClose,
}: {
  topicId: string;
  onDone: (topic: CommunityTopic) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<QuestionType>('MULTIPLE_CHOICE');
  const [difficulty, setDifficulty] = useState<Difficulty>(1);
  const [body, setBody] = useState('');
  const [choices, setChoices] = useState(['', '', '', '']);
  const [answer, setAnswer] = useState('');
  const [explanation, setExplanation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState(0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input: NewCommunityQuestionInput = {
        type,
        difficulty,
        body: body.trim(),
        choices: type === 'MULTIPLE_CHOICE' ? choices.map((c) => c.trim()) : null,
        answer: answer.trim(),
        explanation: explanation.trim(),
      };
      const topic = await addCommunityQuestion(topicId, input);
      onDone(topic);
      setBody('');
      setChoices(['', '', '', '']);
      setAnswer('');
      setExplanation('');
      setAddedCount((n) => n + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="question-form" onSubmit={submit}>
      <h3>문제 추가</h3>

      <label>
        유형
        <select value={type} onChange={(e) => setType(e.target.value as QuestionType)}>
          <option value="MULTIPLE_CHOICE">객관식</option>
          <option value="NUMERIC_INPUT">숫자 입력</option>
        </select>
      </label>

      <label>
        난이도
        <select value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value) as Difficulty)}>
          <option value={1}>난이도 1. 매우 쉬움</option>
          <option value={2}>난이도 2. 쉬움</option>
          <option value={3}>난이도 3. 보통</option>
          <option value={4}>난이도 4. 어려움</option>
        </select>
      </label>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="문항 (80자 이내)"
        maxLength={80}
      />

      {type === 'MULTIPLE_CHOICE' && (
        <div className="choice-inputs">
          {choices.map((c, i) => (
            <input
              key={i}
              value={c}
              onChange={(e) => setChoices((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
              placeholder={`선택지 ${i + 1}`}
            />
          ))}
        </div>
      )}

      <input
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder={type === 'MULTIPLE_CHOICE' ? '정답 (선택지 중 하나와 정확히 일치)' : '정답 (숫자만)'}
      />
      <textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="해설" />

      {error && <p className="error">{error}</p>}
      {addedCount > 0 && !error && <p className="ok">{addedCount}개 추가됨 — 계속 추가하거나 닫으세요.</p>}

      <div className="question-form-actions">
        <button className="primary" type="submit" disabled={saving}>
          추가
        </button>
        <button type="button" className="link" onClick={onClose}>
          닫기
        </button>
      </div>
    </form>
  );
}
