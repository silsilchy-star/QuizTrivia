#!/usr/bin/env node
// 자동 검증 — PLAN 6.6절 [3] "기계가 잡을 수 있는 것"
//
// ERROR : 형식이 깨져 파이프라인을 진행할 수 없다. 반드시 고쳐야 한다.
// WARN  : 기계가 확신할 수 없다. 사람 검수(6.6절 [4])로 넘긴다.
//
// 사용: node scripts/validate.mjs [--json]

import {
  ANSWER_ALIASES_MAX,
  GATE_PER_DIFFICULTY,
  NUMERIC_RATIO,
  OVERLAP_WARN,
  loadAllQuestions,
  loadTopics,
  normalize,
  normalizeAnswer,
} from './lib.mjs';
import { choiceAnswerLeaked, numericAnswerLeaked, textAnswerLeaked } from './fairness.mjs';

const TYPES = ['MULTIPLE_CHOICE', 'NUMERIC_INPUT', 'TEXT_INPUT'];
const STATUSES = ['pending', 'approved', 'rejected'];
/** PLAN 6.4절 ③ — 최상급 표현은 측정 기준에 따라 답이 갈린다. */
const SUPERLATIVE = ['가장', '최고', '제일', '최대', '최소'];
/** PLAN 4.4절 — 정답은 완전한 문장이 아니라 단어 형태로. */
const SENTENCE_TAIL = ['입니다', '이다', '예요', '이에요', '합니다'];

const errors = [];
const warns = [];
const err = (id, msg) => errors.push({ id, msg });
const warn = (id, msg) => warns.push({ id, msg });

const topics = loadTopics();
const topicById = new Map(topics.map((t) => [t.id, t]));
const broadTopics = topics.filter((t) => t.kind === 'broad');
const questions = loadAllQuestions();

// ── 문항 단위 검사 ────────────────────────────────────────────────
const seenId = new Map();
const seenBody = new Map();

for (const q of questions) {
  const id = q.id ?? '(id 없음)';

  if (!q.id) err(id, 'id가 없다');
  else if (seenId.has(q.id)) err(id, `id 중복 — ${seenId.get(q.id)} 와 겹침`);
  else seenId.set(q.id, q._file);

  if (!TYPES.includes(q.type)) err(id, `type이 잘못됨: ${q.type}`);
  if (![1, 2, 3, 4].includes(q.difficulty)) err(id, `difficulty가 잘못됨: ${q.difficulty}`);
  if (!STATUSES.includes(q.status)) err(id, `status가 잘못됨: ${q.status}`);
  if (!q.body?.trim()) err(id, 'body가 비었다');
  if (!q.explanation?.trim()) err(id, 'explanation이 비었다 (학습 목적상 필수)');
  if (typeof q.answer !== 'string' || !q.answer.trim()) err(id, 'answer가 비었다');

  // 중복 문항 (PLAN 6.6절 [3]) — 이미지 문제는 문구가 똑같아도 사진이 다르면
  // 다른 문항이다(사진이 실제 출제 내용). imageUrl까지 같아야 진짜 중복으로 본다.
  if (q.body) {
    const key = `${normalize(q.body)}|${q.imageUrl ?? ''}`;
    if (seenBody.has(key)) err(id, `문항 중복 — ${seenBody.get(key)} 와 사실상 같음`);
    else seenBody.set(key, q.id);
  }

  // 유형별 검사
  if (q.type === 'MULTIPLE_CHOICE') {
    if (!Array.isArray(q.choices) || q.choices.length !== 4) {
      err(id, `선택지가 4개가 아니다 (${q.choices?.length ?? 0}개)`);
    } else {
      if (new Set(q.choices).size !== 4) err(id, '선택지에 중복이 있다');
      if (!q.choices.includes(q.answer)) err(id, `정답 "${q.answer}"이 선택지 안에 없다`);
      if (q.choices.some((c) => !String(c).trim())) err(id, '빈 선택지가 있다');
    }
  } else if (q.type === 'NUMERIC_INPUT') {
    if (q.choices != null) err(id, 'NUMERIC_INPUT은 choices가 null이어야 한다');
    // 기계가 정답을 직접 대조할 수 있어야 검수가 15초로 줄어든다 (PLAN 4.4절)
    if (Number.isNaN(Number(q.answer))) err(id, `정답 "${q.answer}"이 숫자로 파싱되지 않는다`);
  } else if (q.type === 'TEXT_INPUT') {
    if (q.choices != null) err(id, 'TEXT_INPUT은 choices가 null이어야 한다');
  }

  // ── 단답형 별칭 (answerAliases) ──
  //
  // 표기가 흔들리는 답을 인정하기 위한 목록이다. 정답이 "에베레스트"일 때
  // "에베레스트산"을 적은 사람은 알고 있는 것이므로 맞다고 쳐야 한다.
  //
  // 다른 유형에서 막는 이유: 객관식은 선택지를 고르는 것이고 숫자입력은 숫자로
  // 비교하므로 별칭이 채점에 아무 영향을 주지 않는다. 조용히 무시되느니
  // 여기서 걸리는 편이 낫다 (영상 문항을 ERROR로 막는 것과 같은 이유).
  if (q.answerAliases != null) {
    if (q.type !== 'TEXT_INPUT') {
      err(id, `answerAliases는 TEXT_INPUT에서만 쓴다 (지금 ${q.type}) — 다른 유형에서는 채점에 반영되지 않는다`);
    } else if (!Array.isArray(q.answerAliases)) {
      err(id, 'answerAliases는 배열이어야 한다');
    } else {
      if (q.answerAliases.length > ANSWER_ALIASES_MAX) {
        err(id, `answerAliases가 너무 많다 (${q.answerAliases.length}개, 최대 ${ANSWER_ALIASES_MAX}개)`);
      }
      const seen = new Set([normalizeAnswer(q.answer)]);
      for (const alias of q.answerAliases) {
        if (typeof alias !== 'string' || !alias.trim()) {
          err(id, '비어 있는 별칭이 있다');
          continue;
        }
        const key = normalizeAnswer(alias);
        // 정규화하면 정답과 같아지는 별칭은 채점에서 아무 일도 하지 않는다.
        // 있으나 마나 한 항목이 쌓이면 "이 문항은 별칭을 챙겼다"는 착시가 생긴다.
        if (seen.has(key)) {
          err(id, `별칭 "${alias}"이 정답 또는 다른 별칭과 (대소문자·공백 무시하면) 같다`);
        }
        seen.add(key);
      }
    }
  }

  // 이미지 첨부 (EP-1 확장 — 이미지+단답형)
  if (q.imageUrl != null && !/^https:\/\/.+/.test(q.imageUrl)) {
    err(id, `imageUrl은 https://로 시작해야 한다: ${q.imageUrl}`);
  }

  // 영상 문항은 창작마당(유저 콘텐츠) 전용이다.
  //
  // 링크에서 영상 id를 뽑는 파서는 src/media.ts 하나뿐이고, 프론트와 워커가
  // 그걸 같이 쓴다. 이 스크립트는 평범한 .mjs라 TypeScript를 import할 수
  // 없어서, 공식 파이프라인까지 지원하려면 같은 파서를 JS로 한 벌 더 써야
  // 한다 — "파서는 하나"라는 전제가 깨지는 순간 느슨한 쪽이 뚫린다.
  // 그래서 지원하지 않고, 조용히 무시되는 대신 여기서 걸리게 한다
  // (build-seed.mjs는 video 컬럼을 아예 쓰지 않는다).
  if (q.videoUrl != null) {
    err(id, '영상 문항은 공식 콘텐츠에서 지원하지 않는다 — 창작마당에서만 만들 수 있다');
  }

  // ── 정답 노출 (scripts/fairness.mjs) ──
  // 형식이 멀쩡해도 문제에 답이 적혀 있으면 그 문항은 아무것도 묻지 않는다.
  if (numericAnswerLeaked(q)) {
    err(id, `정답 ${q.answer}이 문제 본문에 그대로 있다 — 몰라도 맞힐 수 있다`);
  }
  if (choiceAnswerLeaked(q)) {
    warn(id, `정답 "${q.answer}"만 문제 본문에 나온다 — 내용을 몰라도 고를 수 있는지 확인`);
  }
  // 단답형은 선택지가 없어 본문이 플레이어가 보는 전부다. 거기 답이 있으면
  // 베껴 쓰면 되므로 객관식(WARN)보다 무겁게 ERROR로 막는다.
  if (textAnswerLeaked(q)) {
    err(id, `정답 "${q.answer}"이 문제 본문에 그대로 있다 — 단답형은 본문이 전부라 베껴 쓸 수 있다`);
  }

  // 태그 (PLAN 6.6절 [2] — 허용 목록 밖 태그는 주제를 파편화시킨다)
  if (!Array.isArray(q.topicIds) || q.topicIds.length === 0) {
    err(id, 'topicIds가 비었다');
  } else {
    const unknown = q.topicIds.filter((t) => !topicById.has(t));
    if (unknown.length) err(id, `등록되지 않은 태그: ${unknown.join(', ')}`);

    const broads = q.topicIds.filter((t) => topicById.get(t)?.kind === 'broad');
    if (broads.length !== 1) {
      err(id, `넓은 태그가 정확히 1개여야 한다 (지금 ${broads.length}개: ${broads.join(', ') || '없음'})`);
    } else {
      const allowed = topicById.get(broads[0]).allowedTags ?? [];
      const outside = q.topicIds.filter((t) => !allowed.includes(t));
      if (outside.length) err(id, `${broads[0]}의 허용 태그 목록 밖: ${outside.join(', ')}`);
    }
  }

  // ── 사람 검수로 넘길 것 ──
  if (q.body && SUPERLATIVE.some((w) => q.body.includes(w))) {
    warn(id, '최상급 표현 포함 — 측정 기준이 문항 안에 명시됐는지 확인 (6.4절 ③)');
  }
  if (typeof q.answer === 'string' && SENTENCE_TAIL.some((t) => q.answer.trim().endsWith(t))) {
    warn(id, `정답이 문장형이다: "${q.answer}" — 단어 형태로 (4.4절)`);
  }
  if (q.difficulty === 3 && !q.seedRef) {
    warn(id, '난이도 3인데 씨앗 출처(seedRef)가 없다 — 진짜 "많은 사람이 틀리게 아는 것"인지 확인 (6.5절)');
  }
  if (q.body && q.body.length > 80) {
    warn(id, `문항이 길다 (${q.body.length}자) — 모바일에서 읽기 부담`);
  }
}

// ── 주제 단위 검사 ────────────────────────────────────────────────
const approved = questions.filter((q) => q.status === 'approved');
const byTopic = new Map();
for (const q of approved) {
  for (const t of q.topicIds ?? []) {
    if (!byTopic.has(t)) byTopic.set(t, []);
    byTopic.get(t).push(q);
  }
}

const gate = [];
for (const t of topics) {
  const list = byTopic.get(t.id) ?? [];
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const q of list) counts[q.difficulty] = (counts[q.difficulty] ?? 0) + 1;
  const passes = [1, 2, 3, 4].every((d) => counts[d] >= GATE_PER_DIFFICULTY);
  gate.push({ id: t.id, name: t.name, kind: t.kind, total: list.length, counts, passes });

  // NUMERIC_INPUT 비율은 넓은 태그에서만 본다 (좁은 태그는 목표를 두지 않음 — 6.1절)
  if (t.kind === 'broad' && list.length >= 20) {
    const ratio = list.filter((q) => q.type === 'NUMERIC_INPUT').length / list.length;
    if (ratio < NUMERIC_RATIO.min) {
      warn(t.id, `NUMERIC_INPUT 비율 ${(ratio * 100).toFixed(0)}% — 목표 20~25% 미달 (4.4절)`);
    } else if (ratio > NUMERIC_RATIO.max) {
      warn(t.id, `NUMERIC_INPUT 비율 ${(ratio * 100).toFixed(0)}% — 목표 20~25% 초과`);
    }
  }
}

// 주제 쌍 겹침 (PLAN 6.4절 ⑤) — 겹침 자체는 정상이고, 사실상 같은 주제인 경우만 잡는다.
//
// 같은 층위(kind)끼리만 비교한다. 좁은 태그는 정의상 넓은 태그에 전부 포함되므로
// 층위를 섞어 비교하면 "화학은 과학과 100% 겹친다"가 항상 뜬다 — 그건 구조가 의도한 것이지
// 합쳐야 할 신호가 아니다. 잡으려는 건 `음식`과 `요리`처럼 같은 층위의 이름만 다른 두 주제다.
//
// 비율은 합집합 기준(자카드)으로 센다. 작은 쪽 기준으로 세면 포함 관계가 곧 100%가 되어
// 크기가 크게 다른 두 주제가 항상 걸린다.
const ids = [...byTopic.keys()];
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    if (topicById.get(ids[i])?.kind !== topicById.get(ids[j])?.kind) continue;
    const a = new Set(byTopic.get(ids[i]).map((q) => q.id));
    const b = new Set(byTopic.get(ids[j]).map((q) => q.id));
    if (a.size < 10 || b.size < 10) continue;
    const shared = [...a].filter((x) => b.has(x)).length;
    const overlap = shared / (a.size + b.size - shared);
    if (overlap > OVERLAP_WARN) {
      warn(
        `${ids[i]}×${ids[j]}`,
        `문항 겹침 ${(overlap * 100).toFixed(0)}% — 사실상 같은 주제다. 합칠 것 (6.4절 ⑤)`,
      );
    }
  }
}

// ── 출력 ─────────────────────────────────────────────────────────
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ errors, warns, gate }, null, 2));
} else {
  const byStatus = (s) => questions.filter((q) => q.status === s).length;
  console.log(
    `문항 ${questions.length}개 — 승인 ${byStatus('approved')} / 대기 ${byStatus('pending')} / 반려 ${byStatus('rejected')}\n`,
  );

  console.log('주제별 승인 문항 (하한: 난이도당 ' + GATE_PER_DIFFICULTY + ')');
  for (const g of gate.filter((g) => g.total > 0)) {
    const bar = [1, 2, 3, 4].map((d) => `${d}:${String(g.counts[d]).padStart(2)}`).join(' ');
    console.log(`  ${g.passes ? '✅ active' : '⬜ draft '} ${g.name.padEnd(5)} ${bar}  계 ${g.total}`);
  }

  if (warns.length) {
    console.log(`\n⚠ 사람 검수 필요 ${warns.length}건`);
    for (const w of warns) console.log(`  ${w.id}: ${w.msg}`);
  }
  if (errors.length) {
    console.log(`\n❌ 오류 ${errors.length}건`);
    for (const e of errors) console.log(`  ${e.id}: ${e.msg}`);
  }
  if (!errors.length) console.log('\n형식 검증 통과.');
}

process.exit(errors.length ? 1 : 0);
