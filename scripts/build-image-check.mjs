#!/usr/bin/env node
// data/questions/*.json의 이미지 문항을 한 페이지에 늘어놓는 검수 페이지를 만든다.
//
// 왜 필요한가: 이미지 URL이 실제로 살아있는지는 브라우저에서만 확인된다.
// 이 작업 환경은 commons.wikimedia.org 같은 외부 호스트가 프록시 정책상
// 차단돼 있어서(HTTP 000 / CONNECT 403) 여기서는 검증할 수 없다.
//
// 눈으로 24장을 훑게 하지 않는다 — <img>의 onerror로 실패를 자동 감지해서
// 맨 위에 "N개 실패" 요약과 실패 목록만 보여준다. 사람은 요약만 읽으면 된다.
//
// 사용: node scripts/build-image-check.mjs   →  public/image-check.html

import { mkdirSync, writeFileSync } from 'node:fs';
import { loadAllQuestions } from './lib.mjs';

const OUT_DIR = new URL('../public/', import.meta.url).pathname;
const OUT = `${OUT_DIR}image-check.html`;

const withImages = loadAllQuestions().filter((q) => q.imageUrl);

if (withImages.length === 0) {
  console.log('이미지가 붙은 문항이 없다. 페이지를 만들지 않는다.');
  process.exit(0);
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const cards = withImages
  .map(
    (q) => `    <figure class="card" data-id="${esc(q.id)}">
      <img src="${esc(q.imageUrl)}" alt="${esc(q.answer)}">
      <figcaption>
        <b>${esc(q.answer)}</b>
        <span class="meta">${esc(q.id)} · 난이도 ${q.difficulty}</span>
        <a href="${esc(q.imageUrl)}" target="_blank" rel="noreferrer">원본 열기</a>
      </figcaption>
    </figure>`,
  )
  .join('\n');

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>이미지 검수 — QuizTrivia</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 1.5rem;
         background: Canvas; color: CanvasText; }
  h1 { font-size: 1.3rem; margin: 0 0 .25rem; }
  .sub { color: GrayText; font-size: .9rem; margin: 0 0 1rem; }
  #summary { position: sticky; top: 0; z-index: 10; padding: 1rem 1.25rem; border-radius: 12px;
             margin-bottom: 1.5rem; font-size: 1.05rem; line-height: 1.6;
             background: #eef2ff; border: 1px solid #c7d2fe; color: #1e293b; }
  #summary.done-ok   { background: #ecfdf5; border-color: #6ee7b7; }
  #summary.done-bad  { background: #fef2f2; border-color: #fca5a5; }
  #summary b { font-size: 1.15rem; }
  #failList { margin: .75rem 0 0; padding-left: 1.25rem; }
  #failList li { margin: .2rem 0; font-family: ui-monospace, monospace; font-size: .85rem; }
  .grid { display: grid; gap: 1rem;
          grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); }
  .card { margin: 0; border: 1px solid ButtonBorder; border-radius: 10px; overflow: hidden;
          background: Canvas; }
  .card.bad { border-color: #ef4444; border-width: 2px; }
  .card img { display: block; width: 100%; height: 160px; object-fit: cover; background: #f1f5f9; }
  .card.bad img { height: 60px; object-fit: contain; }
  figcaption { padding: .55rem .7rem; font-size: .85rem; display: grid; gap: .15rem; }
  .meta { color: GrayText; font-size: .75rem; }
  figcaption a { font-size: .75rem; }
</style>
</head>
<body>
<h1>이미지 검수</h1>
<p class="sub">문항 이미지가 실제로 뜨는지 브라우저에서 확인합니다. 깨진 것은 자동으로 표시되니 <b>맨 위 요약만 보시면 됩니다.</b></p>

<div id="summary">불러오는 중… <b><span id="loaded">0</span> / ${withImages.length}</b></div>

<div class="grid">
${cards}
</div>

<script>
  var TOTAL = ${withImages.length};
  var done = 0, failed = [];
  var summary = document.getElementById('summary');
  var loadedEl = document.getElementById('loaded');

  function tick() {
    done++;
    loadedEl.textContent = done;
    if (done < TOTAL) return;
    if (failed.length === 0) {
      summary.className = 'done-ok';
      summary.innerHTML = '✅ <b>' + TOTAL + '장 전부 정상</b>입니다. 이미지 방식 그대로 문항을 늘려도 됩니다.';
    } else {
      summary.className = 'done-bad';
      summary.innerHTML = '⚠️ <b>' + TOTAL + '장 중 ' + failed.length + '장이 깨졌습니다.</b>'
        + '<br>아래 id를 알려주시면 해당 항목만 교체하겠습니다.'
        + '<ul id="failList">' + failed.map(function (id) { return '<li>' + id + '</li>'; }).join('') + '</ul>';
    }
  }
  function ok() { tick(); }
  function fail(img) {
    var card = img.closest('.card');
    card.classList.add('bad');
    failed.push(card.dataset.id);
    tick();
  }

  // 리스너는 여기서만 붙인다. 인라인 onload/onerror를 함께 쓰면 이 스크립트가
  // 돌기 전에 끝난 이미지가 두 번 집계된다. 이미 끝난 것은 complete로 가려낸다.
  document.querySelectorAll('.card img').forEach(function (img) {
    if (img.complete) {
      img.naturalWidth === 0 ? fail(img) : ok();
    } else {
      img.addEventListener('load', ok, { once: true });
      img.addEventListener('error', function () { fail(img); }, { once: true });
    }
  });
</script>
</body>
</html>
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, html, 'utf8');
console.log(`public/image-check.html 작성 — 이미지 문항 ${withImages.length}개`);
