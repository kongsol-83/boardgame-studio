/**
 * 로컬 BGG 인덱스. Node 24 내장 node:sqlite 를 쓴다.
 *
 * 두 계층이다. 정규화된 인덱스(games, mechanics, ...)는 랭킹 덤프와 thing 응답을
 * 담고, http_cache 는 온디맨드 검색 결과를 TTL과 함께 담는다.
 *
 * 이 데이터베이스는 data/ 아래에 있고 gitignore 대상이다. BGG XML API
 * 이용약관상 재배포할 수 없다.
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { ROOT } from '../lib/env.mjs';

export const DB_PATH = path.join(ROOT, 'data', 'bgg.sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  id            INTEGER PRIMARY KEY,
  name          TEXT,
  year          INTEGER,
  is_expansion  INTEGER DEFAULT 0,
  min_players   INTEGER,
  max_players   INTEGER,
  best_players  INTEGER,
  min_time      INTEGER,
  max_time      INTEGER,
  min_age       INTEGER,
  weight        REAL,
  rating_avg    REAL,
  rating_bayes  REAL,
  rank_overall  INTEGER,
  users_rated   INTEGER,
  description   TEXT,
  fetched_at    INTEGER          -- thing 상세를 받은 시각. NULL이면 아직 시드 상태
);

CREATE TABLE IF NOT EXISTS ranks (
  game_id    INTEGER NOT NULL,
  rank_type  TEXT    NOT NULL,   -- boardgame, strategygames, thematic, ...
  rank_value INTEGER NOT NULL,
  PRIMARY KEY (game_id, rank_type)
);

CREATE TABLE IF NOT EXISTS mechanics   (id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_ko TEXT);
CREATE TABLE IF NOT EXISTS categories  (id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_ko TEXT);
CREATE TABLE IF NOT EXISTS designers   (id INTEGER PRIMARY KEY, name TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS game_mechanics  (game_id INTEGER, mechanic_id INTEGER, PRIMARY KEY (game_id, mechanic_id));
CREATE TABLE IF NOT EXISTS game_categories (game_id INTEGER, category_id INTEGER, PRIMARY KEY (game_id, category_id));
CREATE TABLE IF NOT EXISTS game_designers  (game_id INTEGER, designer_id INTEGER, PRIMARY KEY (game_id, designer_id));

CREATE TABLE IF NOT EXISTS http_cache (
  url        TEXT PRIMARY KEY,
  status     INTEGER,
  body       TEXT,
  fetched_at INTEGER,
  ttl        INTEGER
);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE INDEX IF NOT EXISTS idx_games_rank    ON games (rank_overall) WHERE rank_overall IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_games_fetched ON games (fetched_at);
CREATE INDEX IF NOT EXISTS idx_games_weight  ON games (weight);
CREATE INDEX IF NOT EXISTS idx_ranks_type    ON ranks (rank_type, rank_value);
CREATE INDEX IF NOT EXISTS idx_gm_mechanic   ON game_mechanics (mechanic_id);
CREATE INDEX IF NOT EXISTS idx_gc_category   ON game_categories (category_id);
`;

/*
 * node:sqlite 를 정적으로 import하면 ESM 링킹 단계에서 로드되어,
 * tools/lib/quiet.mjs 가 실험 경고 필터를 걸기도 전에 경고가 찍힌다.
 * 지연 로딩하면 필터가 먼저 설치된다. 대신 openDb 가 async가 된다.
 */
let sqlite = null;

/** 인덱스를 열고 필요하면 만든다. */
export async function openDb(file = DB_PATH) {
  sqlite ??= await import('node:sqlite');
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new sqlite.DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function getMeta(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

/** 여러 문장을 한 트랜잭션으로 묶는다. 15만 행 삽입에서 이게 없으면 몇 분씩 걸린다. */
export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * 랭킹 덤프 한 행을 넣는다. 이미 상세를 받아둔 게임은 랭크만 갱신하고
 * fetched_at 과 상세 필드는 건드리지 않는다.
 */
export function createSeedWriter(db) {
  const upsertGame = db.prepare(`
    INSERT INTO games (id, name, year, is_expansion, rating_avg, rating_bayes, rank_overall, users_rated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name         = COALESCE(excluded.name, games.name),
      year         = COALESCE(excluded.year, games.year),
      is_expansion = excluded.is_expansion,
      rating_avg   = excluded.rating_avg,
      rating_bayes = excluded.rating_bayes,
      rank_overall = excluded.rank_overall,
      users_rated  = excluded.users_rated
  `);
  const upsertRank = db.prepare(`
    INSERT INTO ranks (game_id, rank_type, rank_value) VALUES (?, ?, ?)
    ON CONFLICT(game_id, rank_type) DO UPDATE SET rank_value = excluded.rank_value
  `);
  const clearRank = db.prepare('DELETE FROM ranks WHERE game_id = ? AND rank_type = ?');

  // subranks 는 없어도 된다. 없다고 죽으면 부르는 쪽에서 원인을 찾기 어렵다
  return function writeSeed(game, subranks = {}) {
    upsertGame.run(
      game.id,
      game.name,
      game.year,
      game.is_expansion ? 1 : 0,
      game.rating_avg,
      game.rating_bayes,
      game.rank_overall,
      game.users_rated,
    );
    if (game.rank_overall !== null) upsertRank.run(game.id, 'boardgame', game.rank_overall);
    else clearRank.run(game.id, 'boardgame');

    for (const [type, value] of Object.entries(subranks)) {
      if (value === null) clearRank.run(game.id, type);
      else upsertRank.run(game.id, type, value);
    }
  };
}

/** thing 응답에서 만든 상세 레코드를 넣는다. */
export function createGameWriter(db) {
  const upsertGame = db.prepare(`
    INSERT INTO games (
      id, name, year, is_expansion, min_players, max_players, best_players,
      min_time, max_time, min_age, weight, rating_avg, rating_bayes,
      rank_overall, users_rated, description, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, year = excluded.year, is_expansion = excluded.is_expansion,
      min_players = excluded.min_players, max_players = excluded.max_players,
      best_players = excluded.best_players, min_time = excluded.min_time,
      max_time = excluded.max_time, min_age = excluded.min_age, weight = excluded.weight,
      rating_avg = excluded.rating_avg, rating_bayes = excluded.rating_bayes,
      rank_overall = excluded.rank_overall, users_rated = excluded.users_rated,
      description = excluded.description, fetched_at = excluded.fetched_at
  `);
  const upsertRank = db.prepare(`
    INSERT INTO ranks (game_id, rank_type, rank_value) VALUES (?, ?, ?)
    ON CONFLICT(game_id, rank_type) DO UPDATE SET rank_value = excluded.rank_value
  `);
  const deleteRanks = db.prepare('DELETE FROM ranks WHERE game_id = ?');

  const taxonomy = {
    mechanics: {
      upsert: db.prepare('INSERT INTO mechanics (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name'),
      link: db.prepare('INSERT OR IGNORE INTO game_mechanics (game_id, mechanic_id) VALUES (?, ?)'),
      clear: db.prepare('DELETE FROM game_mechanics WHERE game_id = ?'),
    },
    categories: {
      upsert: db.prepare('INSERT INTO categories (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name'),
      link: db.prepare('INSERT OR IGNORE INTO game_categories (game_id, category_id) VALUES (?, ?)'),
      clear: db.prepare('DELETE FROM game_categories WHERE game_id = ?'),
    },
    designers: {
      upsert: db.prepare('INSERT INTO designers (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name'),
      link: db.prepare('INSERT OR IGNORE INTO game_designers (game_id, designer_id) VALUES (?, ?)'),
      clear: db.prepare('DELETE FROM game_designers WHERE game_id = ?'),
    },
  };

  return function writeGame(game, now = Date.now()) {
    upsertGame.run(
      game.id, game.name, game.year, game.is_expansion,
      game.min_players, game.max_players, game.best_players,
      game.min_time, game.max_time, game.min_age, game.weight,
      game.rating_avg, game.rating_bayes, game.rank_overall,
      game.users_rated, game.description, now,
    );

    deleteRanks.run(game.id);
    for (const rank of game.ranks) upsertRank.run(game.id, rank.type, rank.value);

    for (const [key, statements] of Object.entries(taxonomy)) {
      statements.clear.run(game.id);
      for (const entry of game[key] ?? []) {
        statements.upsert.run(entry.id, entry.name);
        statements.link.run(game.id, entry.id);
      }
    }
  };
}

/** 아직 상세를 안 받은 게임을 랭크 순으로 돌려준다. */
export function pendingHydration(db, { limit = 20_000, includeExpansions = false } = {}) {
  const expansionFilter = includeExpansions ? '' : 'AND is_expansion = 0';
  return db
    .prepare(`
      SELECT id FROM games
      WHERE fetched_at IS NULL AND rank_overall IS NOT NULL ${expansionFilter}
      ORDER BY rank_overall ASC
      LIMIT ?
    `)
    .all(limit)
    .map((row) => row.id);
}

export function indexStats(db) {
  const one = (sql) => db.prepare(sql).get();
  return {
    games: one('SELECT COUNT(*) AS n FROM games').n,
    hydrated: one('SELECT COUNT(*) AS n FROM games WHERE fetched_at IS NOT NULL').n,
    ranked: one('SELECT COUNT(*) AS n FROM games WHERE rank_overall IS NOT NULL').n,
    mechanics: one('SELECT COUNT(*) AS n FROM mechanics').n,
    categories: one('SELECT COUNT(*) AS n FROM categories').n,
    ranksSource: getMeta(db, 'ranks_source_file'),
    ranksDate: getMeta(db, 'ranks_source_date'),
  };
}

// ---------------------------------------------------------------------------
// 온디맨드 응답 캐시
// ---------------------------------------------------------------------------

export function readCache(db, url) {
  const row = db.prepare('SELECT body, fetched_at, ttl FROM http_cache WHERE url = ?').get(url);
  if (!row) return null;
  if (Date.now() - row.fetched_at > row.ttl) return null;
  try {
    return JSON.parse(row.body);
  } catch {
    return null;
  }
}

export function writeCache(db, url, value, ttlMs) {
  db.prepare(`
    INSERT INTO http_cache (url, status, body, fetched_at, ttl) VALUES (?, 200, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET
      body = excluded.body, fetched_at = excluded.fetched_at, ttl = excluded.ttl
  `).run(url, JSON.stringify(value), Date.now(), ttlMs);
}
