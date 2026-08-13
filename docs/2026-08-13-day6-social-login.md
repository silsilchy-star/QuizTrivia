# Day 6 — 소셜 로그인 + 계정 승계 + 닉네임

## 완료 판정 (PLAN 8장)
> "구글로 로그인해 익명 기록을 승계할 수 있다"

**충족.** Arctic 기반 구글 OAuth 시작/콜백, 계정 승계(PLAN 5.4절), 닉네임 설정까지 로컬 `wrangler dev`에서 전부 동작 확인. 랭킹 보드는 처음부터 별도 작업으로 분리(PLAN 8장 스케줄과 무관하게 이번 커밋 범위 밖).

## 라이브러리 선택 — Arctic
자체 OAuth 구현 vs Arctic을 관리 관점/유저 관점으로 비교한 뒤 Arctic으로 결정. Arctic은 OAuth 프로토콜 배관(인증 URL 생성 + state/PKCE, 토큰 교환)만 대신하고, 계정 승계 같은 우리 스키마 고유의 로직은 어차피 직접 짜야 한다 — `worker/auth.ts`의 분리가 그 경계를 그대로 반영한다. Cloudflare Workers의 Web Crypto(`crypto.getRandomValues`)만 쓰므로 `nodejs_compat` 없이 그대로 동작.

## 무엇을 만들었나

### `worker/auth.ts` (신규)
- `handleAuthGoogleStart` — state/PKCE 생성, 익명 uid를 `oauth` 쿠키(HttpOnly, 10분)에 실어 구글 인증 URL로 302
- `handleAuthGoogleCallback` — state 검증 → 토큰 교환 → `userinfo` 조회 → 계정 승계 분기:
  - 이 구글 계정(`google_sub`)이 **다른 uid에 이미 연결**되어 있으면 그 uid로 전환 (`outcome=switched`) — PLAN 5.4절 MVP 결정 "기존 계정 기록 유지 · 익명 기록 폐기", 지금 세션의 익명 uid는 별도 삭제 없이 그냥 버려짐
  - 아니면 지금 uid에 `google_sub`/`email`을 연결하고 `is_anonymous=0` (`outcome=linked`)
  - 최종 uid로 `session` 쿠키를 다시 세팅하고 `/?auth={outcome}`으로 리다이렉트
- `handleSetNickname` — 1–20자 트림 검증 후 `users.nickname` 갱신

### `worker/index.ts`
- `Env`에 `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` 추가
- `GET /api/auth/google`, `GET /api/auth/google/callback`, `POST /api/nickname` 라우트 추가
- `handleSession`이 `users.is_anonymous`/`nickname`도 함께 내려주도록 확장

### `db/schema.sql`
`users`에 `google_sub TEXT UNIQUE`, `email TEXT` 추가. FK 제약 때문에 `runs`/`topic_best`/`topic_best_weekly`를 먼저 지우고 `users`를 지운 뒤 원래 순서로 재생성하도록 DROP 순서를 고쳤다 (처음엔 `users`만 지우려다 `SQLITE_CONSTRAINT_FOREIGNKEY`로 실패). Day 5와 같은 이유로 지금은 안전 — 진짜 사용자 생기면 `ALTER TABLE`로 전환.

### 프론트엔드
- `src/types.ts` — `SessionResponse`에 `isAnonymous`/`nickname` 추가
- `src/api.ts` — `goToGoogleLogin()`(최상위 리다이렉트), `setNickname()` 추가
- `src/App.tsx` — 헤더에 `AuthStatus`(익명이면 "구글로 랭킹 등록" 버튼, 로그인 후 닉네임 없으면 입력 폼, 있으면 "{닉네임}님" 버튼으로 재편집), `?auth=` 쿼리를 한 번만 읽어 배너로 보여주고 URL 정리, 최종 결과 화면에 익명이면 "구글로 로그인" 유도 문구

## 검증

로컬 `wrangler dev` + curl:

| # | 케이스 | 결과 |
|---|---|---|
| 1 | `POST /api/session` 첫 방문 | `{uid, isAnonymous:true, nickname:null}` ✅ |
| 2 | 세션 쿠키 없이 `GET /api/auth/google` | 401 `no session` ✅ |
| 3 | 세션 있는 상태로 `GET /api/auth/google` | 302 → 정상 구글 인증 URL(`client_id`/`redirect_uri`/`state`/`code_challenge`/`code_challenge_method=S256`/`scope=openid+email`) + `oauth` 쿠키 ✅ |
| 4 | 콜백에 쿼리 없이 접근 | 302 `/?auth=error&reason=missing_params`, oauth 쿠키 삭제 ✅ |
| 5 | 콜백에 `state` 불일치(진짜 oauth 쿠키 지참) | 302 `/?auth=error&reason=state_mismatch` ✅ |
| 6 | `POST /api/nickname` 정상 닉네임 | `{nickname:"테스트닉"}`, 이후 세션 조회에도 반영(익명 상태 유지) ✅ |
| 7 | `POST /api/nickname` 공백뿐인 값 | 400 `nickname must be 1-20 characters` ✅ |

브라우저(Playwright)로도 확인: 새 세션에서 헤더 버튼이 "구글로 랭킹 등록"으로 보임, `/?auth=switched`로 진입 시 알림 배너에 정확한 한국어 문구가 뜨고 URL이 `history.replaceState`로 정리됨. 검증용 playwright는 다시 devDependency에서 제거.

실제 구글 로그인 전체 흐름(진짜 계정으로 로그인 → 콜백 → 프로필 조회)은 curl로 재현 불가 — 실제 브라우저 클릭과 진짜 구글 OAuth 클라이언트 자격 증명이 필요하다. 지금 `.dev.vars`는 URL 생성/에러 경로 테스트용 더미 값만 들어있음.

## 배포 파이프라인
`.github/workflows/deploy.yml`에 `wrangler secret put GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` 단계 추가 (GitHub 저장소 시크릿에서 값을 받아 Worker 시크릿으로 주입). **이 두 시크릿은 아직 GitHub에 등록되지 않았다** — 사용자가 직접 추가해야 함.

## 남은 일
- **사용자 액션 필요**: Google Cloud Console에서 OAuth 2.0 클라이언트 ID(웹 애플리케이션) 생성, 승인된 리디렉션 URI를 `https://quiztrivia.silsilchy.workers.dev/api/auth/google/callback`으로 등록. 발급된 클라이언트 ID/시크릿을 GitHub 저장소 시크릿 `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`로 추가 (Cloudflare API 토큰 때와 동일한 방식 — 나에게 직접 붙여넣지 않기).
- 실제 배포 후 진짜 계정으로 브라우저 클릭스루 검증은 아직 못함.
- 랭킹 보드(통합 2개 보드 + 주제별 표시 + `ranking_cache`, PLAN 5.2·5.3절)는 별도 작업으로 분리 — 아직 시작 안 함.
- 정답률(`question_stats`) 기반 난이도 재점검은 여전히 보류.
