# QuizTrivia

랭킹 기반 다주제 학습 퀴즈 게임. 주제를 골라 12스테이지를 오르고, 여러 주제를 폭넓게 잘할수록 통합 랭킹에서 유리하다.

**프로덕션**: https://quiztrivia.silsilchy.workers.dev

## 구성

| 계층 | 선택 |
|---|---|
| 프론트 | React 19 + TypeScript + Vite |
| 백엔드 | Cloudflare Workers (`worker/`) |
| DB | Cloudflare D1 (SQLite), 바인딩 `DB` |
| 정적 파일 | Workers Static Assets (`dist/`를 같은 Worker가 서빙) |
| 인증 | 익명 uid 발급 + Google OAuth(Arctic)로 계정 승계 |
| 테스트 | Vitest + `@cloudflare/vitest-pool-workers` (실제 Workers 런타임 + 실제 D1) |

## 시작하기

```bash
npm install
npm run db:local      # 로컬 D1에 schema + migrations + seed 적용
npm run worker:dev    # 로컬 D1 포함 풀스택 (wrangler dev)
```

## 명령어

```bash
npm run dev          # 프론트만 (vite, API 없음)
npm run worker:dev   # wrangler dev — 로컬 D1 포함 풀스택
npm run db:local     # 로컬 D1에 schema + migrations + seed 전부 적용

npm test             # 테스트 (실제 Workers 런타임 + D1)
npm run test:watch   # 워치 모드
npm run typecheck    # 프론트 + 워커 + 테스트 전체 타입체크

npm run validate     # data/*.json 자동 검증 (에러면 배포도 막힌다)
npm run build:seed   # data/*.json → db/seed.generated.sql (gitignore됨)
npm run review       # 로컬 문항 검수 웹페이지
```

## 배포

`main`에 push하면 `.github/workflows/deploy.yml`이 프로덕션에 배포한다. 순서는 **검증이 전부 먼저, DB 변경은 그 다음**이다:

```
typecheck → test → validate → seed 생성 → 프론트 빌드 → 워커 dry-run 번들
  → D1 백업 export (아티팩트 30일 보관)
  → D1 schema → migrations → seed
  → Worker 배포
```

모든 브랜치와 PR에서는 `.github/workflows/ci.yml`이 검증 부분만 돌린다.

## 스키마를 바꿔야 할 때

**`db/schema.sql`에는 절대 `DROP TABLE`을 쓰지 않는다.** 이 파일은 배포마다 재실행되는 멱등 베이스라인이라, 여기 있던 DROP이 실사용자 데이터를 여러 번 지운 사고가 있었다 (`docs/2026-08-13-critical-schema-drop-fix.md`).

스키마 변경은 `migrations/`에 새 파일로 추가한다:

```bash
npx wrangler d1 migrations create quiztrivia <설명>
npx wrangler d1 migrations apply quiztrivia --local   # 로컬에서 먼저 검증
```

`CHECK` 제약을 넓혀야 하면(예: enum 값 추가) `ALTER TABLE`로는 안 되고 테이블 재생성이 필요하다. D1은 참조당하는 테이블의 DROP을 막으므로, **자식 테이블의 FK 선언을 먼저 없앤 뒤에야** 대상 테이블을 재생성할 수 있다 — `migrations/0002_add_text_input_and_images.sql`에 실제 절차가 있다.

## 문서

- `docs/*.md` — 커밋 단위 작업 기록. 특정 결정의 배경이 궁금하면 여기부터.
- `인수인계.md` — 다른 세션에서 이어받을 때 읽는 현황 요약.
- `PLAN.md` — 설계 원안(v1.5). 갱신하지 않으므로 **"왜 이렇게 설계했는지"를 볼 때만** 참고하고, "지금 뭐가 실제로 있는지"는 코드와 `인수인계.md`를 기준으로 판단한다.
