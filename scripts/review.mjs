#!/usr/bin/env node
// 로컬 검수 도구 — PLAN 6.6절 [4] "기계가 못 잡는 것"
//
// 자동 검증(scripts/validate.mjs)이 넘긴 경고를 문항마다 붙여 보여주고,
// 승인/반려를 클릭하면 data/questions/*.json 에 바로 기록한다.
// 의존성 0 — node 내장 http 서버만 쓴다.
//
// 사용: npm run review  →  http://localhost:5174

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadQuestionFile, loadTopics, questionFiles, saveQuestionFile } from './lib.mjs';

const PORT = Number(process.env.PORT ?? 5174);
const HTML = new URL('./review.html', import.meta.url).pathname;

/** validate.mjs를 그대로 재사용한다 — 검수 화면과 CI가 같은 규칙을 보도록. */
function runValidate() {
  try {
    const out = execFileSync('node', [new URL('./validate.mjs', import.meta.url).pathname, '--json'], {
      encoding: 'utf8',
    });
    return JSON.parse(out);
  } catch (e) {
    // 오류가 있어도 exit 1이라 여기로 온다. stdout은 여전히 유효한 JSON.
    try {
      return JSON.parse(e.stdout);
    } catch {
      return { errors: [{ id: '-', msg: String(e) }], warns: [], gate: [] };
    }
  }
}

function snapshot() {
  const { errors, warns, gate } = runValidate();
  const notes = new Map();
  for (const e of errors) notes.set(e.id, [...(notes.get(e.id) ?? []), { level: 'error', msg: e.msg }]);
  for (const w of warns) notes.set(w.id, [...(notes.get(w.id) ?? []), { level: 'warn', msg: w.msg }]);

  const topicName = new Map(loadTopics().map((t) => [t.id, t.name]));
  const questions = questionFiles().flatMap((file) =>
    loadQuestionFile(file).questions.map((q) => ({
      ...q,
      file,
      topicNames: q.topicIds?.map((t) => topicName.get(t) ?? t) ?? [],
      notes: notes.get(q.id) ?? [],
    })),
  );
  return { questions, gate };
}

function setStatus(id, status, rejectReason) {
  for (const file of questionFiles()) {
    const data = loadQuestionFile(file);
    const q = data.questions.find((x) => x.id === id);
    if (!q) continue;
    q.status = status;
    q.rejectReason = status === 'rejected' ? rejectReason || '사유 미기재' : null;
    saveQuestionFile(file, data);
    return true;
  }
  return false;
}

const json = (res, body, code = 200) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(readFileSync(HTML, 'utf8'));
  }

  if (url.pathname === '/api/questions') return json(res, snapshot());

  if (url.pathname === '/api/status' && req.method === 'POST') {
    const body = await new Promise((resolve) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => resolve(JSON.parse(raw || '{}')));
    });
    const ok = setStatus(body.id, body.status, body.rejectReason);
    return json(res, ok ? snapshot() : { error: 'not found' }, ok ? 200 : 404);
  }

  res.writeHead(404).end('not found');
}).listen(PORT, () => {
  console.log(`검수 도구: http://localhost:${PORT}`);
});
