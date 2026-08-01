import '../tools/lib/quiet.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openDb, setMeta } from '../tools/bgg/db.mjs';
import { checkFreshness, dateFromDumpName } from '../tools/bgg/freshness.mjs';

const DAY = 24 * 60 * 60 * 1000;

async function memoryDb() {
  return openDb(':memory:');
}

test('파일명에서 날짜를 뽑는다', () => {
  assert.equal(dateFromDumpName('boardgames_ranks_2026-08-01.zip').toISOString().slice(0, 10), '2026-08-01');
  assert.equal(dateFromDumpName('boardgames_ranks_2025-12-31.csv').toISOString().slice(0, 10), '2025-12-31');
  assert.equal(dateFromDumpName('ranks.zip'), null);
  assert.equal(dateFromDumpName(''), null);
  assert.equal(dateFromDumpName(undefined), null);
});

test('시드한 적이 없으면 알리지 않는다', async () => {
  const db = await memoryDb();
  assert.equal(checkFreshness(db), null);
});

test('90일 이내면 알리지 않는다', async () => {
  const db = await memoryDb();
  const now = Date.UTC(2026, 7, 1);
  setMeta(db, 'ranks_source_date', new Date(now - 89 * DAY).toISOString());
  assert.equal(checkFreshness(db, { now }), null);
});

test('90일을 넘으면 며칠 지났는지와 다음 행동을 알려준다', async () => {
  const db = await memoryDb();
  const now = Date.UTC(2026, 7, 1);
  setMeta(db, 'ranks_source_date', new Date(now - 120 * DAY).toISOString());
  setMeta(db, 'ranks_source_file', 'boardgames_ranks_2026-04-03.zip');

  const stale = checkFreshness(db, { now });
  assert.equal(stale.days, 120);
  assert.equal(stale.source, 'boardgames_ranks_2026-04-03.zip');
  assert.match(stale.action, /data\/ranks\//);
  assert.match(stale.action, /seed/);
});

test('기준일을 조정할 수 있다', async () => {
  const db = await memoryDb();
  const now = Date.UTC(2026, 7, 1);
  setMeta(db, 'ranks_source_date', new Date(now - 40 * DAY).toISOString());

  assert.equal(checkFreshness(db, { now }), null, '기본 90일이면 통과');
  assert.equal(checkFreshness(db, { now, maxAgeDays: 30 }).days, 40, '30일 기준이면 걸림');
});

test('날짜가 깨져 있으면 조용히 넘어간다', async () => {
  const db = await memoryDb();
  setMeta(db, 'ranks_source_date', '날짜가 아님');
  assert.equal(checkFreshness(db), null);
});
