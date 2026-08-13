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
  lines.push('INSERT OR REPLACE INTO questions');
  lines.push(
    '  (id, type, difficulty, body, choices_json, answer, explanation, status, source, generated_by, created_at, image_url)',
    'VALUES',
  );
  lines.push(
    approved
      .map(
        (q) =>
          `  (${sql(q.id)}, ${sql(q.type)}, ${q.difficulty}, ${sql(q.body)},\n` +
          `   ${q.choices ? sql(JSON.stringify(q.choices)) : 'NULL'}, ${sql(q.answer)},\n` +
          `   ${sql(q.explanation)}, 'approved', ${sql(q.source ?? 'manual')}, ${sql(q.generatedBy ?? null)}, ${sql(NOW)}, ${sql(q.imageUrl ?? null)})`,
      )
      .join(',\n') + ';',
    '',
  );

  // 승인 목록에서 빠진 문항의 연결은 지우고 다시 넣는다 (반려로 바뀐 문항 정리).
  // ⚠ author_uid IS NULL(=이 JSON 파이프라인이 만든 공식 문항)로 반드시 범위를
  // 좁힌다 — 안 그러면 유저 창작마당(커뮤니티) 문항까지 매 배포마다 전부
  // 지워진다. 실제로 배포 전 프로덕션에 이미 진짜 커뮤니티 문항이 있었다.
  lines.push("DELETE FROM question_topics WHERE question_id IN (SELECT id FROM questions WHERE author_uid IS NULL);");
  lines.push('INSERT OR IGNORE INTO question_topics (question_id, topic_id) VALUES');
  lines.push(
    approved
      .flatMap((q) => q.topicIds.map((t) => `  (${sql(q.id)}, ${sql(t)})`))
      .join(',\n') + ';',
    '',
  );

  // 승인되지 않은 "공식" 문항만 정리한다 — 커뮤니티 문항(author_uid가 있음)은 건드리지 않는다.
  const ids = approved.map((q) => sql(q.id)).join(', ');
  lines.push(`DELETE FROM questions WHERE author_uid IS NULL AND id NOT IN (${ids});`, '');
}

writeFileSync(OUT, lines.join('\n'), 'utf8');

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
