# D1 프로비저닝 + Cloudflare 배포 파이프라인

## 한 일
- Cloudflare D1 데이터베이스 `quiztrivia` 생성 (region ENAM)
  - `database_id`: `8cf78168-de6b-40d2-9204-62b32e1144d9`
- `wrangler.jsonc`의 placeholder를 실제 database_id로 교체
- `.github/workflows/deploy.yml` 추가 — push 시 자동 배포
  1. `npm ci`
  2. `wrangler d1 execute --remote --file=db/schema.sql` (원격 D1에 스키마 적용)
  3. `npm run build` (Vite)
  4. `wrangler deploy`
- 일회성 `d1-setup.yml` 워크플로 제거

## 삽질 기록 — D1 생성까지 4번 걸렸음

| 시도 | 결과 | 원인 | 조치 |
|---|---|---|---|
| 1 | 실패 | `cloudflare/wrangler-action@v3`가 자체적으로 wrangler 3.90.0을 설치 → 프로젝트의 `@cloudflare/workers-types@5`와 peer 의존성 충돌(ERESOLVE) | action 대신 `npm ci` + `npx wrangler` 직접 호출로 변경 |
| 2 | 실패 | Cloudflare API 토큰에 **D1 권한 없음** (`/accounts/*/d1/database` → `Authentication error [code: 10000]`). 토큰 자체는 유효(계정·이메일 조회됨), KV는 이전에 성공했으므로 D1 스코프만 누락 | 워크플로에 토큰 권한 진단(probe) 단계 추가 |
| 3 | 실패 | 사용자가 권한 추가하기 **전**에 실행됨 | 권한 추가 후 재실행 |
| 4 | **성공** | — | — |

## 배운 것
- **`wrangler-action`은 프로젝트가 이미 wrangler를 의존성으로 갖고 있으면 오히려 방해가 된다.** action이 자기 버전을 설치하려 하면서 peer 충돌을 만든다. 프로젝트 wrangler를 쓰는 게 더 안전하고, 버전도 `package-lock.json`에 고정된다.
- **"Edit Cloudflare Workers" 토큰 템플릿에 D1 권한이 포함되지 않을 수 있다.** Workers/KV는 되는데 D1만 막히는 형태로 나타나며, 에러 메시지가 `Authentication error`라서 "토큰이 잘못됐나?"로 오해하기 쉽다. 실제로는 토큰은 유효하고 스코프만 부족한 것.
- **환경의 `GITHUB_TOKEN`은 GitHub REST API에 쓸 수 없다** (Bad credentials). 워크플로 상태 확인은 MCP GitHub 도구를 써야 하고, 인증 없는 `api.github.com` 직접 호출은 rate limit에 걸린다 — 이 때문에 백그라운드 폴링 루프가 조용히 헛돌았다. **폴링 대신 MCP 도구로 직접 조회할 것.**

## 관련 커밋
- `a6d1ce8` Use project wrangler instead of wrangler-action to avoid peer dep conflict
- `ed48448` Probe Cloudflare token scopes before creating D1 database
- `d029f3c` Wire up real D1 database and add Cloudflare deploy workflow

## 배포 검증 (원격)
- `GET /` → 200 (Vite 빌드 결과 서빙)
- `POST /api/session` → 새 uid 발급 + `Set-Cookie`
- 쿠키 포함 재요청 → **같은 uid 반환** (원격 D1에 실제로 행이 남아 세션 유지됨)

배포 URL: https://quiztrivia.silsilchy.workers.dev

**Day 1 완료 판정 충족** — "화면에 내 uid가 뜬다"가 로컬·원격 모두에서 확인됨.
