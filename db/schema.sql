-- QuizTrivia 스키마 베이스라인 (PLAN 7.2절 데이터 모델).
--
-- ⚠ 이 파일은 배포마다 그대로 재실행된다. 그래서 두 가지 규칙이 있다:
--
--   1. 전부 멱등이어야 한다 — 모든 문장이 `IF NOT EXISTS`다.
--   2. **DROP TABLE을 절대 쓰지 않는다.** 한때 여기 DROP이 있어서 실사용자의
--      계정·플레이 기록이 배포마다 통째로 지워진 사고가 있었다
--      (docs/2026-08-13-critical-schema-drop-fix.md).
--
-- 이 파일은 "빈 DB를 지금 상태로 만드는 법"이고, 실행 중인 DB는 이미 테이블이
-- 있어서 아래 문장이 한 줄도 실행되지 않는다. 즉 **이 파일을 고쳐도 이미
-- 돌아가는 DB는 바뀌지 않는다.** 스키마를 실제로 바꾸려면 migrations/에 새
-- 파일을 추가해야 한다 (README "스키마를 바꿔야 할 때" 참고).
--
-- 2026-08-13: 마이그레이션 0001·0002를 이 베이스라인에 흡수했다. 그 전에는
-- 이 파일이 옛 모습을 담고 있어서, 진짜 스키마를 알려면 마이그레이션을
-- 순서대로 읽어야 했다. 흡수된 두 파일은 db/migrations-archive/에 있다.

CREATE TABLE IF NOT EXISTS topics (
  id                   TEXT PRIMARY KEY,
  no                   INTEGER,
  name                 TEXT NOT NULL,
  kind                 TEXT CHECK(kind IN ('broad','narrow')),
  tagline              TEXT,
  scope_json           TEXT,
  out_of_scope_json    TEXT,
  difficulty_spec_json TEXT,
  status               TEXT CHECK(status IN ('draft','active','archived')) DEFAULT 'draft',
  q_count_1 INTEGER DEFAULT 0,
  q_count_2 INTEGER DEFAULT 0,
  q_count_3 INTEGER DEFAULT 0,
  q_count_4 INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- 공식 콘텐츠(data/*.json 파이프라인)와 유저 창작마당을 가르는 경계.
  -- community 주제는 랭킹에 반영되지 않는다 (worker/community.ts).
  source     TEXT NOT NULL DEFAULT 'official' CHECK(source IN ('official','community')),
  author_uid TEXT REFERENCES users(uid)
);

CREATE INDEX IF NOT EXISTS idx_topics_source ON topics(source);

CREATE TABLE IF NOT EXISTS questions (
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
  -- 문항 작성자. 공식 문항은 항상 NULL, 유저 창작 문항만 채워진다.
  -- scripts/build-seed.mjs의 정리 로직이 이 값으로 공식/커뮤니티를 가른다 —
  -- 이 구분이 없어서 커뮤니티 문항이 매 배포마다 지워질 뻔한 적이 있다.
  author_uid    TEXT REFERENCES users(uid),
  image_url     TEXT
);

-- D-16: 문항 하나가 여러 주제에 속한다 (넓은 태그 1개 + 좁은 태그 1~2개).
--
-- ⚠ question_id에는 questions(id) FK를 걸지 않는다. D1이 "참조당하는 테이블"의
-- DROP을 막아서, questions를 재생성해야 하는 마이그레이션(CHECK 제약 확장 등)이
-- 불가능해지기 때문이다. db/migrations-archive/0002_add_text_input_and_images.sql에
-- 그 사정과 절차가 남아있다. question_stats도 같은 이유로 FK가 없다.
CREATE TABLE IF NOT EXISTS question_topics (
  question_id TEXT NOT NULL,
  topic_id    TEXT NOT NULL REFERENCES topics(id),
  PRIMARY KEY (question_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_question_topics_topic ON question_topics(topic_id);

CREATE TABLE IF NOT EXISTS users (
  uid           TEXT PRIMARY KEY,
  nickname      TEXT,
  is_anonymous  INTEGER NOT NULL DEFAULT 1,
  google_sub    TEXT UNIQUE,  -- 구글 계정과 연결되면 채워진다 (PLAN 5.4절 계정 승계)
  email         TEXT,
  global_score  INTEGER NOT NULL DEFAULT 0,
  play_count    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- 폭 보상형 랭킹(D-7)의 원천. 통합 점수 = SUM(score) GROUP BY uid
CREATE TABLE IF NOT EXISTS topic_best (
  uid        TEXT NOT NULL REFERENCES users(uid),
  topic_id   TEXT NOT NULL REFERENCES topics(id),
  score      INTEGER NOT NULL,
  stage      INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (uid, topic_id)
);

CREATE TABLE IF NOT EXISTS topic_best_weekly (
  uid        TEXT NOT NULL REFERENCES users(uid),
  topic_id   TEXT NOT NULL REFERENCES topics(id),
  week_id    TEXT NOT NULL,
  score      INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (uid, topic_id, week_id)
);

CREATE TABLE IF NOT EXISTS runs (
  id             TEXT PRIMARY KEY,
  uid            TEXT NOT NULL REFERENCES users(uid),
  topic_id       TEXT NOT NULL REFERENCES topics(id),
  mode           TEXT NOT NULL DEFAULT 'solo',
  stage_reached  INTEGER NOT NULL DEFAULT 1,   -- 현재 도전 중인 스테이지 (1~12)
  score          INTEGER NOT NULL DEFAULT 0,   -- 지금까지 클리어한 스테이지의 누적 점수
  -- 서버 채점(7.5절 A안)을 위해 출제 시점에 문항 id를 박아둔다. 클라이언트가
  -- 풀지도 않은 문항의 답을 제출하는 것을 막는다. PLAN 7.2절에 없던 추가 컬럼.
  served_json     TEXT,  -- 지금 스테이지에 낸 5문항 id (채점 대상)
  all_served_json TEXT,  -- 이 판에서 지금까지 낸 모든 문항 id (판 전체 중복 방지, PLAN 4.3절)
  answers_json    TEXT,  -- 스테이지별 채점 결과 누적 (검토용)
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  status         TEXT CHECK(status IN ('in_progress','completed','abandoned')) NOT NULL DEFAULT 'in_progress'
);

CREATE INDEX IF NOT EXISTS idx_runs_uid ON runs(uid);

-- 문항별 출제·정답 집계. 난이도를 저자 판정에만 맡기지 않기 위한 근거를 쌓는다.
-- 문항반응이론(IRT)에서 가장 단순한 지표인 정답률(p-value)이 여기서 나온다.
-- 지금은 집계만 하고 보정은 데이터가 쌓인 뒤에 한다 (docs/2026-08-12-question-sourcing-research.md ⑤).
CREATE TABLE IF NOT EXISTS question_stats (
  question_id   TEXT PRIMARY KEY,
  served_count  INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ranking_cache (
  board_id     TEXT PRIMARY KEY,
  top_json     TEXT,
  cutoff_score INTEGER,
  generated_at TEXT
);
