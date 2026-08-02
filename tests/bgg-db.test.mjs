import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import '../tools/lib/quiet.mjs';
import {
  createGameWriter,
  createSeedWriter,
  getMeta,
  indexStats,
  openDb,
  pendingHydration,
  readCache,
  setMeta,
  transaction,
  writeCache,
} from '../tools/bgg/db.mjs';

/**
 * 임시 인덱스를 연다. 실제 data/bgg.sqlite 는 gitignore 대상이고 CI에는 없으므로
 * 테스트는 매번 빈 DB를 만들어 쓴다.
 */
async function withDb(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bgs-bgg-'));
  const db = await openDb(path.join(dir, 'index.sqlite'));
  t.after(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });
  return db;
}

/**
 * node:sqlite 는 프로토타입이 null인 행을 돌려준다. 객체 리터럴과 비교하려면
 * 평범한 객체로 옮겨야 한다.
 */
const rows = (list) => list.map((row) => ({ ...row }));

/** 랭킹 덤프 한 행 모양. */
const seedRow = (overrides = {}) => ({
  id: 1,
  name: 'Tidepool',
  year: 2026,
  is_expansion: false,
  rating_avg: 7.5,
  rating_bayes: 7.1,
  rank_overall: 100,
  users_rated: 1200,
  ...overrides,
});

/** thing 응답에서 만든 상세 레코드 모양. */
const gameRow = (overrides = {}) => ({
  id: 1,
  name: 'Tidepool',
  year: 2026,
  is_expansion: 0,
  min_players: 2,
  max_players: 4,
  best_players: 3,
  min_time: 25,
  max_time: 35,
  min_age: 8,
  weight: 2.1,
  rating_avg: 7.5,
  rating_bayes: 7.1,
  rank_overall: 100,
  users_rated: 1200,
  description: '조수 웅덩이를 훑는다',
  ranks: [{ type: 'boardgame', value: 100 }],
  mechanics: [{ id: 2040, name: 'Hand Management' }],
  categories: [{ id: 1089, name: 'Animals' }],
  designers: [{ id: 77, name: 'Sol Kong' }],
  ...overrides,
});

// --- 스키마와 메타 ----------------------------------------------------------

test('빈 인덱스를 열면 스키마가 만들어진다', async (t) => {
  const db = await withDb(t);
  const stats = indexStats(db);
  assert.deepEqual(
    { games: stats.games, hydrated: stats.hydrated, ranked: stats.ranked },
    { games: 0, hydrated: 0, ranked: 0 },
  );
  assert.equal(stats.ranksSource, null);
});

test('같은 파일을 다시 열어도 데이터가 남아 있다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bgs-bgg-'));
  const file = path.join(dir, 'index.sqlite');
  t.after(() => rm(dir, { recursive: true, force: true }));

  const first = await openDb(file);
  setMeta(first, 'ranks_source_file', 'boardgames_ranks_2026-08-01.zip');
  first.close();

  const second = await openDb(file);
  assert.equal(getMeta(second, 'ranks_source_file'), 'boardgames_ranks_2026-08-01.zip');
  second.close();
});

test('메타는 없으면 기본값을 돌려주고 덮어쓰면 갱신된다', async (t) => {
  const db = await withDb(t);
  assert.equal(getMeta(db, '없는키'), null);
  assert.equal(getMeta(db, '없는키', '기본'), '기본');

  setMeta(db, 'k', 'v1');
  setMeta(db, 'k', 'v2');
  assert.equal(getMeta(db, 'k'), 'v2');
});

test('메타 값은 문자열로 저장된다', async (t) => {
  const db = await withDb(t);
  setMeta(db, 'n', 20_000);
  assert.equal(getMeta(db, 'n'), '20000');
});

// --- 트랜잭션 --------------------------------------------------------------

test('트랜잭션이 실패하면 되돌린다', async (t) => {
  const db = await withDb(t);
  const write = createSeedWriter(db);

  assert.throws(() =>
    transaction(db, () => {
      write(seedRow({ id: 1 }));
      write(seedRow({ id: 2 }));
      throw new Error('중간에 깨졌다');
    }),
  );

  // 15만 행을 넣다 중간에 깨지면 절반만 남은 인덱스가 되므로 되돌려야 한다
  assert.equal(indexStats(db).games, 0);
});

test('트랜잭션이 끝나면 결과를 돌려준다', async (t) => {
  const db = await withDb(t);
  const write = createSeedWriter(db);
  const count = transaction(db, () => {
    write(seedRow({ id: 1 }));
    write(seedRow({ id: 2 }));
    return 2;
  });
  assert.equal(count, 2);
  assert.equal(indexStats(db).games, 2);
});

// --- 시드 쓰기 -------------------------------------------------------------

test('랭킹 덤프 한 행을 넣고 랭크를 남긴다', async (t) => {
  const db = await withDb(t);
  createSeedWriter(db)(seedRow(), { strategygames: 42 });

  const game = db.prepare('SELECT * FROM games WHERE id = 1').get();
  assert.equal(game.name, 'Tidepool');
  assert.equal(game.rank_overall, 100);
  assert.equal(game.fetched_at, null, '시드 상태에서는 상세를 안 받았다');

  const ranks = db.prepare('SELECT rank_type, rank_value FROM ranks WHERE game_id = 1 ORDER BY rank_type').all();
  assert.deepEqual(rows(ranks), [
    { rank_type: 'boardgame', rank_value: 100 },
    { rank_type: 'strategygames', rank_value: 42 },
  ]);
});

test('같은 행을 두 번 넣어도 하나다', async (t) => {
  const db = await withDb(t);
  const write = createSeedWriter(db);
  write(seedRow({ rank_overall: 100 }), {});
  write(seedRow({ rank_overall: 90 }), {});

  assert.equal(indexStats(db).games, 1);
  assert.equal(db.prepare('SELECT rank_overall FROM games WHERE id = 1').get().rank_overall, 90);
});

test('랭크가 빠지면 지운다', async (t) => {
  const db = await withDb(t);
  const write = createSeedWriter(db);
  write(seedRow({ rank_overall: 100 }), { strategygames: 42 });
  write(seedRow({ rank_overall: null }), { strategygames: null });

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ranks WHERE game_id = 1').get().n, 0);
  assert.equal(indexStats(db).ranked, 0);
});

test('시드를 다시 돌려도 받아둔 상세를 지우지 않는다', async (t) => {
  // 덤프를 새로 받아 다시 시드하면 17분짜리 hydrate 결과가 날아가서는 안 된다
  const db = await withDb(t);
  createGameWriter(db)(gameRow(), 1_700_000_000_000);
  createSeedWriter(db)(seedRow({ rank_overall: 55 }), {});

  const game = db.prepare('SELECT weight, description, fetched_at, rank_overall FROM games WHERE id = 1').get();
  assert.equal(game.weight, 2.1);
  assert.equal(game.description, '조수 웅덩이를 훑는다');
  assert.equal(game.fetched_at, 1_700_000_000_000);
  assert.equal(game.rank_overall, 55, '랭크는 갱신된다');
});

test('이름이 비어 오면 있던 이름을 지우지 않는다', async (t) => {
  const db = await withDb(t);
  const write = createSeedWriter(db);
  write(seedRow({ name: 'Tidepool' }), {});
  write(seedRow({ name: null }), {});
  assert.equal(db.prepare('SELECT name FROM games WHERE id = 1').get().name, 'Tidepool');
});

// --- 상세 쓰기 -------------------------------------------------------------

test('상세를 넣으면 메커니즘과 카테고리와 디자이너가 연결된다', async (t) => {
  const db = await withDb(t);
  createGameWriter(db)(gameRow());

  const stats = indexStats(db);
  assert.equal(stats.hydrated, 1);
  assert.equal(stats.mechanics, 1);
  assert.equal(stats.categories, 1);

  const linked = db
    .prepare(`
      SELECT m.name FROM mechanics m
      JOIN game_mechanics gm ON gm.mechanic_id = m.id
      WHERE gm.game_id = 1
    `)
    .all();
  assert.deepEqual(rows(linked), [{ name: 'Hand Management' }]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_designers WHERE game_id = 1').get().n, 1);
});

test('다시 넣으면 예전 연결이 남지 않는다', async (t) => {
  // 게임의 메커니즘이 바뀌었을 때 예전 것이 남으면 조합 분석이 조용히 틀어진다
  const db = await withDb(t);
  const write = createGameWriter(db);
  write(gameRow({ mechanics: [{ id: 2040, name: 'Hand Management' }] }));
  write(gameRow({ mechanics: [{ id: 2004, name: 'Set Collection' }] }));

  const linked = db.prepare('SELECT mechanic_id FROM game_mechanics WHERE game_id = 1').all();
  assert.deepEqual(rows(linked), [{ mechanic_id: 2004 }]);
  // 메커니즘 목록 자체는 둘 다 남는다. 다른 게임이 쓸 수 있다
  assert.equal(indexStats(db).mechanics, 2);
});

test('랭크도 다시 넣을 때 갈아치운다', async (t) => {
  const db = await withDb(t);
  const write = createGameWriter(db);
  write(gameRow({ ranks: [{ type: 'boardgame', value: 100 }, { type: 'thematic', value: 20 }] }));
  write(gameRow({ ranks: [{ type: 'boardgame', value: 99 }] }));

  const ranks = db.prepare('SELECT rank_type, rank_value FROM ranks WHERE game_id = 1').all();
  assert.deepEqual(rows(ranks), [{ rank_type: 'boardgame', rank_value: 99 }]);
});

test('분류가 비어 있어도 죽지 않는다', async (t) => {
  const db = await withDb(t);
  createGameWriter(db)(gameRow({ mechanics: [], categories: undefined, designers: [] }));
  assert.equal(indexStats(db).hydrated, 1);
  assert.equal(indexStats(db).mechanics, 0);
});

// --- hydrate 대상 고르기 ---------------------------------------------------

test('상세를 안 받은 게임을 랭크 순으로 돌려준다', async (t) => {
  const db = await withDb(t);
  const seed = createSeedWriter(db);
  transaction(db, () => {
    seed(seedRow({ id: 1, rank_overall: 300 }), {});
    seed(seedRow({ id: 2, rank_overall: 100 }), {});
    seed(seedRow({ id: 3, rank_overall: 200 }), {});
  });

  assert.deepEqual(pendingHydration(db), [2, 3, 1]);
  assert.deepEqual(pendingHydration(db, { limit: 2 }), [2, 3]);
});

test('이미 받은 게임과 랭크 없는 게임은 빼놓는다', async (t) => {
  const db = await withDb(t);
  const seed = createSeedWriter(db);
  seed(seedRow({ id: 1, rank_overall: 100 }), {});
  seed(seedRow({ id: 2, rank_overall: null }), {});
  createGameWriter(db)(gameRow({ id: 3, rank_overall: 50 }));

  assert.deepEqual(pendingHydration(db), [1]);
});

test('확장은 기본으로 빼고 옵션을 주면 넣는다', async (t) => {
  // 20000개를 받는데 확장이 섞이면 본편 자리를 잡아먹는다
  const db = await withDb(t);
  const seed = createSeedWriter(db);
  seed(seedRow({ id: 1, rank_overall: 100 }), {});
  seed(seedRow({ id: 2, rank_overall: 50, is_expansion: true }), {});

  assert.deepEqual(pendingHydration(db), [1]);
  assert.deepEqual(pendingHydration(db, { includeExpansions: true }), [2, 1]);
});

// --- 응답 캐시 -------------------------------------------------------------

test('캐시에 넣은 값을 그대로 읽는다', async (t) => {
  const db = await withDb(t);
  writeCache(db, 'https://example.com/a', { items: [1, 2] }, 60_000);
  assert.deepEqual(readCache(db, 'https://example.com/a'), { items: [1, 2] });
});

test('없는 주소는 null 이다', async (t) => {
  const db = await withDb(t);
  assert.equal(readCache(db, 'https://example.com/none'), null);
});

test('TTL 이 지나면 없는 것으로 본다', async (t) => {
  const db = await withDb(t);
  writeCache(db, 'https://example.com/old', { a: 1 }, -1);
  assert.equal(readCache(db, 'https://example.com/old'), null);
});

test('같은 주소를 다시 넣으면 덮어쓴다', async (t) => {
  const db = await withDb(t);
  writeCache(db, 'https://example.com/a', { v: 1 }, 60_000);
  writeCache(db, 'https://example.com/a', { v: 2 }, 60_000);

  assert.deepEqual(readCache(db, 'https://example.com/a'), { v: 2 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM http_cache').get().n, 1);
});

test('본문이 깨져 있으면 캐시를 버린다', async (t) => {
  const db = await withDb(t);
  db.prepare('INSERT INTO http_cache (url, status, body, fetched_at, ttl) VALUES (?, 200, ?, ?, ?)')
    .run('https://example.com/bad', '{잘린 JSON', Date.now(), 60_000);
  assert.equal(readCache(db, 'https://example.com/bad'), null);
});
