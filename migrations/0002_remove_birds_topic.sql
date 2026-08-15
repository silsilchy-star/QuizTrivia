-- "새 맞추기"(birds) 주제와 그 문항 24개를 없앤다.
--
-- 왜 마이그레이션인가: `scripts/build-seed.mjs`는 topics를 INSERT OR REPLACE만
-- 하고 지우지는 않는다. 그래서 data/topics.json에서 빼는 것만으로는 프로덕션에
-- 주제 행이 고아로 남는다(문항은 지워지는데 q_count는 6,6,6,6인 채로).
-- 여기서 명시적으로 지운다.
--
-- build-seed에 "JSON에 없는 주제는 삭제" 규칙을 넣는 방법도 있었지만 택하지
-- 않았다. 그 스크립트의 삭제 로직은 이미 한 번 유저 창작마당 문항을 전부
-- 지울 뻔한 전력이 있고(인수인계.md 3번), 주제 삭제는 플레이 기록이 있는
-- 주제에서 FK에 걸리는 문제까지 있다. 일회성 제거를 상시 규칙으로 만들
-- 이유가 없다.
--
-- 삭제 순서가 중요하다 — question_topics · runs · topic_best ·
-- topic_best_weekly가 전부 topics(id)를 FK로 참조하므로, 자식을 먼저 지워야
-- 마지막 DELETE가 통과한다. (worker/community.ts의 handleDeleteCommunityTopic과
-- 같은 순서다.)
--
-- 이미 birds가 없는 DB(새로 만든 테스트 DB 등)에서는 전부 no-op이다.

-- 1) 통계 먼저 — question_stats는 questions(id)에 FK가 없어서 그냥 두면
--    참조 대상이 사라진 행이 남는다.
DELETE FROM question_stats
 WHERE question_id IN (
   SELECT question_id FROM question_topics WHERE topic_id = 'birds'
 );

-- 2) birds에만 달려 있는 공식 문항. 다른 주제에도 걸린 문항은 건드리지 않고,
--    author_uid IS NULL로 공식 문항에만 범위를 좁힌다(커뮤니티 문항 보호).
DELETE FROM questions
 WHERE author_uid IS NULL
   AND id IN (SELECT question_id FROM question_topics WHERE topic_id = 'birds')
   AND id NOT IN (SELECT question_id FROM question_topics WHERE topic_id <> 'birds');

-- 3) 주제-문항 연결
DELETE FROM question_topics WHERE topic_id = 'birds';

-- 4) 플레이 기록과 기록 보드
DELETE FROM runs WHERE topic_id = 'birds';
DELETE FROM topic_best WHERE topic_id = 'birds';
DELETE FROM topic_best_weekly WHERE topic_id = 'birds';

-- 5) 주제 자체. source 조건은 방어용 — 공식 주제만 지운다.
DELETE FROM topics WHERE id = 'birds' AND source = 'official';
