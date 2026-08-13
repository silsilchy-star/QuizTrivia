-- Migration number: 0002
--
-- 이미지 첨부 + 단답형(TEXT_INPUT) 문제 유형 추가. type의 CHECK 제약을
-- 넓혀야 해서(ALTER TABLE로는 불가능) questions 테이블을 재생성해야 한다.
--
-- ⚠ D1은 PRAGMA foreign_keys=OFF/defer_foreign_keys=ON을 줘도 "참조당하는
-- 테이블"을 DROP하는 걸 막는다(로컬 테스트로 확인). 그래서 순서를 뒤집는다 —
-- questions를 참조하는 자식 테이블(question_topics, question_stats)의
-- FK 선언을 먼저 없앤 뒤에야 questions를 안전하게 재생성할 수 있다.

-- 1) question_topics — question_id에 걸린 questions(id) FK를 없앤다
--    (topic_id → topics(id) FK는 그대로 유지).
CREATE TABLE question_topics_new (
  question_id TEXT NOT NULL,
  topic_id    TEXT NOT NULL REFERENCES topics(id),
  PRIMARY KEY (question_id, topic_id)
);
INSERT INTO question_topics_new SELECT question_id, topic_id FROM question_topics;
DROP TABLE question_topics;
ALTER TABLE question_topics_new RENAME TO question_topics;
CREATE INDEX IF NOT EXISTS idx_question_topics_topic ON question_topics(topic_id);

-- 2) question_stats — question_id의 questions(id) FK를 없앤다.
CREATE TABLE question_stats_new (
  question_id   TEXT PRIMARY KEY,
  served_count  INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL
);
INSERT INTO question_stats_new SELECT question_id, served_count, correct_count, updated_at FROM question_stats;
DROP TABLE question_stats;
ALTER TABLE question_stats_new RENAME TO question_stats;

-- 3) 이제 questions를 참조하는 테이블이 없으므로 안전하게 재생성한다.
CREATE TABLE questions_new (
  id            TEXT PRIMARY KEY,
  type          TEXT CHECK(type IN ('MULTIPLE_CHOICE','NUMERIC_INPUT','TEXT_INPUT')) NOT NULL,
  difficulty    INTEGER CHECK(difficulty BETWEEN 1 AND 4) NOT NULL,
  body          TEXT NOT NULL,
  choices_json  TEXT,
  answer        TEXT NOT NULL,
  explanation   TEXT NOT NULL,
  status        TEXT CHECK(status IN ('pending','approved','rejected')) DEFAULT 'pending',
  source        TEXT CHECK(source IN ('ai_generated','manual')) NOT NULL,
  generated_by  TEXT,
  reject_reason TEXT,
  created_at    TEXT NOT NULL,
  author_uid    TEXT REFERENCES users(uid),
  image_url     TEXT
);
INSERT INTO questions_new
  (id, type, difficulty, body, choices_json, answer, explanation, status, source, generated_by, reject_reason, created_at, author_uid)
SELECT
  id, type, difficulty, body, choices_json, answer, explanation, status, source, generated_by, reject_reason, created_at, author_uid
FROM questions;
DROP TABLE questions;
ALTER TABLE questions_new RENAME TO questions;
