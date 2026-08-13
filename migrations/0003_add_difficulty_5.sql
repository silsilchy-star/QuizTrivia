-- Migration number: 0003
--
-- 난이도 5단계(매니아) 추가. questions.difficulty의 CHECK 제약을 넓혀야 해서
-- (ALTER TABLE로는 불가능) questions 테이블을 재생성해야 한다.
--
-- 0002에서 이미 question_topics/question_stats의 questions(id) FK를 없애뒀으므로
-- (PLAN2.md §2 A1+A2, 0002 마이그레이션 참고) 이번엔 questions 하나만 재생성하면 된다 —
-- 0002처럼 자식 테이블부터 손댈 필요가 없다.

CREATE TABLE questions_new (
  id            TEXT PRIMARY KEY,
  type          TEXT CHECK(type IN ('MULTIPLE_CHOICE','NUMERIC_INPUT','TEXT_INPUT')) NOT NULL,
  difficulty    INTEGER CHECK(difficulty BETWEEN 1 AND 5) NOT NULL,
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
  (id, type, difficulty, body, choices_json, answer, explanation, status, source, generated_by, reject_reason, created_at, author_uid, image_url)
SELECT
  id, type, difficulty, body, choices_json, answer, explanation, status, source, generated_by, reject_reason, created_at, author_uid, image_url
FROM questions;
DROP TABLE questions;
ALTER TABLE questions_new RENAME TO questions;

-- 주제별 난이도5 승인 문항 수 집계 컬럼 (하한 게이트 판정용, PLAN2.md §2 A1+A2)
ALTER TABLE topics ADD COLUMN q_count_5 INTEGER DEFAULT 0;
