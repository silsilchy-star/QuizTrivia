-- PLAN.md 7.2절 데이터 모델. 배포마다 재실행되므로 전부 멱등이어야 한다.

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
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id            TEXT PRIMARY KEY,
  type          TEXT CHECK(type IN ('MULTIPLE_CHOICE','NUMERIC_INPUT')) NOT NULL,
  difficulty    INTEGER CHECK(difficulty BETWEEN 1 AND 4) NOT NULL,
  body          TEXT NOT NULL,
  choices_json  TEXT,
  answer        TEXT NOT NULL,
  explanation   TEXT NOT NULL,
  status        TEXT CHECK(status IN ('pending','approved','rejected')) DEFAULT 'pending',
  source        TEXT CHECK(source IN ('ai_generated','manual')) NOT NULL,
  generated_by  TEXT,
  reject_reason TEXT,
  created_at    TEXT NOT NULL
);

-- D-16: 문항 하나가 여러 주제에 속함 (넓은 태그 1개 + 좁은 태그 1~2개)
CREATE TABLE IF NOT EXISTS question_topics (
  question_id TEXT NOT NULL REFERENCES questions(id),
  topic_id    TEXT NOT NULL REFERENCES topics(id),
  PRIMARY KEY (question_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_question_topics_topic ON question_topics(topic_id);

CREATE TABLE IF NOT EXISTS users (
  uid           TEXT PRIMARY KEY,
  nickname      TEXT,
  is_anonymous  INTEGER NOT NULL DEFAULT 1,
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
  id            TEXT PRIMARY KEY,
  uid           TEXT NOT NULL REFERENCES users(uid),
  topic_id      TEXT NOT NULL REFERENCES topics(id),
  mode          TEXT NOT NULL DEFAULT 'solo',
  stage_reached INTEGER NOT NULL DEFAULT 1,
  score         INTEGER NOT NULL DEFAULT 0,
  -- 서버 채점(7.5절 A안)을 위해 출제 시점에 문항 id를 박아둔다. 클라이언트가
  -- 풀지도 않은 문항의 답을 제출하는 것을 막는다. PLAN 7.2절에 없던 추가 컬럼.
  served_json   TEXT,
  answers_json  TEXT,
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  status        TEXT CHECK(status IN ('in_progress','completed','abandoned')) NOT NULL DEFAULT 'in_progress'
);

CREATE INDEX IF NOT EXISTS idx_runs_uid ON runs(uid);

-- 문항별 출제·정답 집계. 난이도를 저자 판정에만 맡기지 않기 위한 근거를 쌓는다.
-- 문항반응이론(IRT)에서 가장 단순한 지표인 정답률(p-value)이 여기서 나온다.
-- 지금은 집계만 하고 보정은 데이터가 쌓인 뒤에 한다 (docs/2026-08-12-question-sourcing-research.md ⑤).
CREATE TABLE IF NOT EXISTS question_stats (
  question_id   TEXT PRIMARY KEY REFERENCES questions(id),
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
