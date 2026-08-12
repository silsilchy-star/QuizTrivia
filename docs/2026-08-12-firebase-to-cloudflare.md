# Firebase → Cloudflare 전환 (Day 1 재작업)

## 배경
사용자 지시: Firebase는 가능성만 열어두고 지금은 쓰지 않는다. 백엔드는 Cloudflare(Workers + D1)로 진행.

## 문서 변경 (PLAN.md → v1.5)
- 1.2절: 백엔드를 Cloudflare로 재확정. Firebase는 EP-5 뒤에 격리된 "가능성"으로만 남김
- 7.1~7.2절: 구성 요소 표 갱신, Firestore 문서 모델 → D1 관계형 스키마(SQL DDL)로 재작성
  - `topic_best`(주제별 최고점), `question_topics`(문항-주제 다대다) 등 조인 테이블 도입
- 7.4절: Cloudflare 전환 경로 → 실시간 확장 경로(Durable Objects)로 재정의 (이미 Cloudflare라 "전환"이 아님)
- 7.5절: 부정행위 대응 추천안 **B→A로 변경**. Cloudflare Workers는 API가 항상 서버를 거치므로 카드 등록 없이도 서버 채점(A안)이 가능해짐 — v1.4가 B를 택한 이유(Firebase Blaze 요금제 필요) 자체가 사라짐
- 11장 Q3: A안 동의로 추천 변경 / Q5 → **Q5'**: 소셜 로그인 "제공자"만이 아니라 "연결 방식"(자체 OAuth vs 인증 라이브러리)도 미결정에 추가 — Firebase Auth의 `linkWithCredential` 같은 기성 기능이 없기 때문
- 부록 A: v1.5 변경 이력 추가

## 코드 변경
- 제거: `src/firebase.ts`, `.env.example`, `firebase` npm 패키지
- 추가: `worker/index.ts` — Cloudflare Worker. `/api/session`(POST)이 쿠키 기반 익명 uid를 발급/재사용하고, 그 외 요청은 `env.ASSETS`로 정적 파일 서빙
  - uid는 쿠키(`HttpOnly`)로만 신뢰하고 클라이언트가 보내는 값은 쓰지 않음 — 7.5절 A안(서버 채점) 방향과 일치
- 추가: `db/schema.sql` — Day 1 범위인 `users` 테이블만. 전체 스키마는 Day 2~3에 추가
- 추가: `wrangler.jsonc` — Workers Static Assets(`./dist`) + D1 바인딩(`DB`, id는 placeholder)
- 추가: `worker/tsconfig.json` — `@cloudflare/workers-types` 참조, 루트 `tsconfig.json`에 레퍼런스 등록
- 변경: `src/App.tsx` — Firebase Auth 대신 `fetch('/api/session')`로 uid 받아 표시

## 확인함
- `npx tsc -b` 타입체크 통과 (frontend + worker 동시)
- `npm run build` 빌드 성공
- `wrangler d1 execute --local`로 로컬 D1에 스키마 적용
- `wrangler dev` 로컬 구동 후:
  - 첫 `POST /api/session` → 새 uid 발급 + `Set-Cookie`
  - 쿠키 포함 재요청 → **같은 uid 반환** (세션 유지 확인)
  - `GET /` → 200 (정적 페이지 서빙 확인)

## Day 1 완료 판정
"화면에 내 uid가 뜬다" — **로컬에서 확인 완료.** 실제 배포는 Cloudflare D1 데이터베이스를 실제로 생성(`wrangler d1 create`)하고 `wrangler.jsonc`의 placeholder id를 교체한 뒤 진행 (이전 KV 네임스페이스 생성 때와 같은 방식으로, GitHub Actions에서 이미 등록된 토큰으로 처리 가능).

## 남은 일
1. 실제 D1 데이터베이스 생성 + `wrangler.jsonc`의 `database_id` 교체
2. GitHub Actions 배포 워크플로 추가 (Cloudflare 배포 이력 참고)
3. Cloudflare 요금제 페이지에서 Workers/D1 무료 한도 확인 (PLAN.md 7.6절 할 일)
4. Day 2 착수 — 수직 슬라이스 (주제 1개 + 문제 10개를 D1에 넣고 1판 플레이)
