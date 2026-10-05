CREATE TABLE IF NOT EXISTS watches (
  id TEXT PRIMARY KEY, public_id TEXT NOT NULL, label TEXT, website TEXT,
  token_hash TEXT NOT NULL, baseline TEXT NOT NULL, names TEXT,
  created_at INTEGER NOT NULL, last_checked INTEGER, last_live TEXT, ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS watches_due ON watches(last_checked);
CREATE TABLE IF NOT EXISTS checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, watch_id TEXT NOT NULL, checked_at INTEGER NOT NULL,
  version TEXT, changes TEXT, new_changes TEXT, error TEXT
);
CREATE INDEX IF NOT EXISTS checks_watch ON checks(watch_id, checked_at);
CREATE TABLE IF NOT EXISTS hits (ip_hash TEXT NOT NULL, bucket TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (ip_hash, bucket));
