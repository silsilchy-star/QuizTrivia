#!/usr/bin/env node
// 정답률 기반 난이도 보정 — 후보만 찾아서 보여준다. 절대 자동으로 고치지 않는다.
//
// question_stats(served_count, correct_count)는 게임에서 실제로 출제되고
// 채점될 때마다 쌓인다(worker/index.ts). 표본이 너무 적으면 우연히 몇 명이
// 다 맞히거나 다 틀려서 정답률이 극단으로 튀므로, 최소 표본 수 미만은 아예
// 판단 대상에서 뺀다.
//
// 여기서 나온 후보는 사람이 문항 본문을 직접 읽어보고 판단한 뒤
// data/questions/*.json의 difficulty를 손으로 고치는 데 쓴다 — 이 스크립트는
// DB도 JSON도 건드리지 않는다.
//
// 사용:
//   npm run difficulty:review                # 프로덕션(D1 remote) 조회
//   npm run difficulty:review -- --local      # 로컬 D1 조회 (npm run db:local 먼저)
//   npm run difficulty:review -- --min-samples=20

import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const local = args.includes('--local');
const minSamplesArg = args.find((a) => a.startsWith('--min-samples='));
const MIN_SAMPLES = minSamplesArg ? Number(minSamplesArg.split('=')[1]) : 10;

/** 정답률 이 값 이상이면 "너무 쉬움" 후보 (난이도 -1 제안). */
const TOO_EASY_THRESHOLD = 0.9;
/** 정답률 이 값 이하이면 "너무 어려움" 후보 (난이도 +1 제안). */
const TOO_HARD_THRESHOLD = 0.3;

const SQL = `
  SELECT q.id, q.difficulty, q.body, q.author_uid,
         qs.served_count, qs.correct_count
  FROM questions q
  JOIN question_stats qs ON qs.question_id = q.id
  WHERE q.status = 'approved'
`.trim();

function runQuery() {
  const flag = local ? '--local' : '--remote';
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'quiztrivia', flag, '--json', '--command', SQL],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  const parsed = JSON.parse(out);
  // wrangler --json은 [{ results: [...], success: true, ... }] 형태로 온다.
  return parsed[0]?.results ?? [];
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

const rows = runQuery();
const withEnoughSamples = rows.filter((r) => r.served_count >= MIN_SAMPLES);

const tooEasy = withEnoughSamples
  .filter((r) => r.difficulty > 1 && r.correct_count / r.served_count >= TOO_EASY_THRESHOLD)
  .map((r) => ({ ...r, accuracy: r.correct_count / r.served_count, suggested: r.difficulty - 1 }))
  .sort((a, b) => b.accuracy - a.accuracy);

const tooHard = withEnoughSamples
  .filter((r) => r.difficulty < 4 && r.correct_count / r.served_count <= TOO_HARD_THRESHOLD)
  .map((r) => ({ ...r, accuracy: r.correct_count / r.served_count, suggested: r.difficulty + 1 }))
  .sort((a, b) => a.accuracy - b.accuracy);

function printSection(title, list) {
  console.log(`\n${title} (${list.length}건)`);
  if (list.length === 0) {
    console.log('  없음');
    return;
  }
  for (const r of list) {
    const pct = (r.accuracy * 100).toFixed(0);
    const origin = r.author_uid ? '커뮤니티' : '공식';
    console.log(
      `  ${r.id}  난이도 ${r.difficulty}→${r.suggested}  정답률 ${pct}%(${r.correct_count}/${r.served_count})  [${origin}]`,
    );
    console.log(`    ${truncate(r.body, 70)}`);
  }
}

console.log(`정답률 기반 난이도 보정 후보 — ${local ? '로컬' : '프로덕션'} D1, 최소 표본 ${MIN_SAMPLES}건`);
console.log(`대상 ${rows.length}건 중 표본 충족 ${withEnoughSamples.length}건`);

printSection(`⬇ 너무 쉬움 후보 (정답률 ≥ ${TOO_EASY_THRESHOLD * 100}%)`, tooEasy);
printSection(`⬆ 너무 어려움 후보 (정답률 ≤ ${TOO_HARD_THRESHOLD * 100}%)`, tooHard);

console.log(
  '\n이 목록은 후보일 뿐이다. 문항 본문을 직접 읽고 납득이 가면 data/questions/*.json의 difficulty를 손으로 고친 뒤,',
);
console.log('npm run validate && npm test로 확인하고 커밋한다. 이 스크립트는 아무것도 바꾸지 않는다.');
