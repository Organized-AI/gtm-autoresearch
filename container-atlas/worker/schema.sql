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
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, public_id TEXT NOT NULL, label TEXT, website TEXT, token_hash TEXT NOT NULL,
  watch_id TEXT, baseline_score INTEGER, best_score INTEGER, rounds INTEGER NOT NULL DEFAULT 0, accepted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS runs_container ON runs(public_id, created_at);
CREATE TABLE IF NOT EXISTS rounds (
  run_id TEXT NOT NULL, round INTEGER NOT NULL, accepted INTEGER NOT NULL, score INTEGER, critical INTEGER,
  source TEXT, idea TEXT, why TEXT, reason TEXT, error TEXT, operations TEXT, dimensions TEXT, created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, round)
);
CREATE TABLE IF NOT EXISTS jev_keys (
  id TEXT PRIMARY KEY, key_hash TEXT NOT NULL UNIQUE, email TEXT NOT NULL, label TEXT, plan TEXT NOT NULL DEFAULT 'trial',
  created_at INTEGER NOT NULL, expires_at INTEGER, calls INTEGER NOT NULL DEFAULT 0, last_used INTEGER, ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS jev_keys_email ON jev_keys(email);
CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY, website TEXT NOT NULL, origin TEXT, token_hash TEXT NOT NULL, status TEXT NOT NULL,
  max_pages INTEGER NOT NULL, queued INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
  robots TEXT, sitemap_urls INTEGER, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS scans_site ON scans(website, created_at);
CREATE TABLE IF NOT EXISTS scan_pages (
  scan_id TEXT NOT NULL, url TEXT NOT NULL, status TEXT NOT NULL, http_status INTEGER, final_url TEXT,
  result TEXT, error TEXT, queued_at INTEGER NOT NULL, fetched_at INTEGER,
  PRIMARY KEY (scan_id, url)
);
