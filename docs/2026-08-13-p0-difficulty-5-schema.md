# P0: 배포 브랜치 정리 + 난이도 5단계(매니아) 스키마·코드 확장

2026-08-13. **로컬 커밋만 — 아직 push 안 함.** 이유는 아래 "배포 보류" 참고.

## 한 일

- `.github/workflows/deploy.yml` — 트리거에 현재 작업 브랜치
  `claude/handover-matters-review-gs5597` 추가(P0-a).
- `migrations/0003_add_difficulty_5.sql` — `questions.difficulty` CHECK를
  1~5로 확장(테이블 재생성). 0002가 이미 `question_topics`/`question_stats`의
  `questions(id)` FK를 없애둔 덕에 이번엔 `questions` 하나만 재생성하면
  됐다. `topics.q_count_5` 컬럼도 같이 추가.
- `src/types.ts` — `Difficulty = 1|2|3|4|5`, `Topic`/`CommunityTopic`의
  `questionCount`에 `'5'` 키 추가.
- `worker/index.ts` — `handleTopics()`의 SQL·매핑에 `q_count_5` 반영.
  ⚠ `difficultyForStage()`/`MAX_RUN_SCORE`/`TOTAL_STAGES`(구 스테이지 판
  전용)는 **의도적으로 손대지 않았다** — PLAN3에서 스테이지 판이 P2에
  완전 폐지되기로 확정됐으므로, 곧 삭제될 코드를 지금 고쳤다가 다시
  지우는 건 낭비다. 이 상수들은 여전히 난이도 1~4만 다루고, 그게 맞다.
- `worker/community.ts` — `validateQuestion` 난이도 범위, 게이트 판정
  루프, `UPDATE topics` 쿼리 전부 1~5로 확장.
- `scripts/validate.mjs`, `scripts/build-seed.mjs` — 난이도 범위·게이트
  판정·집계 출력 전부 1~5로 확장.
- `src/Workshop.tsx` — 난이도 선택 드롭다운에 "5. 매니아" 추가. 기존
  라벨("매우 쉬움/쉬움/보통/어려움")이 PLAN2가 정한 공식 명칭과 안
  맞아서 "쉬움/보통/어려움/전문가/매니아"로 통일했다(사소한 정정,
  직접 판단).
- `data/topics.json` — science/geography/sports/birds 4개 주제에
  `difficultySpec.5`(매니아 규칙+예시) 추가.

## 구현하며 바로잡은 것 2가지

1. **PLAN2가 "20개 주제 전부"라고 썼던 게 부정확했다.** 실제로
   `difficultySpec`은 broad 4개(과학/지리/스포츠/새맞추기)에만 있고,
   narrow 16개는 자기 것 없이 부모를 참조하는 구조였다. 4개만 고치면
   됐다.
2. **`db/schema.sql`에 `q_count_5`·CHECK 확장을 직접 넣었더니 로컬
   이중 검증에서 바로 충돌났다.** 빈 DB에 schema→전체 마이그레이션을
   순서대로 적용하는 테스트(house rule)에서 `ALTER TABLE ADD COLUMN
   q_count_5`가 "duplicate column"으로 실패했다 — schema.sql이 이미
   그 컬럼을 만들어놨기 때문. 기존 관례(0001·0002도 `schema.sql`을 안
   건드림)를 다시 확인하고 원복했다. `schema.sql`은 항상 "오래된 상태"로
   남고, 마이그레이션이 최종 상태를 완성한다.

## 로컬 검증 (인수인계.md 2번 교훈대로 둘 다 통과)

- (a) 기존 데이터 있는 DB — 커뮤니티 문항(`author_uid`·`image_url` 있음),
  `TEXT_INPUT` 타입, `question_topics` 연결까지 포함해 데이터 무손실
  확인. CHECK 제약도 정확히 동작(5는 허용, 6은 거부).
- (b) 빈 DB부터 `schema.sql`→마이그레이션 0001~0003 순서 적용 — 성공.
- `npx tsc -b`, `npm run build`, `npm run validate` 전부 통과.

## ⚠ 배포 보류 — 발견한 것

`validate.mjs`를 돌려보니, 게이트가 "난이도 1~5 전부 20개 이상"으로
바뀌면서 **과학·지리·스포츠가 즉시 `active`→`draft`로 떨어진다**(전부
난이도5가 0개라서). 이 브랜치는 push=배포이므로, 지금 push하면 P1
(난이도5 문항 60개)이 나오기 전까지 실사용자에게 공식 주제 3개가 전부
사라진다.

사용자에게 확인한 결과: **P1까지 끝내고 함께 push하기로 결정.** 지금은
로컬 커밋만 하고 push하지 않는다.

## 다음

P1 — 공식 3주제 난이도5 문항 60개(주제당 20개) + 새 맞추기 56개
보충(현재 24/80, 난이도당 14개씩 추가). 끝나면 이번 P0 커밋과 함께 push.
