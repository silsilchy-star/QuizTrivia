# 토대 다지기 — 배포 안전장치와 테스트 골조

## 왜 이 작업을 했나
"기초를 단단히 하고 확장을 고려한다"는 관점에서 프로젝트를 처음부터 다시 점검했다. 지금까지는 콘텐츠와 기능을 위로 쌓아왔는데, 그걸 받치는 층에 구멍이 있었다. 건축으로 치면 지반과 골조를 건너뛰고 층을 올리던 상태다.

점검은 문서가 아니라 **실제 코드와 실행**으로 했다: 빈 D1에 `schema.sql` → `migrations` → `seed`를 순서대로 적용해보고, 사용자 데이터를 심은 뒤 배포를 재현해 데이터가 살아남는지 확인했다(살아남았다).

## 발견한 것

### 🟥 지반
1. **배포 파이프라인 순서가 거꾸로였다.** `deploy.yml`이 D1 스키마·마이그레이션·seed를 먼저 적용하고, 프론트 빌드(=유일한 타입체크)를 나중에 했다. `wrangler deploy`는 타입체크를 하지 않으므로, 워커에 타입 에러가 있으면 **프로덕션 DB만 새 스키마로 바뀌고 워커는 옛 버전으로 남는** 어긋난 상태가 된다.
2. **손에 잡히는 백업이 없었다.** D1 Time Travel(30일)이 있지만 이 DB에서 검증한 적이 없고, 배포 전 export도 없었다. `schema.sql` DROP 사고(`a1fcdfe`) 때 복구 수단이 없었던 그대로다.
3. **트렁크가 임시 브랜치였다.** default 브랜치가 `claude/repo-permissions-check-ff2du7`이고 README도 "permission check ... temporarily" 그대로였다.

### 🟧 골조
4. **테스트가 0개였다.** 워커 534줄에 채점·점수 상한·스테이지 진행·하한 게이트·랭킹 경계가 전부 들어있는데 검증이 하나도 없었다. 인수인계 문서의 "실제 사용자가 프로덕션에서 버그를 발견하는 패턴이 많았다"는 관찰은 우연이 아니라 이 구조의 결과다.

## 무엇을 고쳤나

### 배포 파이프라인 (`.github/workflows/deploy.yml`)
검증을 전부 **DB를 건드리기 전으로** 옮겼다.

```
typecheck → test → validate → build:seed → 프론트 빌드 → 워커 dry-run 번들
  → D1 백업 export (아티팩트 30일 보관)
  → D1 schema → migrations → seed
  → Worker 배포
```

- `wrangler deploy --dry-run`을 추가해 워커가 실제로 번들되는지까지 확인한다. `npm run build`는 프론트만 빌드하므로 이것만으로는 워커 번들 실패를 못 잡는다.
- `concurrency: deploy-production`으로 배포가 겹치지 않게 했다. 두 배포가 같은 D1에 동시에 마이그레이션을 거는 상황을 막는다. `cancel-in-progress: false` — DB 작업 중간에 끊기는 것이 더 위험하다.
- 트리거를 `main`으로 바꿨다.

### CI (`.github/workflows/ci.yml`, 신규)
배포와 분리했다. 배포 시크릿이 없는 상태에서도 모든 브랜치·PR에서 검증만은 항상 돈다.

### 테스트 골조 (`test/`, 신규 — 70개)
`@cloudflare/vitest-pool-workers`로 **실제 Workers 런타임 + 실제 D1** 위에서 돈다. 모킹이 아니라 진짜 워커를 fetch한다.

- `test/setup.ts` — 테스트 D1을 **프로덕션과 같은 순서로** 만든다(`schema.sql` → `migrations`). 순서가 같아야 "로컬은 되는데 배포하면 깨지는" 상황을 테스트가 잡는다.
- 문항 데이터(`data/*.json`)는 일부러 넣지 않는다. **테스트는 자기가 쓸 문항을 직접 만든다** — 콘텐츠가 늘었다고 무관한 테스트가 깨지면 안 된다.

무엇을 덮었나:

| 파일 | 내용 |
|---|---|
| `scoring.test.ts` | 채점 규칙(3개 문제 유형), 스테이지→난이도 매핑, ISO 주차(연말연시 경계 포함), 창작마당 자동 검증 규칙 |
| `run.test.ts` | 세션 발급·유지, 주제 노출 범위, 판 시작, 스테이지 채점, **12스테이지 완주(만점 1500 + 60문항 무중복)**, 문항 통계 집계 |
| `community.test.ts` | 창작마당 권한(익명/닉네임/타인), 하한 게이트 5/난이도, 중복 문항, **랭킹 경계선**, 랭킹 보드, 주제 삭제 |

특히 못을 박아둔 **보안·불변식**:
- 출제 응답에 `answer`/`explanation`이 들어가지 않는다 (서버 채점 A안의 전제)
- 서버가 내지 않은 문항을 제출해도 점수가 붙지 않는다
- 남의 판은 채점할 수 없고, 끝난 판에 다시 제출할 수 없다
- **커뮤니티 주제를 완주해도 `topic_best`/`topic_best_weekly`/`global_score`에 아무것도 남지 않는다** — 이 프로젝트에서 가장 중요한 경계선이라 직접 DB를 조회해 확인한다
- 랭킹 응답에 다른 사람의 `uid`가 들어가지 않는다
- 익명 유저는 보드에 오르지 않는다

## 테스트가 즉시 잡아낸 실제 버그

첫 실행에서 `isCorrect`의 채점 구멍이 나왔다.

```ts
if (type === 'NUMERIC_INPUT') {
  const gn = Number(given.trim());   // Number('') === 0  ← 여기
```

`Number('')`는 `NaN`이 아니라 `0`이다. 호출부(`worker/index.ts`)에 `given !== ''` 가드가 있었지만 그건 **원본 문자열만** 본다. 그래서 **공백 한 칸(`' '`)을 제출하면** 가드를 통과한 뒤 `isCorrect` 안에서 `trim()`되어 `''`이 되고, 정답이 `0`인 숫자 문항에서 정답 처리됐다.

`isCorrect` 안에서 `g === ''`이면 유형과 무관하게 오답으로 처리하도록 고쳤다. 회귀 테스트를 남겼다.

지금 공식 문항 중 정답이 `0`인 것은 없어서 실제 피해는 없었지만, 창작마당은 누구나 숫자 문항을 만들 수 있으므로 시간 문제였다.

## 그 밖의 변경
- `package.json`에 `typecheck` / `test` / `test:watch` 스크립트 추가.
- `test/tsconfig.json`을 루트 tsconfig 프로젝트 참조에 추가 — 테스트도 `npx tsc -b` 대상이다.
- 순수 로직 함수 export: `difficultyForStage`, `isCorrect`, `normalizeText`(worker/index.ts), `validateQuestion`(worker/community.ts). 동작 변경은 없다.
- README를 실제 프로젝트 설명으로 교체(권한 확인용 임시 문구였다).

## 검증
- `npx tsc -b` 통과 (프론트 + 워커 + 테스트 3개 프로젝트)
- `npm test` — 70개 전부 통과
- `npm run build` + `npx wrangler deploy --dry-run` 통과
- 빈 D1에 `schema.sql` → `migrations` → `seed` 전체 적용 통과
- 사용자 데이터(users/runs/topic_best/topic_best_weekly)를 심은 뒤 배포 재현 — 전부 보존됨

## 남은 일 (다음 층)
아직 안 한 것들. 우선순위 순:

1. **`db/schema.sql` 드리프트 해소** — 베이스라인 파일의 `questions` 정의가 실제와 다르다(`TEXT_INPUT`, `author_uid`, `image_url` 없음). 진짜 스키마를 알려면 마이그레이션 2개를 순서대로 읽어야 한다. 지금 깨진 건 아니지만 진실의 출처가 둘로 갈라져 있다.
2. **세션 토큰 서명화** — 세션 쿠키 값이 곧 `users.uid`(PK)다. 서명도 만료도 폐기 수단도 없는 베어러 토큰이라, uid가 한 번 새면 계정이 영구히 탈취된다. 사용자가 적은 지금이 교체 비용이 가장 싸다.
3. **어뷰징 방어** — `/api/session`은 쿠키 없이 부를 때마다 `users` 행을 무제한 만든다. 창작마당 주제·문항 생성도 개수 제한이 없다. 레이트리밋이 한 곳도 없다.
4. **에러 로깅/관측** — 지금은 사용자가 말해줘야 장애를 안다.
