-- Day 1 범위: 익명 uid 발급에 필요한 최소 스키마.
-- 전체 스키마(topics/questions/runs/ranking_cache 등)는 PLAN.md 7.2절과 Day 2~3에 걸쳐 추가된다.

CREATE TABLE IF NOT EXISTS users (
  uid           TEXT PRIMARY KEY,
  nickname      TEXT,
  is_anonymous  INTEGER NOT NULL DEFAULT 1,
  global_score  INTEGER DEFAULT 0,
  play_count    INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
