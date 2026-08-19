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
