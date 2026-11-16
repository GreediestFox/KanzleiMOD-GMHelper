-- KanzleiMOD relay schema (D1 / SQLite)
CREATE TABLE IF NOT EXISTS sessions (
  s TEXT PRIMARY KEY,            -- session id (in the page URL)
  k TEXT NOT NULL,               -- game key: only the game client knows it, sent over plain http by the game
  p TEXT,                        -- page key: claimed once by the web page over https, never sent over http
  lang TEXT NOT NULL DEFAULT 'en',
  ver TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  game_seen INTEGER NOT NULL DEFAULT 0,
  page_seen INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cmdq (            -- page -> game
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  s TEXT NOT NULL,
  line TEXT NOT NULL,                        -- id TAB arg TAB arg ...
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cmdq ON cmdq(s, seq);
CREATE TABLE IF NOT EXISTS events (          -- game -> page
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  s TEXT NOT NULL,
  type TEXT NOT NULL,
  id TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events ON events(s, seq);
CREATE TABLE IF NOT EXISTS blobs (           -- chunked data from the game: command registry, catalog (items/objects/buildings) ...
  key TEXT NOT NULL,                         -- 'c:<hash>' = shared catalog (same game files + language = same hash), 's:<session>:<name>' = per session
  n INTEGER NOT NULL,
  total INTEGER NOT NULL,
  data TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (key, n)
);
