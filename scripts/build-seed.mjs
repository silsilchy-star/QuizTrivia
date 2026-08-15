#!/usr/bin/env node
// JSON(원본) → db/seed.generated.sql(생성물)
//
// 핵심: q_count와 status를 손으로 적지 않는다. 승인된 문항을 세어 계산하고,
// 난이도 1~4가 모두 하한을 넘으면 status를 active로 올린다 (PLAN 6.6절 [6] 하한 게이트).
//
// 사용: node scripts/build-seed.mjs

import { writeFileSync } from 'node:fs';
import { GATE_PER_DIFFICULTY, loadAllQuestions, loadTopics } from './lib.mjs';

const OUT = new URL('../db/seed.generated.sql', import.meta.url).pathname;
const NOW = '2026-08-12T00:00:00Z'; // 고정값 — 재생성해도 diff가 나지 않게 한다

const sql = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

// D1은 SQL 문 하나가 100KB를 넘으면 SQLITE_TOOBIG으로 거절한다. 문항이 560개가
// 되자 questions INSERT 한 문장이 224KB가 되어 배포가 여기서 멈췄다
// (2026-08-15, docs/2026-08-15-seed-statement-too-big.md).
//
// ⚠ 글자 수가 아니라 **바이트**로 재야 한다 — 한글은 UTF-8에서 한 자가 3바이트라
//    글자 수로 세면 실제 크기의 1/3만 보인다.
const D1_MAX_STATEMENT_BYTES = 100_000;
const CHUNK_BUDGET_BYTES = 40_000; // 한도의 절반 아래로 — 문항이 길어져도 여유가 남게

const bytes = (s) => Buffer.byteLength(s, 'utf8');

// 여러 행 INSERT를 예산 안에 들어가는 여러 문장으로 쪼갠다.
// header는 `INSERT ... VALUES`까지, rows는 `  (...)` 형태의 값 목록.
function chunkedInsert(header, rows) {
  const out = [];
  let batch = [];
  let size = 0;
  const flush = () => {
    if (!batch.length) return;
    out.push(header, batch.join(',\n') + ';', '');
    batch = [];
    size = 0;
  };
  for (const row of rows) {
    const rowBytes = bytes(row) + 2; // ',\n'
    if (batch.length && size + rowBytes > CHUNK_BUDGET_BYTES) flush();
    batch.push(row);
    size += rowBytes;
  }
  flush();
  return out;
}

const topics = loadTopics();
const approved = loadAllQuestions().filter((q) => q.status === 'approved');

// 주제별 난이도 집계
const counts = new Map(topics.map((t) => [t.id, { 1: 0, 2: 0, 3: 0, 4: 0 }]));
for (const q of approved) {
  for (const t of q.topicIds) {
    const c = counts.get(t);
    if (c) c[q.difficulty] += 1;
  }
}

const lines = [
  '-- 자동 생성 파일. 직접 고치지 말 것.',
  '-- 원본은 data/topics.json 과 data/questions/*.json 이고,',
  '-- `npm run build:seed` 로 재생성한다.',
  '--',
  `-- 하한 게이트: 난이도 1~4가 각각 ${GATE_PER_DIFFICULTY}문항 이상이면 status='active'`,
  '',
];

// ── topics ──
lines.push('INSERT OR REPLACE INTO topics');
lines.push(
  '  (id, no, name, kind, tagline, scope_json, out_of_scope_json, difficulty_spec_json,',
  '   status, q_count_1, q_count_2, q_count_3, q_count_4, created_at, updated_at)',
  'VALUES',
);

const topicRows = topics.map((t) => {
  const c = counts.get(t.id);
  const active = [1, 2, 3, 4].every((d) => c[d] >= GATE_PER_DIFFICULTY);
  return (
    `  (${sql(t.id)}, ${t.no}, ${sql(t.name)}, ${sql(t.kind)}, ${sql(t.tagline)},\n` +
    `   ${sql(JSON.stringify(t.scope ?? []))}, ${sql(JSON.stringify(t.outOfScope ?? []))},\n` +
    `   ${sql(JSON.stringify(t.difficultySpec ?? {}))},\n` +
    `   ${sql(active ? 'active' : 'draft')}, ${c[1]}, ${c[2]}, ${c[3]}, ${c[4]}, ${sql(NOW)}, ${sql(NOW)})`
  );
});
lines.push(topicRows.join(',\n') + ';', '');

// ── questions ──
if (approved.length) {
  const questionHeader =
    'INSERT OR REPLACE INTO questions\n' +
    '  (id, type, difficulty, body, choices_json, answer, explanation, status, source, generated_by, created_at, image_url)\n' +
    'VALUES';
  lines.push(
    ...chunkedInsert(
      questionHeader,
      approved.map(
        (q) =>
          `  (${sql(q.id)}, ${sql(q.type)}, ${q.difficulty}, ${sql(q.body)},\n` +
          `   ${q.choices ? sql(JSON.stringify(q.choices)) : 'NULL'}, ${sql(q.answer)},\n` +
          `   ${sql(q.explanation)}, 'approved', ${sql(q.source ?? 'manual')}, ${sql(q.generatedBy ?? null)}, ${sql(NOW)}, ${sql(q.imageUrl ?? null)})`,
      ),
    ),
  );

  // 승인 목록에서 빠진 문항의 연결은 지우고 다시 넣는다 (반려로 바뀐 문항 정리).
  // ⚠ author_uid IS NULL(=이 JSON 파이프라인이 만든 공식 문항)로 반드시 범위를
  // 좁힌다 — 안 그러면 유저 창작마당(커뮤니티) 문항까지 매 배포마다 전부
  // 지워진다. 실제로 배포 전 프로덕션에 이미 진짜 커뮤니티 문항이 있었다.
  lines.push("DELETE FROM question_topics WHERE question_id IN (SELECT id FROM questions WHERE author_uid IS NULL);");
  lines.push(
    ...chunkedInsert(
      'INSERT OR IGNORE INTO question_topics (question_id, topic_id) VALUES',
      approved.flatMap((q) => q.topicIds.map((t) => `  (${sql(q.id)}, ${sql(t)})`)),
    ),
  );

  // 승인되지 않은 "공식" 문항만 정리한다 — 커뮤니티 문항(author_uid가 있음)은 건드리지 않는다.
  const ids = approved.map((q) => sql(q.id)).join(', ');
  lines.push(`DELETE FROM questions WHERE author_uid IS NULL AND id NOT IN (${ids});`, '');
}

const out = lines.join('\n');

// ── D1 문장 크기 검사 ──
//
// 여기서 막지 않으면 프로덕션 배포의 `Apply D1 seed` 단계에서 터진다. 그 시점엔
// 스키마·마이그레이션이 이미 적용된 뒤라 워커만 옛 버전으로 남는다(교훈 17번).
// 로컬 빌드에서 먼저 실패시키는 편이 훨씬 싸다.
//
// 문장 분리는 작은따옴표 안의 세미콜론을 건너뛴다 — 문항 본문에 ';'가 들어갈 수
// 있어서 단순 split(';')으로는 문장 경계를 잘못 잡는다.
function splitStatements(text) {
  const stmts = [];
  let start = 0;
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === "'") {
        if (text[i + 1] === "'") i += 1; // 이스케이프된 따옴표('')
        else inString = false;
      }
    } else if (ch === "'") {
      inString = true;
    } else if (ch === ';') {
      stmts.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  const tail = text.slice(start);
  if (tail.trim()) stmts.push(tail);
  return stmts;
}

const oversized = splitStatements(out)
  .map((s) => ({ size: bytes(s), head: s.trim().slice(0, 60).replace(/\s+/g, ' ') }))
  .filter((s) => s.size > D1_MAX_STATEMENT_BYTES);

if (oversized.length) {
  console.error(`\n❌ D1 문장 크기 한도(${D1_MAX_STATEMENT_BYTES}바이트) 초과 ${oversized.length}건:`);
  for (const s of oversized) console.error(`   ${s.size}바이트 — ${s.head}…`);
  console.error('\n   CHUNK_BUDGET_BYTES를 줄이거나, 아직 안 쪼갠 INSERT를 chunkedInsert로 감쌀 것.\n');
  process.exit(1);
}

writeFileSync(OUT, out, 'utf8');

// ── 요약 ──
const gated = topics
  .map((t) => {
    const c = counts.get(t.id);
    return { name: t.name, c, active: [1, 2, 3, 4].every((d) => c[d] >= GATE_PER_DIFFICULTY) };
  })
  .filter((g) => Object.values(g.c).some((n) => n > 0));

console.log(`db/seed.generated.sql 작성 — 승인 문항 ${approved.length}개\n`);
for (const g of gated) {
  const bar = [1, 2, 3, 4].map((d) => `${d}:${String(g.c[d]).padStart(2)}`).join(' ');
  console.log(`  ${g.active ? '✅ active' : '⬜ draft '} ${g.name.padEnd(5)} ${bar}`);
}
