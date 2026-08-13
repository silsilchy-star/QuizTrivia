#!/usr/bin/env node
// 자동 검증 — PLAN 6.6절 [3] "기계가 잡을 수 있는 것"
//
// ERROR : 형식이 깨져 파이프라인을 진행할 수 없다. 반드시 고쳐야 한다.
// WARN  : 기계가 확신할 수 없다. 사람 검수(6.6절 [4])로 넘긴다.
//
// 사용: node scripts/validate.mjs [--json]

import {
  GATE_PER_DIFFICULTY,
  NUMERIC_RATIO,
  OVERLAP_WARN,
  loadAllQuestions,
  loadTopics,
  normalize,
} from './lib.mjs';

const TYPES = ['MULTIPLE_CHOICE', 'NUMERIC_INPUT'];
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

  // 중복 문항 (PLAN 6.6절 [3])
  if (q.body) {
    const key = normalize(q.body);
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

// 주제 쌍 겹침 (PLAN 6.4절 ⑤) — 겹침 자체는 정상이고, 사실상 같은 주제인 경우만 잡는다
const ids = [...byTopic.keys()];
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const a = new Set(byTopic.get(ids[i]).map((q) => q.id));
    const b = new Set(byTopic.get(ids[j]).map((q) => q.id));
    if (a.size < 10 || b.size < 10) continue;
    const shared = [...a].filter((x) => b.has(x)).length;
    const overlap = shared / Math.min(a.size, b.size);
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
