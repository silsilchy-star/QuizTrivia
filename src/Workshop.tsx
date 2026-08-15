// 유저 창작마당 — 플레이어가 직접 주제를 만들고 문제를 채워 넣는 화면.
// 검수 없이 자동 검증만 통과하면 바로 공개되고, 랭킹에는 반영되지 않는다
// (worker/community.ts와 짝을 이룬다).
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  addCommunityQuestion,
  createCommunityTopic,
  deleteCommunityQuestion,
  deleteCommunityTopic,
  getCommunityQuestions,
  getCommunityTopics,
  uploadQuestionImage,
} from './api';
import { parseVideoUrl } from './media';
import type {
  CommunityQuestion,
  CommunityTopic,
  Difficulty,
  NewCommunityQuestionInput,
  QuestionType,
  SessionResponse,
} from './types';
import { VideoFrame } from './VideoFrame';

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
        onDeleted={() => {
          setTopics((prev) => prev.filter((t) => t.id !== topic.id));
          setScreen({ kind: 'list' });
        }}
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
  onDeleted,
}: {
  topic: CommunityTopic;
  onBack: () => void;
  onPlay: () => void;
  onQuestionAdded: (topic: CommunityTopic) => void;
  onDeleted: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function confirmDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteCommunityTopic(topic.id);
      onDeleted();
    } catch (err) {
      setDeleteError((err as Error).message);
      setDeleting(false);
    }
  }

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

      {topic.isMine && <MyQuestions topic={topic} onChanged={onQuestionAdded} />}

      {topic.isMine && (
        <div className="danger-zone">
          {confirmingDelete ? (
            <>
              <p className="error">
                정말 삭제할까요? 문항 {Object.values(topic.questionCount).reduce((a, b) => a + b, 0)}개도 함께
                삭제되고 되돌릴 수 없습니다.
              </p>
              {deleteError && <p className="error">{deleteError}</p>}
              <div className="question-form-actions">
                <button className="danger" onClick={confirmDelete} disabled={deleting}>
                  삭제
                </button>
                <button className="link" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                  취소
                </button>
              </div>
            </>
          ) : (
            <button className="link danger-text" onClick={() => setConfirmingDelete(true)}>
              이 주제 삭제
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** 내가 만든 문항 목록 + 개별 삭제.
 *
 *  이게 없던 동안은 오타 하나, 죽은 영상 링크 하나 때문에 주제를 통째로
 *  지우는 것 말고는 방법이 없었다. 붙인 이미지·영상을 함께 보여주는 게
 *  중요하다 — 잘못 붙인 링크는 목록에서 눈으로 봐야 찾을 수 있다.
 *
 *  "고치기"는 따로 두지 않았다. 지우고 다시 넣으면 되고, 수정은 재검증·중복
 *  재확인·게이트 재계산·통계 처리를 전부 다시 밟아야 해서 훨씬 큰 작업이다. */
function MyQuestions({ topic, onChanged }: { topic: CommunityTopic; onChanged: (t: CommunityTopic) => void }) {
  const [questions, setQuestions] = useState<CommunityQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const total = Object.values(topic.questionCount).reduce((a, b) => a + b, 0);

  // 문항 수가 바뀌면(추가·삭제) 목록을 다시 읽는다.
  useEffect(() => {
    let alive = true;
    getCommunityQuestions(topic.id)
      .then((qs) => alive && setQuestions(qs))
      .catch((err) => alive && setError((err as Error).message));
    return () => {
      alive = false;
    };
  }, [topic.id, total]);

  async function remove(questionId: string) {
    setDeletingId(questionId);
    setError(null);
    try {
      // 응답은 게이트가 다시 계산된 주제 — 하한 아래로 내려가면 draft로 돌아온다.
      onChanged(await deleteCommunityQuestion(topic.id, questionId));
      setConfirmingId(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!questions) return <p className="hint">문항을 불러오는 중…</p>;
  if (!questions.length) return null;

  return (
    <div className="my-questions">
      <h3>내 문항 {questions.length}개</h3>
      <ol className="question-list">
        {questions.map((q) => (
          <li key={q.id}>
            <p className="meta">난이도 {q.difficulty}</p>
            <p className="body">{q.body}</p>
            {q.imageUrl && <img className="question-image review-image" src={q.imageUrl} alt="" />}
            {q.video && <VideoFrame video={q.video} className="review-image" />}
            <p className="meta">정답 {q.answer}</p>

            {confirmingId === q.id ? (
              <div className="question-form-actions">
                <button className="danger" onClick={() => remove(q.id)} disabled={deletingId === q.id}>
                  삭제 확인
                </button>
                <button className="link" onClick={() => setConfirmingId(null)} disabled={deletingId === q.id}>
                  취소
                </button>
              </div>
            ) : (
              <button className="link danger-text" onClick={() => setConfirmingId(q.id)}>
                이 문항 삭제
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
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
  // 이미지든 영상이든 이 한 칸으로 받는다. 어느 쪽인지는 붙여넣은 링크를
  // 보고 판정한다 — 유저가 "이건 이미지" "이건 영상"을 직접 고르게 하는 건
  // 불필요한 질문이다. 판정은 서버와 같은 파서(src/media.ts)로 하고,
  // 최종 판단은 어차피 서버가 다시 한다.
  const [mediaUrl, setMediaUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState(0);

  // 붙여넣은 링크가 유튜브면 영상, 아니면 이미지. 미리보기와 전송 양쪽이
  // 이 하나의 판정을 쓴다.
  const previewVideo = parseVideoUrl(mediaUrl);

  async function pickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 같은 파일을 다시 골랐을 때도 onChange가 뜨도록 값을 비운다.
    e.target.value = '';
    if (!file) return;

    setUploading(true);
    setMediaError(null);
    try {
      const { url } = await uploadQuestionImage(file);
      setMediaUrl(url);
    } catch (err) {
      setMediaError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const media = mediaUrl.trim();
      const input: NewCommunityQuestionInput = {
        type,
        difficulty,
        body: body.trim(),
        choices: type === 'MULTIPLE_CHOICE' ? choices.map((c) => c.trim()) : null,
        answer: answer.trim(),
        explanation: explanation.trim(),
        // 유튜브 링크면 영상 칸으로, 아니면 이미지 칸으로 보낸다. 둘 다 채워
        // 보내는 일은 없다 — 서버도 그걸 거부한다.
        imageUrl: media && !previewVideo ? media : null,
        videoUrl: media && previewVideo ? media : null,
      };
      const topic = await addCommunityQuestion(topicId, input);
      onDone(topic);
      setBody('');
      setChoices(['', '', '', '']);
      setAnswer('');
      setExplanation('');
      setMediaUrl('');
      setMediaError(null);
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
          <option value="TEXT_INPUT">단답형 (텍스트)</option>
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

      <div className="image-field">
        <div className="image-field-row">
          <label className="file-button">
            {uploading ? '올리는 중…' : '사진 선택'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              disabled={uploading}
              onChange={pickImage}
            />
          </label>
          <span className="hint">JPG · PNG · GIF · WebP, 5MB 이하 (선택)</span>
        </div>

        {mediaUrl && (
          <div className="image-preview">
            {previewVideo ? (
              <VideoFrame video={previewVideo} />
            ) : (
              <img src={mediaUrl} alt="첨부한 이미지 미리보기" />
            )}
            <button type="button" className="link" onClick={() => setMediaUrl('')}>
              {previewVideo ? '영상 빼기' : '사진 빼기'}
            </button>
          </div>
        )}

        <input
          value={mediaUrl}
          onChange={(e) => setMediaUrl(e.target.value)}
          placeholder="또는 이미지 주소 · 유튜브 링크 붙여넣기"
        />
        <span className="hint">
          유튜브 주소를 넣으면 영상 문제가 된다 (youtube.com/watch · youtu.be · /shorts)
        </span>
        {mediaError && <p className="error">{mediaError}</p>}
      </div>

      <input
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder={
          type === 'MULTIPLE_CHOICE'
            ? '정답 (선택지 중 하나와 정확히 일치)'
            : type === 'NUMERIC_INPUT'
              ? '정답 (숫자만)'
              : '정답 (텍스트, 대소문자·공백 차이는 무시됨)'
        }
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
