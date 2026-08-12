# Day 2 — 수직 슬라이스 (화면 → D1 → 화면 관통)

## 완료 판정 (PLAN 8장)
> "문제를 풀고 결과가 DB에 남는다"

**충족.** 로컬에서 브라우저로 5문항을 실제로 풀어 결과 화면까지 확인하고, `runs`·`topic_best`·`users.global_score`가 갱신되는 것을 검증했다.

## 한 일

### 데이터
- `db/schema.sql` — PLAN 7.2절 전체 스키마로 확장 (topics, questions, question_topics, users, topic_best, topic_best_weekly, runs, ranking_cache). 배포마다 재실행되므로 전부 `IF NOT EXISTS`
- `db/seed.sql` — 주제 6개(과학 broad + 화학·천문·인체·생물·단위 narrow) + 문항 10개
  - 문항은 PLAN 6.3절 "과학" 정의서의 **예시문을 그대로** 쓰고 오답 선택지만 추가했다. 정의서가 실제로 문항으로 성립하는지 검증하는 효과도 있음
  - `NUMERIC_INPUT` 2/10 = **20%** (PLAN 4.4절 20~25% 하한 충족)
  - 난이도 분포 1:3, 2:3, 3:2, 4:2
  - D-16 복수 부착 실증 — 문항마다 `science` + 좁은 태그 1개

### 서버 (worker/index.ts)
- `GET /api/topics` — `status='active'`인 주제만 노출
- `POST /api/runs` — 주제 검증 → 문항 5개 무작위 출제 → `runs` 행 생성
- `POST /api/runs/:id/submit` — **서버 채점**, `runs`/`topic_best`/`users` 갱신

### 프론트 (src/)
- `api.ts` — **EP-5 저장소 계층**. 화면은 `fetch`를 직접 부르지 않는다
- `types.ts` — Worker/프론트 공유 타입. 양쪽 tsconfig에서 함께 include
- `App.tsx` — 주제 선택 → 문항 풀이 → 결과(해설 포함) 화면
- `App.css` — 모바일 우선 (타겟 15~20세는 대부분 폰, PLAN 4.4절)

## 설계 판단 3개

**1. 7.5절 A안(서버 채점)을 Day 2부터 구조에 박았다.**
정답과 해설은 출제 응답에 **포함되지 않는다**(`ServedQuestion` 타입에 `answer` 필드 자체가 없음). 채점 후 응답에서만 내려간다. 나중에 A안으로 "올리는" 게 아니라 처음부터 A안이다 — Cloudflare에선 어차피 요청이 Worker를 거치므로 추가 비용이 0이기 때문.

**2. `runs.served_json` 컬럼을 추가했다 (PLAN 7.2절에 없던 것).**
출제 시점에 문항 id를 서버가 박아둔다. 채점은 이 목록만 대상으로 하므로, 클라이언트가 풀지도 않은 쉬운 문항의 정답을 제출해 점수를 부풀리는 것이 불가능하다. A안을 실제로 성립시키려면 필요한 컬럼이라 PLAN에 추가 반영해야 함.

**3. 시드 주제를 `status='active'`로 직접 박았다 — Day 2 한정.**
원래는 난이도당 20문항 하한을 넘겨야 active가 된다(6.6절 하한 게이트). 10문항으로는 통과 불가. **게이트 로직 자체는 Day 3에서 만들고**, API는 이미 `status='active'` 필터를 걸어둬서 게이트가 붙는 순간 바로 작동한다. 실제로 `draft`인 `chemistry`로 판을 시작하면 404가 난다(아래 테스트 10).

## 검증

로컬 `wrangler dev` + D1 로컬 에뮬레이션:

| # | 케이스 | 결과 |
|---|---|---|
| 1 | 세션 발급 | uid 발급 ✅ |
| 2 | `GET /api/topics` | `active`인 과학 1개만 (narrow 5개는 draft라 미노출) ✅ |
| 3 | 판 시작 | 문항 5개, **응답에 `answer` 없음** ✅ |
| 4 | 전부 정답 | 130점 = Σ(난이도×10) 정확히 일치, cleared=true, topicBest/global 갱신 ✅ |
| 5 | 같은 판 재제출 | 409 `run already finished` ✅ |
| 6 | 전부 오답 | 0점, cleared=false, **최고기록 130 유지**, isNewBest=false ✅ |
| 7 | 위조 — 출제 안 된 문항의 정답만 제출 | 0점, total=5 (전부 무시) ✅ |
| 8 | 숫자 입력 `" 100.0 "` → 정답 `"100"` | correct=true (공백·소수 표기 정규화) ✅ |
| 9 | 세션 없이 판 시작 | 401 ✅ |
| 10 | `draft` 주제로 판 시작 | 404 ✅ |

브라우저(Playwright, 420×820 모바일 뷰포트)로 주제 선택 → 5문항 풀이 → 결과 화면까지 실제 클릭으로 관통 확인. 검증용으로만 썼으므로 playwright는 의존성에서 제거함.

## 배포 파이프라인 변경
`deploy.yml`에 시드 적용 단계 추가 (schema → seed → build → deploy). 시드가 멱등이라 재배포해도 안전.

## 다음 (Day 3)
주제 등록 파이프라인 — 프롬프트 템플릿 파일, 붙여넣은 JSON 취합·검증기, 검수 화면, **하한 게이트 자동 판정**. 완료 판정은 "주제 1개가 `draft`→`active`로 자동 전환된다".
