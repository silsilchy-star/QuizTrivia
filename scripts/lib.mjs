import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DATA_DIR = new URL('../data/', import.meta.url).pathname;
export const QUESTIONS_DIR = join(DATA_DIR, 'questions');

/** PLAN 6.6절 하한 게이트 — 난이도 등급마다 이만큼 승인돼야 주제가 active가 된다. */
export const GATE_PER_DIFFICULTY = 20;
/** PLAN 4.4절 — 주제별 NUMERIC_INPUT 목표 비율 */
export const NUMERIC_RATIO = { min: 0.2, max: 0.25 };
/** PLAN 6.4절 ⑤ — 두 주제의 문항 집합이 이만큼 겹치면 사실상 같은 주제다. */
export const OVERLAP_WARN = 0.9;

/** 단답형 별칭(answerAliases)의 최대 개수. 표기 흔들림을 적는 자리이지,
 *  "아무 말이나 쓰면 맞는 문제"를 만드는 자리가 아니다. */
export const ANSWER_ALIASES_MAX = 6;

/** 단답형 답 비교용 정규화 — 앞뒤/중복 공백과 대소문자 차이를 없앤다.
 *
 *  ⚠ 이 규칙은 워커의 `normalizeText`(worker/index.ts)와 **같아야 한다.**
 *    여기는 평범한 .mjs라 TypeScript를 import할 수 없어 한 벌 더 쓴 것이다.
 *    두 구현이 어긋나면 validate가 통과시킨 별칭이 실제 채점에서는 정답으로
 *    안 쳐지는 일이 생긴다. `test/answer-aliases.test.ts`가 두 구현을 같은
 *    입력표로 대조해 어긋남을 막는다. */
export function normalizeAnswer(s) {
  return String(s).trim().replace(/\s+/g, ' ').toLowerCase();
}

export function loadTopics() {
  const raw = JSON.parse(readFileSync(join(DATA_DIR, 'topics.json'), 'utf8'));
  return raw.topics;
}

export function questionFiles() {
  return readdirSync(QUESTIONS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
}

export function loadQuestionFile(file) {
  return JSON.parse(readFileSync(join(QUESTIONS_DIR, file), 'utf8'));
}

export function saveQuestionFile(file, data) {
  writeFileSync(join(QUESTIONS_DIR, file), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export function loadAllQuestions() {
  return questionFiles().flatMap((file) =>
    loadQuestionFile(file).questions.map((q) => ({ ...q, _file: file })),
  );
}

/** 비교용 정규화 — 공백·문장부호를 걷어내 중복 판정에 쓴다. */
export function normalize(text) {
  return text.replace(/\s+/g, '').replace(/[?？.!,·'"()]/g, '').toLowerCase();
}
