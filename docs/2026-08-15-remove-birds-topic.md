# "새 맞추기"(birds) 주제 제거

## 요청

> "새 맞추기에 집착하지 말고 새 문제 리스트 없애"
>
> (범위 확인 → "주제까지 완전 제거")

**충족.** 문항 24개와 주제 정의를 모두 없앴다.

## 배경

`birds`는 2026-08-13에 만들어진 뒤 계속 `draft`(비공개)였다. 활성화 하한은 난이도당 20문항인데 24/80(난이도당 6)에서 멈춰 있었고, 나머지 56문항을 어떻게 채울지가 세 세션에 걸쳐 미해결로 남아 있었다:

- Wikimedia 핫링크 방식 → 이 작업 환경에서 외부 이미지 호스트가 프록시 차단이라 에이전트가 URL을 검증할 수 없음
- R2 직접 업로드(Option C) → 사용자가 새 사진 56장을 직접 구해 올려야 함

이번에 사용자가 방향을 정리했다 — **이미지·영상 첨부 기능의 목적은 특정 주제를 완성하는 게 아니라 유저가 직접 문제를 만들 때의 확장성과 개방성**이라는 것. 그 구조는 `2026-08-15-media-links-youtube.md`에서 만들었고, birds는 그 목적에 필요하지 않으므로 정리했다.

부수 효과로 **공식 콘텐츠에서 외부 호스트 의존이 완전히 사라졌다.** birds 24문항이 유일한 이미지 문항이었고 전부 Wikimedia 핫링크였다.

## 무엇을 했나

### 데이터

- `data/questions/birds.json` 삭제 (24문항)
- `data/topics.json`에서 `birds` 주제 정의 제거 (20 → 19개)

### ⚠ JSON에서 빼는 것만으로는 프로덕션이 정리되지 않는다

`scripts/build-seed.mjs`는 **문항은 지우지만 주제는 안 지운다**:

```sql
-- 문항: JSON 승인 목록에 없으면 삭제 (공식 문항으로 범위를 좁혀서)
DELETE FROM questions WHERE author_uid IS NULL AND id NOT IN (...);

-- 주제: INSERT OR REPLACE만 한다 — 삭제 없음
INSERT OR REPLACE INTO topics (...) VALUES (...);
```

그래서 JSON에서 빼기만 하면 프로덕션에 **문항 0개짜리 birds 주제 행이 q_count 6,6,6,6인 채로 고아처럼 남는다.** `migrations/0002_remove_birds_topic.sql`로 명시적으로 지운다.

**build-seed에 "JSON에 없는 주제는 삭제" 규칙을 넣는 방법은 택하지 않았다.** 그 스크립트의 삭제 로직은 이미 한 번 유저 창작마당 문항을 전부 지울 뻔한 전력이 있고(인수인계 3번), 주제 삭제는 플레이 기록이 있는 주제에서 FK에 걸리는 문제까지 있다. 일회성 제거를 상시 규칙으로 만들 이유가 없다.

### 삭제 순서

`question_topics` · `runs` · `topic_best` · `topic_best_weekly`가 전부 `topics(id)`를 FK로 참조하므로 자식부터 지워야 한다 (`worker/community.ts`의 `handleDeleteCommunityTopic`과 같은 순서):

```
question_stats  →  questions  →  question_topics  →  runs / topic_best / topic_best_weekly  →  topics
```

문항 삭제는 두 겹으로 범위를 좁혔다:
- `author_uid IS NULL` — 공식 문항만 (커뮤니티 문항 보호)
- `id NOT IN (SELECT ... WHERE topic_id <> 'birds')` — birds에만 달린 문항만

실제로 birds 문항 24개는 전부 `topicIds: ["birds"]` 하나뿐이고 다른 파일이 `birds` 태그를 쓰지 않는 것을 먼저 확인했지만, 조건 자체가 안전하게 쓰여 있어야 나중에 이 SQL을 참고해 쓰는 사람이 다치지 않는다.

## 검증

인수인계 2번 규칙이 요구하는 두 가지를 다 통과시켰다.

**(a) 기존 데이터가 있는 DB** — `node:sqlite`로 birds가 살아있던 시점의 프로덕션을 재현해서 적용했다. 문항 24개 + 통계 + 플레이 기록 + 기록 보드까지 만들고, 지워지면 안 되는 대조군(과학 주제·문항, 커뮤니티 주제·문항, 유저)을 함께 넣었다.

| | 적용 전 | 적용 후 |
|---|---|---|
| birds 주제 / 문항 / 연결 | 1 / 24 / 24 | 0 / 0 / 0 |
| birds 통계 / 판 / 기록 | 24 / 1 / 1 | 0 / 0 / 0 |
| 과학 주제·문항·통계·판·기록 | 각 1 | **각 1 (그대로)** |
| 커뮤니티 주제·문항 | 각 1 | **각 1 (그대로)** |

`PRAGMA foreign_key_check` 위반 없음. 두 번 적용해도 no-op.

**(b) 완전히 빈 DB** — `npm test`가 매번 `schema.sql → migrations`를 순서대로 적용한다(`test/setup.ts`). birds가 없는 DB에서는 모든 DELETE가 no-op이다.

- `npm test` 230개 통과 (`test/schema.test.ts`의 seed 미적재 확인 쿼리에서 `birds` 제거)
- `npm run validate` · `npm run build:seed` · `npm run build` 통과
- `build-image-check.mjs`는 이미지 문항이 0개가 되어 "페이지를 만들지 않는다"로 정상 처리된다

## 되돌리려면

git 이력에 그대로 남아있다 — `data/questions/birds.json`을 `ebebeb5` 시점에서 복원하고 `data/topics.json`에 주제 정의를 되살리면 된다. 프로덕션 데이터도 배포 run의 `d1-backup-<sha>` 아티팩트에 30일간 보관된다(인수인계 16번).
