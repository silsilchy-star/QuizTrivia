# 랭킹 보드 — 통합 2개 + 주제별 순위

## 완료 판정 (PLAN 8장, Day 6 스케줄의 나머지 절반)
> "로그인해도 기록이 살아있고 랭킹에 뜬다"

**충족.** 실제 판을 12스테이지까지 플레이해 만점(1500점)을 낸 뒤 `global_all_time`/`global_weekly`/주제별 순위 세 endpoint 모두에서 정상 반영을 확인했다.

## 설계 결정

### "랭킹 등록은 로그인해야만" — 별도 플래그 없이 구현
PLAN 5.4절 다이어그램은 "[랭킹 등록?] → 로그인 필요 → 반영"이지만, `topic_best`/`topic_best_weekly`는 Day 5부터 익명 uid에도 이미 쌓이고 있었다. 새 플래그를 추가하는 대신 **모든 랭킹 쿼리를 `users.is_anonymous = 0`으로 필터링**했다:
- 익명 상태에서 쌓은 기록은 그대로 DB에 있지만 랭킹에는 안 뜬다
- 구글로 로그인(계정 승계)하는 순간 같은 uid의 `is_anonymous`가 0으로 바뀌므로, **별도 반영 로직 없이 기존 기록이 즉시 랭킹에 나타난다** — "승계"가 계정 연결 그 자체로 완성됨

### 캐시 갱신 — 주기(Q6 "5분") 대신 쓰기 시점 트리거
PLAN 11장 Q6는 "5분 주기" 추천이었지만, Cron Trigger를 새로 놓는 대신 **`finalizeRun`에서 실제로 최고점이 갱신된 판에서만** `ranking_cache`를 다시 계산하도록 했다 (`worker/ranking.ts`의 `refreshGlobalCaches`). 이유:
- 갱신 안 된 판(연습 삼아 또 돌리거나 실패한 판)은 랭킹에 영향이 없으니 계산을 아예 안 함 → 5.3절이 우려한 읽기/쓰기 비용을 오히려 더 아낌
- 캐시가 항상 최신 상태 — "5분 지연"이라는 사용자 체감 지연이 없음
- 주제별 순위(`topic_{topicId}`)는 **아예 캐시하지 않고 매번 라이브 쿼리** — `topic_id` 인덱스로 이미 좁혀진 조회라 저렴하고(5.3절 근거 그대로), 30개 넘게 생길 주제별 캐시 행을 따로 관리할 필요가 없다

### 주간 보드 키
ISO 8601 주차(`2026-W33` 형식)로 `week_id`를 계산해 매주 자동으로 새 행에서 시작한다 (Q7 "포함" 그대로 반영).

### 정확한 등수 대신 커트라인
30위 밖 사용자에게는 PLAN 5.3절 그대로 "내 점수 + 30위 커트라인"만 보여주고 정확한 등수는 계산하지 않는다. 단, **주제별 순위는 정확한 등수를 보여준다** — `topic_best`가 그 주제 안에서만 조회되는 좁은 인덱스라 `COUNT(*) WHERE score > ?` 한 번이면 되므로 30위 밖이어도 비용이 낮다.

## 무엇을 만들었나

### `worker/ranking.ts` (신규)
- `isoWeekId(date)` — ISO 8601 주차 계산
- `upsertWeeklyBest(env, uid, topicId, score, now)` — 이번 주 주제별 최고점 갱신, 갱신 여부 반환
- `refreshGlobalCaches(env, now)` — `global_all_time`/`global_weekly` 두 보드의 상위 30 + 커트라인을 `ranking_cache`에 다시 씀
- `handleGlobalRanking(env, boardId, viewerUid)` — 캐시에서 읽고, 요청자 uid와 비교해 `isMe`만 붙여 응답(다른 사용자의 uid는 클라이언트에 노출하지 않음)
- `handleTopicRanking(env, topicId, viewerUid)` — 라이브 쿼리, 상위 30 + 내 순위(등록 사용자만)

### `worker/index.ts`
- `finalizeRun`에서 `upsertWeeklyBest` 호출 후, 전체 최고점 또는 주간 최고점이 갱신됐을 때만 `refreshGlobalCaches` 호출
- 라우트 추가: `GET /api/rankings/global_all_time`, `GET /api/rankings/global_weekly`, `GET /api/rankings/topic/:topicId` (셋 다 로그인 불필요 — 익명도 남의 랭킹은 볼 수 있음)

### 프론트엔드
- `src/types.ts` — `RankingEntry`/`RankingBoardResponse`/`TopicRankingResponse`/`GlobalBoardId`
- `src/api.ts` — `getGlobalRanking(boardId)`, `getTopicRanking(topicId)`
- `src/App.tsx`
  - 헤더에 `주제`/`랭킹` 네비게이션 추가
  - `Ranking` 컴포넌트 — 전체 기간/이번 주 탭, 상위 30 리스트, 내 항목 강조, 30위 밖이면 "내 점수 · 커트라인" 표시, 비로그인이면 로그인 유도 문구
  - `Final` 컴포넌트 — 판이 끝나면 그 주제 순위를 라이브로 fetch해 "이 주제 순위 N위" 표시

## 검증

로컬 `wrangler dev` + 로컬 D1을 직접 조작해 테스트 계정을 "로그인 상태"(`is_anonymous=0`, 닉네임 지정)로 만든 뒤, 실제 API로 과학 주제 12스테이지를 전부 정답 제출해 만점(1500점)을 냈다.

| # | 케이스 | 결과 |
|---|---|---|
| 1 | 만점 판 종료 직후 `GET /api/rankings/global_all_time` | 1위, 1500점, `isMe:true` ✅ |
| 2 | 같은 시점 `GET /api/rankings/global_weekly` | 1위, 1500점 — 주간 보드도 같은 판에서 동시 갱신 ✅ |
| 3 | `GET /api/rankings/topic/science` | 1위, `me.rank:1` ✅ |
| 4 | 별도의 새 익명 세션으로 `GET /api/rankings/global_all_time` 조회 | 다른 사람 항목은 보이되(`isMe:false`) `me:null` — 익명은 랭킹 집계 대상이 아님 ✅ |
| 5 | 브라우저(Playwright) — 헤더 "테스터1님" 확인 후 랭킹 탭 진입 | 전체 기간/이번 주 두 탭 모두 "1 · 테스터1 · 1500점" 정상 렌더 ✅ |
| 6 | 브라우저 — 같은 계정으로 판을 하나 더(실패로) 플레이해 최종 결과 화면 확인 | "이 주제 최고 1500점 · 통합 1500점 · 이 주제 순위 1위" 정상 표시 ✅ |

검증용 playwright는 다시 devDependency에서 제거.

## 남은 일
- 아직 사람이 여러 명이 아니라 테스트 계정 하나로만 검증했다 — 실제 복수 사용자로 30위 커트라인 표시(케이스 5, 6 미검증: 30명 이상일 때)는 추후 실사용자 데이터가 쌓이면 자연히 검증됨
- `ranking_cache`에 저장하는 닉네임은 갱신 시점 스냅샷이라, 캐시가 다시 계산되기 전까지는 그 사이 닉네임을 바꿔도 랭킹판엔 옛 닉네임이 잠깐 남을 수 있음 — MVP 수준에서 허용 가능한 지연으로 판단, 별도 대응 안 함
- Day 6에서 남겨둔 것과 동일: 구글 OAuth 자격 증명(GitHub 시크릿)은 아직 미등록 — 실제 로그인 없이는 진짜 여러 사용자로 랭킹이 채워지는 모습은 배포 후에나 확인 가능
