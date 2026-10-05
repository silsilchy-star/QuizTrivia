#!/usr/bin/env node
// 로컬 Ollama로 문항 초안 생성 — PLAN 6.6절 [2]를 자동화한다.
//
// prompts/generate-questions.md의 템플릿을 그대로 읽어 주제 정의서(data/topics.json)를
// 채워 넣고, Ollama가 돌려준 문항을 data/questions/{넓은주제}.json 뒤에
// **status: "pending"** 으로 붙인다. 승인은 여전히 사람이 한다:
//
//   npm run generate:ollama -- --topic=science --difficulty=2 --count=10
//   npm run validate
//   npm run review
//
// 모델이 정하면 안 되는 필드(id·status·source·generatedBy)는 여기서 덮어쓴다.
// id 일련번호는 모델이 기존 문항을 모르니 충돌하기 쉽고, status를 모델에게
// 맡기면 검수를 건너뛸 수 있기 때문이다.
//
// 난이도 3은 만들지 않는다 — 템플릿 문서의 "난이도 3 전용 절차"를 따른다.
//
// 옵션:
//   --topic=<id>        넓은 주제 id (science | geography | sports ...)  [필수]
//   --difficulty=<1|2|4>                                                 [필수]
//   --count=<n>         기본 10
//   --model=<name>      기본 $OLLAMA_MODEL 또는 llama3.1
//   --host=<url>        기본 $OLLAMA_HOST 또는 http://localhost:11434
//   --dry-run           파일에 쓰지 않고 결과만 출력
//
// 의존성 0 — node 내장 fetch만 쓴다.

import { readFileSync } from 'node:fs';
import { loadAllQuestions, loadQuestionFile, loadTopics, normalize, saveQuestionFile } from './lib.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : true];
  }),
);

const topicId = args.topic;
const difficulty = Number(args.difficulty);
const count = Number(args.count ?? 10);
const model = args.model ?? process.env.OLLAMA_MODEL ?? 'llama3.1';
const host = String(args.host ?? process.env.OLLAMA_HOST ?? 'http://localhost:11434').replace(/\/+$/, '');
const dryRun = Boolean(args['dry-run']);

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const topics = loadTopics();
const topic = topics.find((t) => t.id === topicId);
if (!topic) fail(`--topic이 없거나 등록되지 않음. 넓은 주제: ${topics.filter((t) => t.kind === 'broad').map((t) => t.id).join(', ')}`);
if (topic.kind !== 'broad') fail(`${topicId}는 좁은 주제다 — 넓은 주제(${topic.parent})로 생성하라`);
if (difficulty === 3) fail('난이도 3은 이 스크립트로 만들지 않는다 — prompts/generate-questions.md "난이도 3 전용 절차" 참고');
if (![1, 2, 4].includes(difficulty)) fail('--difficulty는 1, 2, 4 중 하나');
if (!Number.isInteger(count) || count < 1 || count > 50) fail('--count는 1~50');

// ── 프롬프트 ─────────────────────────────────────────────────────
// 템플릿 원본은 하나 — 문서를 고치면 이 스크립트도 따라간다.
const templateDoc = readFileSync(new URL('../prompts/generate-questions.md', import.meta.url), 'utf8');
const template = templateDoc.match(/## 템플릿\s+```\n([\s\S]*?)\n```/)?.[1];
if (!template) fail('prompts/generate-questions.md에서 템플릿 코드블록을 찾지 못함');

const spec = topic.difficultySpec[String(difficulty)];
const prefix = topicId.slice(0, 3);
const fill = {
  주제: topic.name,
  주제명: topic.name,
  난이도: String(difficulty),
  개수: String(count),
  tagline: topic.tagline,
  scope: topic.scope.join(', '),
  outOfScope: topic.outOfScope.join(', '),
  'difficultySpec[난이도].rule': spec.rule,
  'difficultySpec[난이도].examples': spec.examples.map((e) => `- ${e}`).join('\n'),
  allowedTags: topic.allowedTags.join(', '),
  주제id: prefix,
  모델명: `ollama:${model}`,
};
const prompt = template.replace(/\{([^{}"\n]+)\}/g, (m, key) => fill[key] ?? m);

// ── Ollama 호출 ──────────────────────────────────────────────────
async function generate() {
  let res;
  try {
    res = await fetch(`${host}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        options: { temperature: 0.7 },
        messages: [
          {
            role: 'system',
            content: '너는 한국어 퀴즈 문항 작성자다. 반드시 {"questions": [...]} 형태의 JSON 객체 하나만 출력한다.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });
  } catch (e) {
    fail(`Ollama(${host})에 연결하지 못함 — \`ollama serve\`가 떠 있는지 확인. (${e.cause?.code ?? e.cause?.message ?? e.message})`);
  }
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 404 && text.includes('not found')) fail(`모델 "${model}"이 없다 — \`ollama pull ${model}\``);
    fail(`Ollama 응답 ${res.status}: ${text.slice(0, 300)}`);
  }
  const body = await res.json();
  return body.message?.content ?? '';
}

/** format:'json'은 객체를 강제하므로 {"questions":[...]}로 받되, 배열만 와도 받아준다. */
function parse(content) {
  let data;
  try {
    data = JSON.parse(content);
  } catch {
    const s = content.indexOf('[');
    const e = content.lastIndexOf(']');
    if (s < 0 || e < s) fail(`모델 출력이 JSON이 아니다:\n${content.slice(0, 500)}`);
    data = JSON.parse(content.slice(s, e + 1));
  }
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.questions)) return data.questions;
  const arr = Object.values(data ?? {}).find(Array.isArray);
  if (arr) return arr;
  fail(`모델 출력에서 문항 배열을 찾지 못함:\n${content.slice(0, 500)}`);
}

console.log(`→ ${host} · ${model} · ${topic.name} 난이도 ${difficulty} × ${count}`);
const raw = parse(await generate());

// ── 정리 ─────────────────────────────────────────────────────────
// 형식 검사는 validate.mjs가 한다. 여기서는 모델이 정하면 안 되는 필드만
// 덮어쓰고, 이미 있는 문항과 겹치는 것만 거른다.
const existing = loadAllQuestions();
const seenBody = new Set(existing.map((q) => normalize(q.body ?? '')));
let nextNo =
  Math.max(
    100,
    ...existing.filter((q) => q.id?.startsWith(`${prefix}-`)).map((q) => Number(q.id.split('-').pop()) || 0),
  ) + 1;

const accepted = [];
const skipped = [];
for (const q of raw) {
  if (typeof q?.body !== 'string' || !q.body.trim()) {
    skipped.push({ body: '(본문 없음)', why: '형식 불량' });
    continue;
  }
  const key = normalize(q.body);
  if (seenBody.has(key)) {
    skipped.push({ body: q.body, why: '기존 문항과 중복' });
    continue;
  }
  seenBody.add(key);

  const type = q.type === 'NUMERIC_INPUT' ? 'NUMERIC_INPUT' : 'MULTIPLE_CHOICE';
  const tags = Array.isArray(q.topicIds) ? q.topicIds.map(String) : [];
  accepted.push({
    id: `${prefix}-${nextNo++}`,
    type,
    difficulty,
    body: q.body.trim(),
    choices: type === 'MULTIPLE_CHOICE' && Array.isArray(q.choices) ? q.choices.map(String) : null,
    answer: String(q.answer ?? '').trim(),
    explanation: String(q.explanation ?? '').trim(),
    // 넓은 태그는 항상 맨 앞에 — 모델이 빼먹어도 validate가 잡기 전에 채운다.
    topicIds: [topicId, ...tags.filter((t) => t !== topicId)],
    status: 'pending',
    source: 'ai_generated',
    generatedBy: `ollama:${model}`,
    rejectReason: null,
  });
}

for (const q of accepted) console.log(`  + ${q.id}  ${q.body}  → ${q.answer}`);
for (const s of skipped) console.log(`  - ${s.why}: ${s.body}`);

if (dryRun) {
  console.log(`\n(dry-run) ${accepted.length}건 생성, 파일에는 쓰지 않음`);
  process.exit(0);
}
if (accepted.length === 0) fail('붙일 문항이 없다');

const file = `${topicId}.json`;
const data = loadQuestionFile(file);
data.questions.push(...accepted);
saveQuestionFile(file, data);

console.log(`\n✓ data/questions/${file}에 pending ${accepted.length}건 추가`);
console.log('  다음: npm run validate → npm run review');
