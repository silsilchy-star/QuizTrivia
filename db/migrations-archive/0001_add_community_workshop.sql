-- Migration number: 0001 	 2026-08-13T05:51:22.187Z
--
-- 유저 창작마당(커뮤니티 주제) 기능. 이제부터 스키마를 바꿀 땐 이렇게
-- migrations/ 폴더에 새 파일을 추가한다 — db/schema.sql을 다시 고치지 않는다.
-- (db/schema.sql을 매 배포마다 그대로 재실행하다가 DROP TABLE 때문에 실사용자
-- 데이터를 지운 사고가 있었다 — docs/2026-08-13-critical-schema-drop-fix.md)

ALTER TABLE topics ADD COLUMN source TEXT NOT NULL DEFAULT 'official' CHECK(source IN ('official','community'));
ALTER TABLE topics ADD COLUMN author_uid TEXT REFERENCES users(uid);

-- 문항 작성자. 공식 문항(AI 생성/수동 적재)은 NULL, 유저 창작 문항만 채워진다.
ALTER TABLE questions ADD COLUMN author_uid TEXT REFERENCES users(uid);

CREATE INDEX IF NOT EXISTS idx_topics_source ON topics(source);
