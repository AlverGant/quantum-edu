-- Schema do quantum-edu. Todo CREATE é IF NOT EXISTS: rodar de novo num
-- banco existente não altera nada (mudanças de coluna vão em migrations/).

CREATE TABLE IF NOT EXISTS shor_state (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  state      TEXT NOT NULL DEFAULT 'idle',   -- idle | submitted
  job_id     TEXT,
  backend    TEXT,
  run_id     INTEGER,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS shor_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at      TEXT NOT NULL,
  completed_at    TEXT,
  backend         TEXT NOT NULL,
  job_id          TEXT NOT NULL,
  status          TEXT NOT NULL,             -- running | ok | failed
  error           TEXT,
  charged_seconds REAL,
  results_json    TEXT                       -- [{id, shots, counts:{k:n}}]
);

INSERT OR IGNORE INTO shor_state (id, state) VALUES (1, 'idle');

-- Contadores públicos exibidos no site.
CREATE TABLE IF NOT EXISTS counters (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

-- Visitantes únicos por dia. `visitor` é hash(sal+dia+IP+user-agent)
-- truncado: some sozinho na virada do dia e não permite voltar ao IP.
-- Nenhum IP é gravado em lugar nenhum.
CREATE TABLE IF NOT EXISTS visitors (
  day     TEXT NOT NULL,
  visitor TEXT NOT NULL,
  country TEXT,
  PRIMARY KEY (day, visitor)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS countries (
  code  TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

INSERT OR IGNORE INTO counters (key, value) VALUES
  ('pageviews', 0),
  ('unique_visitors', 0);
