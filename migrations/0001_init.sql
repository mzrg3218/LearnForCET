-- LEARNforCET 数据库初始化
-- 用法: wrangler d1 execute DB --local --file=migrations/0001_init.sql   (本地)
--       wrangler d1 execute DB --remote --file=migrations/0001_init.sql  (线上)

CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY,
  username     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL DEFAULT '',
  pass         TEXT NOT NULL,              -- PBKDF2 六位 hex
  salt         TEXT NOT NULL,
  avatar       TEXT NOT NULL DEFAULT '',   -- data URL (客户端压缩到 ~20KB)
  bio          TEXT NOT NULL DEFAULT '',   -- 签名
  address      TEXT NOT NULL DEFAULT '',   -- 地址
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,             -- SHA-256(token) 的 hex
  user_id    INTEGER NOT NULL,
  expires    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS friend_requests (
  id         INTEGER PRIMARY KEY,
  from_id    INTEGER NOT NULL,
  to_id      INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(from_id, to_id)
);

CREATE TABLE IF NOT EXISTS friends (
  id         INTEGER PRIMARY KEY,
  a_id       INTEGER NOT NULL,             -- 约定 a_id < b_id
  b_id       INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(a_id, b_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY,
  conv_a     INTEGER NOT NULL,             -- min(from,to)
  conv_b     INTEGER NOT NULL,             -- max(from,to)
  from_id    INTEGER NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conv_a, conv_b, id);
