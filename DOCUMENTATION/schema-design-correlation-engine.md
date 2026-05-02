# Schema Design: GTM Config ↔ Ad Platform Correlation Engine

## Problem

The optimization loop tweaks GTM/sGTM data collection configs. Ad platform outcomes (conversions, EMQ, CAPI dedup, ROAS) change as a result. We need to:

1. Track **what changed** in GTM config between rounds
2. Track **what happened** to ad platform metrics after each change
3. Correlate the two: "which GTM variable changes improve which ad metrics?"
4. Find the **optimal GTM setup** by analyzing which levers consistently matter

## Storage Recommendation

**SQLite** via `better-sqlite3` → file at `data/experiments.sqlite` (already in `.gitignore`).
Graduate to PostgreSQL + PostgREST/Soul later if MCP tools or a dashboard need REST access.

---

## Schema

### Core Tables

```sql
-- A client (HRE, BLADE, etc.)
CREATE TABLE clients (
  id            INTEGER PRIMARY KEY,
  client_id     TEXT NOT NULL UNIQUE,        -- "hre"
  client_name   TEXT,                        -- "HRE Beauty"
  meta_account  TEXT,                        -- "act_645790768357540"
  meta_pixel    TEXT,                        -- "1029907382331846"
  gads_customer TEXT,
  gtm_account   TEXT,
  gtm_container TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- One run of the optimization loop
CREATE TABLE experiments (
  id            INTEGER PRIMARY KEY,
  client_id     TEXT NOT NULL REFERENCES clients(client_id),
  start_time    TEXT NOT NULL,               -- ISO 8601
  end_time      TEXT,
  template_path TEXT,                        -- seed container used
  weight_profile TEXT,                       -- "full", "meta_enriched", etc.
  rounds        INTEGER,
  start_score   REAL,
  final_score   REAL,
  best_score    REAL,
  stop_reason   TEXT                         -- "plateau", "regression", "max_rounds"
);
```

### Per-Round Tracking

```sql
-- Each mutation round within an experiment
CREATE TABLE rounds (
  id              INTEGER PRIMARY KEY,
  experiment_id   INTEGER NOT NULL REFERENCES experiments(id),
  round_num       INTEGER NOT NULL,
  score           REAL NOT NULL,             -- composite score 0-1
  issue_count     INTEGER,
  action          TEXT NOT NULL,             -- "improved"|"reverted"|"validation_fail"|"json_fail"
  mutation_summary TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- 12-dimension scores per round
CREATE TABLE dimension_scores (
  id            INTEGER PRIMARY KEY,
  round_id      INTEGER NOT NULL REFERENCES rounds(id),
  dimension     TEXT NOT NULL,               -- "tagCoverage", "capiCoverage", etc.
  weight        REAL NOT NULL,
  score         REAL NOT NULL
);

-- Individual issues detected per round
CREATE TABLE issues (
  id            INTEGER PRIMARY KEY,
  round_id      INTEGER NOT NULL REFERENCES rounds(id),
  dimension     TEXT NOT NULL,
  severity      TEXT NOT NULL,               -- "error"|"warning"|"info"
  entity        TEXT,                        -- tag/trigger/variable name
  message       TEXT NOT NULL
);
```

### Config Snapshots (the "what changed" side)

```sql
-- GTM container state at a point in time
CREATE TABLE config_snapshots (
  id            INTEGER PRIMARY KEY,
  round_id      INTEGER NOT NULL REFERENCES rounds(id),
  tag_count     INTEGER,
  trigger_count INTEGER,
  variable_count INTEGER,
  folder_count  INTEGER,
  config_json   TEXT                         -- full container JSON (for diffs)
);

-- Individual GTM entities tracked per snapshot
-- Denormalized for query speed — one row per tag/trigger/variable
CREATE TABLE config_entities (
  id            INTEGER PRIMARY KEY,
  snapshot_id   INTEGER NOT NULL REFERENCES config_snapshots(id),
  entity_type   TEXT NOT NULL,               -- "tag"|"trigger"|"variable"
  entity_id     TEXT NOT NULL,               -- GTM tagId/triggerId/variableId
  name          TEXT NOT NULL,
  subtype       TEXT,                        -- tag type: "googtag","gaawe","html"; var type: "v","c","jsm"
  folder_name   TEXT,
  consent_status TEXT,                       -- tags only: "NOT_SET"|"NEEDED"|"NOT_REQUIRED"
  fingerprint   TEXT                         -- GTM version hash — changes when entity is modified
);
```

### Config Deltas (what changed between rounds)

```sql
-- What changed in GTM config between round N-1 and round N
CREATE TABLE config_deltas (
  id              INTEGER PRIMARY KEY,
  round_id        INTEGER NOT NULL REFERENCES rounds(id),
  entity_type     TEXT NOT NULL,             -- "tag"|"trigger"|"variable"
  entity_id       TEXT NOT NULL,
  entity_name     TEXT NOT NULL,
  change_type     TEXT NOT NULL,             -- "added"|"removed"|"modified"
  field_changed   TEXT,                      -- "consent_status", "name", "parameter", etc.
  old_value       TEXT,
  new_value       TEXT
);
```

### Ad Platform Observations (the "what happened" side)

```sql
-- Ads snapshot pulled at a point in time (via MCP)
CREATE TABLE ads_observations (
  id            INTEGER PRIMARY KEY,
  experiment_id INTEGER NOT NULL REFERENCES experiments(id),
  round_id      INTEGER REFERENCES rounds(id),  -- NULL = baseline before loop
  observed_at   TEXT NOT NULL,
  meta_spend    REAL,
  currency      TEXT
);

-- Per-event metrics from Meta Ads
CREATE TABLE meta_event_metrics (
  id              INTEGER PRIMARY KEY,
  observation_id  INTEGER NOT NULL REFERENCES ads_observations(id),
  event_name      TEXT NOT NULL,             -- "purchase", "add_to_cart", etc.
  count_7d_click  INTEGER,
  count_1d_click  INTEGER,
  count_1d_view   INTEGER,
  value_7d_click  REAL,
  count_browser   INTEGER,                   -- pixel-side count
  count_server    INTEGER,                   -- CAPI server-side count
  dedup_rate      REAL,                      -- 0-1
  emq_score       REAL                       -- 0-10 Event Match Quality
);

-- Funnel step metrics
CREATE TABLE funnel_metrics (
  id              INTEGER PRIMARY KEY,
  observation_id  INTEGER NOT NULL REFERENCES ads_observations(id),
  from_event      TEXT NOT NULL,
  to_event        TEXT NOT NULL,
  ratio           REAL NOT NULL,
  expected_low    REAL,
  expected_high   REAL,
  status          TEXT                       -- "normal"|"low"|"high"
);

-- Google Ads conversion action metrics
CREATE TABLE gads_conversion_metrics (
  id              INTEGER PRIMARY KEY,
  observation_id  INTEGER NOT NULL REFERENCES ads_observations(id),
  action_id       TEXT NOT NULL,
  action_name     TEXT NOT NULL,
  category        TEXT,                      -- "PURCHASE", "LEAD", etc.
  count_30d       INTEGER,
  value_30d       REAL,
  tag_snippet     TEXT
);
```

---

## Key Queries This Enables

### 1. "Which config changes correlate with EMQ improvements?"

```sql
SELECT
  cd.entity_name,
  cd.field_changed,
  cd.old_value,
  cd.new_value,
  m_after.emq_score - m_before.emq_score AS emq_delta
FROM config_deltas cd
JOIN rounds r ON r.id = cd.round_id
JOIN ads_observations ao_after ON ao_after.round_id = r.id
JOIN ads_observations ao_before ON ao_before.round_id = (
  SELECT id FROM rounds
  WHERE experiment_id = r.experiment_id AND round_num = r.round_num - 1
)
JOIN meta_event_metrics m_after ON m_after.observation_id = ao_after.id
JOIN meta_event_metrics m_before ON m_before.observation_id = ao_before.id
  AND m_before.event_name = m_after.event_name
WHERE m_after.emq_score > m_before.emq_score
ORDER BY emq_delta DESC;
```

### 2. "What's the average score improvement when consent_status is set?"

```sql
SELECT
  AVG(r.score - prev_r.score) AS avg_score_delta,
  COUNT(*) AS occurrences
FROM config_deltas cd
JOIN rounds r ON r.id = cd.round_id
JOIN rounds prev_r ON prev_r.experiment_id = r.experiment_id
  AND prev_r.round_num = r.round_num - 1
WHERE cd.field_changed = 'consent_status'
  AND cd.new_value = 'NEEDED'
  AND r.action = 'improved';
```

### 3. "Show me the best config variables across all winning experiments"

```sql
SELECT
  ce.name,
  ce.subtype,
  ce.entity_type,
  COUNT(DISTINCT cs.round_id) AS appeared_in_winners,
  AVG(r.score) AS avg_score
FROM config_entities ce
JOIN config_snapshots cs ON cs.id = ce.snapshot_id
JOIN rounds r ON r.id = cs.round_id
JOIN experiments e ON e.id = r.experiment_id
WHERE r.score = e.best_score
GROUP BY ce.name, ce.subtype, ce.entity_type
ORDER BY avg_score DESC;
```

### 4. "Track CAPI dedup rate over time for a client"

```sql
SELECT
  ao.observed_at,
  mem.event_name,
  mem.dedup_rate,
  mem.emq_score,
  mem.count_browser,
  mem.count_server
FROM meta_event_metrics mem
JOIN ads_observations ao ON ao.id = mem.observation_id
JOIN experiments e ON e.id = ao.experiment_id
WHERE e.client_id = 'hre'
ORDER BY ao.observed_at;
```

### 5. "Which GTM variables exist in top-scoring configs but not low-scoring ones?"

```sql
SELECT ce.name, ce.entity_type, ce.subtype
FROM config_entities ce
JOIN config_snapshots cs ON cs.id = ce.snapshot_id
JOIN rounds r ON r.id = cs.round_id
WHERE r.score > 0.85
EXCEPT
SELECT ce.name, ce.entity_type, ce.subtype
FROM config_entities ce
JOIN config_snapshots cs ON cs.id = ce.snapshot_id
JOIN rounds r ON r.id = cs.round_id
WHERE r.score < 0.70;
```

---

## Data Flow

```
                    ┌─────────────────────────────────────────┐
                    │          OPTIMIZATION LOOP               │
                    │                                          │
  MCP: GTM ────────┤  1. Snapshot config  → config_snapshots  │
                    │  2. Score            → rounds,           │
                    │                        dimension_scores  │
  MCP: Meta Ads ───┤  3. Observe metrics  → ads_observations, │
  MCP: Google Ads ──┤                       meta_event_metrics │
                    │  4. Mutate config                        │
                    │  5. Diff             → config_deltas     │
                    │  6. Re-score         → rounds (next)     │
                    │  7. Keep/revert                          │
                    └─────────────────────────────────────────┘
                                      │
                                      ▼
                              data/experiments.sqlite
                                      │
                         ┌────────────┼────────────┐
                         ▼            ▼            ▼
                    Query CLI    Future MCP    Future Dashboard
                    (scripts/)   (REST layer)  (PostgREST/Soul)
```

## Timing Consideration

The correlation between GTM config changes and ad platform metrics has a **lag**:
- GTM changes are instant (container publishes in seconds)
- Ad platform metrics reflect changes over **hours to days**
- EMQ score updates within ~24h
- Conversion counts need 1-7 day attribution windows

The schema supports this via `ads_observations.observed_at` being independent of `rounds.created_at`. You can pull ad metrics days after a config change and still link them to the round that caused the change.

## Implementation Order

1. `npm install better-sqlite3 @types/better-sqlite3`
2. Create `lib/db.ts` — schema init + typed insert/query helpers
3. Modify `run-gtm-loop.ts` — write to DB alongside existing JSON files (dual-write, no breaking change)
4. Add `scripts/query-results.ts` — CLI for common correlation queries
5. Later: wrap with REST (PostgREST/Soul) or MCP server when external consumers appear
