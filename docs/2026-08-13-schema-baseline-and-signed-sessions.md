# 스키마 베이스라인 통합 + 세션 쿠키 서명

토대 다지기 3단계. 앞선 작업(`282f18a`)에서 배포 안전장치와 테스트 골조를 세웠고, 여기서는 그 위에 남아있던 두 개의 구조적 구멍을 메웠다.

## ① db/schema.sql 드리프트 해소

### 무엇이 문제였나
`db/schema.sql`은 옛 모습을 담고 있었다 — `questions.type`의 CHECK에 `TEXT_INPUT`이 없고, `author_uid`·`image_url` 컬럼도 없었다. 진짜 스키마를 알려면 `migrations/0001`, `0002`를 순서대로 읽어 머릿속에서 합쳐야 했다.

지금 당장 깨진 건 아니었지만(빈 DB에 순서대로 적용하면 올바른 결과가 나온다), **진실의 출처가 둘로 갈라진** 상태였다. 마이그레이션이 쌓일수록 아무도 스키마를 모르게 된다.

### 무엇을 했나
`schema.sql`을 실제 스키마와 일치하도록 다시 썼다. 흡수된 마이그레이션 0001·0002는 `db/migrations-archive/`로 옮겼다(기록 보존).

### 왜 안전했나 — 실제로 확인한 것

1. **이미 돌아가는 DB(프로덕션)에는 아무 영향이 없다.** `schema.sql`은 전부 `CREATE TABLE IF NOT EXISTS`라, 테이블이 이미 있으면 한 줄도 실행되지 않는다. 즉 이 파일의 내용을 바꿔도 실행 중인 DB는 바뀌지 않는다.

2. **마이그레이션 파일을 치워도 wrangler가 문제 삼지 않는다.** 로컬에서 직접 확인했다 — `d1_migrations`에 0001·0002가 기록된 상태에서 파일만 없애고 `migrations apply`를 돌리니 `✅ No migrations to apply!`로 넘어갔다. 프로덕션도 같은 상태다.

3. **빈 DB에서 새 `schema.sql` 하나로 올바른 결과가 나온다.** 로컬 D1을 완전히 지우고 `npm run db:local`(schema → migrations → seed)을 돌려 주제 20개·문항 264개·연결 504개·active 3개, `questions.type`에 `TEXT_INPUT` 포함까지 확인했다.

### 다시 갈라지지 않게
`test/schema.test.ts`를 추가했다. `test/setup.ts`가 매번 빈 D1에 `schema.sql` → `migrations/`를 프로덕션과 같은 순서로 적용하고, 이 테스트가 결과 스키마를 검증한다 — 테이블·인덱스·컬럼 존재, CHECK 제약(세 문제 유형, `source` enum, 난이도 1~4), 그리고 `question_topics`/`question_stats`에 `questions(id)` FK가 **없어야** 한다는 것까지(있으면 questions 재생성 마이그레이션이 불가능해진다).

### 규칙 정리
- **새 테이블·새 인덱스**는 `schema.sql`에 추가해도 된다 — `IF NOT EXISTS`가 실제로 만들어준다.
- **기존 테이블의 컬럼·제약 변경**만 `migrations/`가 필요하다 — `schema.sql`의 `CREATE TABLE`은 그런 DB에서 실행되지 않기 때문이다.
- `DROP TABLE`은 여전히 금지.

## ② 세션 쿠키 서명 (worker/session.ts, 신규)

### 무엇이 문제였나
세션 쿠키 값이 곧 `users.uid`(PK)였다.

```ts
const uid = getCookie(request, SESSION_COOKIE);
const row = await env.DB.prepare('SELECT uid FROM users WHERE uid = ?').bind(uid).first();
```

서명도, 만료도, 폐기 수단도 없는 순수 베어러 토큰이다. uid가 한 번 새어나가면 그 계정은 **영구히** 탈취되고 막을 방법이 없다. uid는 UUIDv4라 추측은 어렵지만, `/api/session` 응답 본문에 그대로 실려 클라이언트로 내려가고 있었다.

### 무엇을 했나
토큰 형식: `v1.<uid>.<발급시각(초)>.<HMAC-SHA256 서명>`

- 서명 검증은 `crypto.subtle.verify`로 한다 — 상수 시간 비교라 타이밍 공격에 안전하다.
- **발급 시각을 토큰 안에 넣어 서버가 만료를 강제한다.** 예전엔 쿠키의 `Max-Age`만 있었고 그건 클라이언트가 무시할 수 있다.
- 수명이 절반 아래로 내려가면 `/api/session`에서 갱신해준다(슬라이딩 윈도우).
- **`/api/session` 응답에서 `uid`를 제거했다.** 화면 코드가 `isAnonymous`와 `nickname`만 쓰고 uid는 한 번도 안 썼다 — 클라이언트가 uid를 알 이유가 없다.

### 기존 사용자를 잃지 않는 전환
서명을 켜는 순간 기존 쿠키가 전부 무효가 되면, 사용자들은 로그아웃되고 익명 플레이 기록을 통째로 잃는다. 그래서 **서명 없는 uuid 쿠키를 당분간 계속 받아주고**, `/api/session`이 접속할 때마다 서명된 쿠키로 갈아끼운다. 활동 중인 사용자는 다음 방문에 자연히 넘어간다.

⚠ 이 경로(`ACCEPT_LEGACY`)가 살아있는 동안은 서명의 보안 효과가 없다. 대부분 넘어간 뒤 `worker/session.ts`의 `ACCEPT_LEGACY`를 `false`로 내려서 닫아야 한다.

### 함께 발견해 고친 계정 탈취 경로
서명을 붙이다 보니 OAuth 쪽에 같은 계열의 구멍이 있었다.

`handleAuthGoogleStart`가 **서명되지 않은** oauth 쿠키에 uid를 담고, 콜백이 `saved.uid`를 그대로 믿었다:

```ts
const payload = encodeURIComponent(JSON.stringify({ state, codeVerifier, uid }));
// ... 콜백에서
await env.DB.prepare('UPDATE users SET google_sub = ?, is_anonymous = 0 WHERE uid = ?')
  .bind(profile.sub, saved.uid)
```

즉 **남의 uid를 oauth 쿠키에 적어 넣고 자기 구글 계정으로 로그인하면, 그 계정에 자기 `google_sub`가 연결되고 세션까지 넘어왔다** — 완전한 계정 탈취다. state 검증은 이걸 못 막는다(공격자가 양쪽을 다 정한다).

oauth 쿠키에서 uid를 빼고, 승계 대상 uid를 **서명된 세션 쿠키에서만** 읽도록 고쳤다. 세션 쿠키 서명이 없었으면 이 수정도 반쪽이었을 것이다.

### 비밀키가 없어도 배포가 깨지지 않게
`SESSION_SECRET`이 없으면 서명 없이(옛 방식으로) 동작한다. 배포 워크플로도 시크릿이 설정된 경우에만 주입한다. **비밀키를 설정해야 실제로 서명이 켜진다.**

## 테스트
`test/session.test.ts` 신규 (전체 101개 → 이 중 20개).

핵심 성질:
- 다른 비밀키로 만든 토큰, 서명을 고친 토큰, **uid만 바꿔치기한 토큰**, 발급 시각을 앞당긴 토큰을 전부 거부한다
- 유효기간을 넘긴 토큰과 미래에 발급된 토큰을 거부한다
- 실제로 존재하는 유저의 uid를 쿠키에 넣어도 401
- 옛 uid 쿠키로 접속하면 **같은 계정을 가리키는** 서명된 쿠키로 갈아끼워준다(기록이 끊기지 않는다)
- 세션 응답에 uid가 들어있지 않다

## 검증
- `npx tsc -b` 통과
- `npm test` — 101개 전부 통과
- 로컬 D1을 완전히 지우고 새 `schema.sql`만으로 재구성 → 테스트 통과
- `npm run db:local` 전체 경로 통과 (주제 20 / 문항 264 / 연결 504 / active 3)

## 사용자가 해야 하는 것
**GitHub 저장소에 `SESSION_SECRET` 시크릿을 추가해야 서명이 켜진다.**
`Settings → Secrets and variables → Actions → New repository secret`
- 이름: `SESSION_SECRET`
- 값: 충분히 긴 무작위 문자열 (예: `openssl rand -base64 48`)

⚠ 한번 정하면 바꾸지 않는다 — 바꾸면 모든 세션이 무효가 되어 전원 로그아웃된다.

## 남은 일
- `ACCEPT_LEGACY` 닫기 (전환 기간 후)
- 어뷰징 방어 — `/api/session`은 여전히 무제한으로 users 행을 만들 수 있고, 창작마당 생성에도 개수 제한이 없다
- 에러 로깅/관측
