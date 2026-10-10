-- Autoresearch in a Box: one row per event from `arb`. The body keeps the full event.
CREATE TABLE IF NOT EXISTS events (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  seq    INTEGER NOT NULL,
  at     TEXT NOT NULL,
  kind   TEXT NOT NULL,
  body   TEXT NOT NULL,
  UNIQUE (run_id, seq)
);
CREATE INDEX IF NOT EXISTS events_kind_at ON events (kind, at);
