#!/usr/bin/env node
/**
 * BGG 조사 CLI. 셸로 부르면 stdout에 JSON을 낸다.
 *
 * 에이전트가 XML 파싱이나 레이트 리밋을 신경 쓰지 않게 하는 게 목적이다.
 * 진행 로그는 stderr로 보내서 stdout이 항상 파싱 가능하게 유지한다.
 *
 *   node tools/bgg/cli.mjs seed
 *   node tools/bgg/cli.mjs hydrate --top 20000
 *   node tools/bgg/cli.mjs search "trick taking"
 *   node tools/bgg/cli.mjs similar --mechanics "Trick-taking,Set Collection" --weight 2:3
 *   node tools/bgg/cli.mjs mechanics --with "Worker Placement"
 *   node tools/bgg/cli.mjs stats
 */

import '../lib/quiet.mjs';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { parseCsv, toNumber } from '../lib/csv.mjs';
import { loadEnv, requireEnv, ROOT } from '../lib/env.mjs';
import { readTextFromZip } from '../lib/unzip.mjs';
import { createBggClient } from './client.mjs';
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
} from './db.mjs';
import { dateFromDumpName, DUMP_URL, nudgeIfStale } from './freshness.mjs';
import { normalizeSearchItem, normalizeThing } from './normalize.mjs';

const RANKS_DIR = path.join(ROOT, 'data', 'ranks');
const SEARCH_TTL = 24 * 60 * 60 * 1000;

/** 덤프 CSV의 부문별 랭크 컬럼을 rank_type 으로 매핑한다. */
const SUBRANK_COLUMNS = {
  abstracts_rank: 'abstracts',
  cgs_rank: 'cgs',
  childrensgames_rank: 'childrensgames',
  familygames_rank: 'familygames',
  partygames_rank: 'partygames',
  strategygames_rank: 'strategygames',
  thematic_rank: 'thematic',
  wargames_rank: 'wargames',
};

const log = (...args) => console.error(...args);

function output(command, payload, extra = {}) {
  process.stdout.write(`${JSON.stringify({ command, ...extra, ...payload }, null, 2)}\n`);
}

function bail(message, hint) {
  const lines = [message];
  if (hint) lines.push('', hint);
  console.error(`\n${lines.join('\n')}\n`);
  process.exit(1);
}

/*
 * BGG 덤프는 "랭크 없음"을 빈 값이 아니라 0으로 적는다. 179,596행 중 148,562행이
 * rank=0 이므로, 0을 유효한 랭크로 받으면 하이드레이션이 랭크 순으로 정렬할 때
 * 아무도 모르는 게임부터 20,000개를 채우게 된다.
 */
const toRank = (value) => {
  const parsed = toNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
};

/** `2:3` 또는 `2.0:3.5` 형태의 범위를 파싱한다. */
function parseRange(value) {
  if (!value) return null;
  const [min, max] = String(value).split(':');
  return { min: toNumber(min), max: toNumber(max) };
}

// ---------------------------------------------------------------------------
// seed
// ---------------------------------------------------------------------------

function findLatestDump() {
  let names;
  try {
    names = readdirSync(RANKS_DIR).filter((name) => name.endsWith('.zip') || name.endsWith('.csv'));
  } catch {
    return null;
  }
  if (names.length === 0) return null;

  // 파일명의 날짜가 곧 버전이다. 없으면 수정 시각으로 대체한다.
  const scored = names.map((name) => {
    const full = path.join(RANKS_DIR, name);
    const fromName = dateFromDumpName(name);
    return { name, full, when: fromName ? fromName.getTime() : statSync(full).mtimeMs };
  });
  scored.sort((a, b) => b.when - a.when);
  return scored[0];
}

async function commandSeed(values) {
  const db = await openDb();

  if (values.crawl) {
    return commandCrawl(db, values);
  }

  const explicit = values.csv ? { name: path.basename(values.csv), full: path.resolve(values.csv) } : null;
  const dump = explicit ?? findLatestDump();

  if (!dump) {
    bail(
      `data/ranks/ 에 랭킹 덤프가 없습니다.`,
      [
        `  방법 1 (빠름, 수동 30초)`,
        `    ${DUMP_URL} 에서 브라우저로 로그인해 zip을 받아`,
        `    data/ranks/ 에 파일명 그대로 넣고 다시 실행하세요.`,
        ``,
        `  방법 2 (완전 자동, 약 6시간)`,
        `    node tools/bgg/cli.mjs seed --crawl`,
        `    로그인이 필요 없는 대신 ID 공간 전체를 훑습니다. --resume 으로 이어받습니다.`,
      ].join('\n'),
    );
  }

  log(`덤프 읽는 중: ${dump.name}`);
  const buffer = readFileSync(dump.full);
  const { name: entryName, text } = dump.full.endsWith('.zip')
    ? readTextFromZip(buffer)
    : { name: dump.name, text: buffer.toString('utf8') };

  const writeSeed = createSeedWriter(db);
  let inserted = 0;

  const { header, count } = transaction(db, () =>
    parseCsv(text, (row) => {
      const id = toNumber(row.id);
      if (id === null) return;

      const subranks = {};
      for (const [column, type] of Object.entries(SUBRANK_COLUMNS)) {
        if (column in row) subranks[type] = toRank(row[column]);
      }

      writeSeed(
        {
          id,
          name: row.name ?? null,
          year: toNumber(row.yearpublished),
          is_expansion: toNumber(row.is_expansion) === 1,
          rating_avg: toNumber(row.average),
          rating_bayes: toNumber(row.bayesaverage),
          rank_overall: toRank(row.rank),
          users_rated: toNumber(row.usersrated),
        },
        subranks,
      );
      inserted += 1;
    }),
  );

  if (!header.includes('id')) {
    bail(`${entryName} 이 BGG 랭킹 덤프 형식이 아닙니다.`, `첫 줄: ${header.join(',')}`);
  }

  const dumpDate = dateFromDumpName(dump.name) ?? new Date(statSync(dump.full).mtimeMs);
  setMeta(db, 'ranks_source_file', dump.name);
  setMeta(db, 'ranks_source_date', dumpDate.toISOString());

  const stats = indexStats(db);
  output('seed', {
    source: dump.name,
    entry: entryName,
    dumpDate: dumpDate.toISOString().slice(0, 10),
    rowsRead: count,
    gamesUpserted: inserted,
    index: stats,
    next:
      stats.hydrated === 0
        ? 'node tools/bgg/cli.mjs hydrate — 메커니즘과 무게는 여기서 채워집니다'
        : null,
  });
}

/**
 * 덤프 없이 ID 공간을 훑는다. 로그인이 전혀 필요 없는 대신 오래 걸린다.
 * 중단돼도 meta.crawl_cursor 로 이어받는다.
 */
async function commandCrawl(db, values) {
  const token = requireEnv('BGG_API_TOKEN', '토큰은 https://boardgamegeek.com/applications 에서 발급받습니다.');
  const maxId = Number(values['max-id'] ?? 450_000);
  const start = values.resume ? Number(getMeta(db, 'crawl_cursor', 1)) : 1;

  const client = createBggClient({ token, onProgress: (message) => log(`  ${message}`) });
  const writeGame = createGameWriter(db);

  log(`ID ${start}부터 ${maxId}까지 훑습니다. 20개씩, 초당 약 1요청.`);
  log('중단해도 --resume 으로 이어받습니다.');

  let found = 0;
  for (let id = start; id <= maxId; id += client.chunkSize) {
    const ids = Array.from({ length: Math.min(client.chunkSize, maxId - id + 1) }, (_, i) => id + i);
    const items = await client.thing(ids, { stats: true });
    const games = items.map(normalizeThing).filter(Boolean);

    transaction(db, () => {
      for (const game of games) writeGame(game);
    });
    found += games.length;

    setMeta(db, 'crawl_cursor', id + client.chunkSize);
    if ((id - start) % (client.chunkSize * 25) === 0) {
      log(`  ${id}/${maxId} — 지금까지 ${found}개`);
    }
  }

  output('seed', { mode: 'crawl', scannedTo: maxId, found, index: indexStats(db) });
}

// ---------------------------------------------------------------------------
// hydrate
// ---------------------------------------------------------------------------

async function commandHydrate(values) {
  const token = requireEnv('BGG_API_TOKEN', '토큰은 https://boardgamegeek.com/applications 에서 발급받습니다.');
  const db = await openDb();
  const stats = indexStats(db);

  if (stats.games === 0) {
    bail('인덱스가 비어 있습니다.', '먼저 "node tools/bgg/cli.mjs seed" 를 실행하세요.');
  }

  const top = Number(values.top ?? 20_000);
  const ids = pendingHydration(db, { limit: top, includeExpansions: Boolean(values.expansions) });

  if (ids.length === 0) {
    output('hydrate', { fetched: 0, message: '받을 게 없습니다. 이미 전부 채워져 있습니다.', index: stats });
    return;
  }

  const client = createBggClient({ token, onProgress: (message) => log(`  ${message}`) });
  const writeGame = createGameWriter(db);

  const estimateMinutes = Math.ceil((ids.length / client.chunkSize) / 55);
  log(`${ids.length}개를 받습니다. ${client.chunkSize}개씩, 약 ${estimateMinutes}분 예상.`);
  log('중단해도 이미 받은 것은 건너뛰므로 다시 실행하면 이어집니다.');

  let done = 0;
  for (let i = 0; i < ids.length; i += client.chunkSize) {
    const chunk = ids.slice(i, i + client.chunkSize);
    const items = await client.thing(chunk, { stats: true });
    const games = items.map(normalizeThing).filter(Boolean);

    transaction(db, () => {
      for (const game of games) writeGame(game);
    });
    done += games.length;

    if (i % (client.chunkSize * 20) === 0 && i > 0) {
      log(`  ${done}/${ids.length}`);
    }
  }

  output('hydrate', { requested: ids.length, fetched: done, index: indexStats(db) });
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

async function commandSearch(positionals, values) {
  const query = positionals.join(' ').trim();
  if (!query) bail('검색어가 필요합니다.', '예: node tools/bgg/cli.mjs search "trick taking"');

  const db = await openDb();
  const stale = nudgeIfStale(db, { open: !values['no-open'] });
  const cacheKey = `search:${query}:${values.exact ? 'exact' : 'fuzzy'}`;

  const cached = readCache(db, cacheKey);
  if (cached) {
    output('search', { query, cached: true, count: cached.length, results: cached }, { stale });
    return;
  }

  const token = requireEnv('BGG_API_TOKEN', '토큰은 https://boardgamegeek.com/applications 에서 발급받습니다.');
  const client = createBggClient({ token, onProgress: (message) => log(`  ${message}`) });
  const items = await client.search(query, { exact: Boolean(values.exact) });
  const results = items.map(normalizeSearchItem).filter(Boolean);

  writeCache(db, cacheKey, results, SEARCH_TTL);
  output('search', { query, cached: false, count: results.length, results }, { stale });
}

// ---------------------------------------------------------------------------
// similar
// ---------------------------------------------------------------------------

/** 메커니즘 이름을 대소문자 무시 부분일치로 찾는다. */
function resolveMechanics(db, names) {
  const resolved = [];
  const unknown = [];
  const lookup = db.prepare('SELECT id, name FROM mechanics WHERE lower(name) LIKE ? ORDER BY length(name) ASC LIMIT 5');

  for (const raw of names) {
    const needle = raw.trim().toLowerCase();
    if (!needle) continue;
    const matches = lookup.all(`%${needle}%`);
    if (matches.length === 0) unknown.push(raw);
    else resolved.push(matches[0]);
  }
  return { resolved, unknown };
}

function requireHydratedIndex(db) {
  const stats = indexStats(db);
  if (stats.hydrated === 0) {
    bail(
      '인덱스에 상세 데이터가 없습니다.',
      [
        '메커니즘과 무게는 thing API에서만 나옵니다. 랭킹 CSV에는 없습니다.',
        '',
        '  1. node tools/bgg/cli.mjs seed',
        '  2. node tools/bgg/cli.mjs hydrate',
      ].join('\n'),
    );
  }
  return stats;
}

async function commandSimilar(values) {
  const db = await openDb();
  requireHydratedIndex(db);
  const stale = nudgeIfStale(db, { open: !values['no-open'] });

  const names = String(values.mechanics ?? '').split(',').map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) {
    bail('--mechanics 가 필요합니다.', '예: --mechanics "Trick-taking,Set Collection"');
  }

  const { resolved, unknown } = resolveMechanics(db, names);
  if (resolved.length === 0) {
    bail(
      `메커니즘을 찾지 못했습니다: ${unknown.join(', ')}`,
      'node tools/bgg/cli.mjs mechanics 로 인덱스에 있는 이름을 확인하세요.',
    );
  }

  const weight = parseRange(values.weight);
  const players = toNumber(values.players);
  const limit = Number(values.limit ?? 15);

  const conditions = ['g.is_expansion = 0', 'g.fetched_at IS NOT NULL'];
  const params = resolved.map((mechanic) => mechanic.id);

  if (weight?.min !== null && weight?.min !== undefined) { conditions.push('g.weight >= ?'); params.push(weight.min); }
  if (weight?.max !== null && weight?.max !== undefined) { conditions.push('g.weight <= ?'); params.push(weight.max); }
  if (players !== null) { conditions.push('g.min_players <= ? AND g.max_players >= ?'); params.push(players, players); }
  if (values.category) { conditions.push('EXISTS (SELECT 1 FROM game_categories gc JOIN categories c ON c.id = gc.category_id WHERE gc.game_id = g.id AND lower(c.name) LIKE ?)'); params.push(`%${String(values.category).toLowerCase()}%`); }

  const rows = db
    .prepare(`
      SELECT g.id, g.name, g.year, g.weight, g.rating_bayes, g.rating_avg, g.rank_overall,
             g.min_players, g.max_players, g.best_players, g.min_time, g.max_time, g.users_rated,
             COUNT(DISTINCT gm.mechanic_id) AS matched
      FROM games g
      JOIN game_mechanics gm ON gm.game_id = g.id AND gm.mechanic_id IN (${resolved.map(() => '?').join(',')})
      WHERE ${conditions.join(' AND ')}
      GROUP BY g.id
      ORDER BY matched DESC, g.rating_bayes DESC NULLS LAST
      LIMIT ?
    `)
    .all(...params, limit);

  const mechanicsOf = db.prepare(`
    SELECT m.name FROM game_mechanics gm JOIN mechanics m ON m.id = gm.mechanic_id
    WHERE gm.game_id = ? ORDER BY m.name
  `);

  const results = rows.map((row) => ({
    ...row,
    url: `https://boardgamegeek.com/boardgame/${row.id}`,
    mechanics: mechanicsOf.all(row.id).map((entry) => entry.name),
  }));

  output(
    'similar',
    {
      query: { mechanics: resolved.map((mechanic) => mechanic.name), weight, players: players ?? null, category: values.category ?? null },
      unresolved: unknown,
      count: results.length,
      results,
    },
    { stale },
  );
}

// ---------------------------------------------------------------------------
// mechanics
// ---------------------------------------------------------------------------

async function commandMechanics(values) {
  const db = await openDb();
  requireHydratedIndex(db);
  const stale = nudgeIfStale(db, { open: !values['no-open'] });

  const total = db.prepare('SELECT COUNT(DISTINCT game_id) AS n FROM game_mechanics').get().n;

  // --with 없이 부르면 그냥 목록을 낸다. 이름 확인용.
  if (!values.with) {
    const all = db
      .prepare(`
        SELECT m.id, m.name, COUNT(gm.game_id) AS games
        FROM mechanics m LEFT JOIN game_mechanics gm ON gm.mechanic_id = m.id
        GROUP BY m.id ORDER BY games DESC
      `)
      .all();
    output('mechanics', { totalGames: total, count: all.length, mechanics: all }, { stale });
    return;
  }

  const { resolved, unknown } = resolveMechanics(db, [String(values.with)]);
  if (resolved.length === 0) {
    bail(`메커니즘을 찾지 못했습니다: ${unknown.join(', ')}`, '--with 없이 실행하면 전체 목록을 봅니다.');
  }
  const target = resolved[0];

  const targetGames = db.prepare('SELECT COUNT(*) AS n FROM game_mechanics WHERE mechanic_id = ?').get(target.id).n;

  /*
   * lift = P(Y | X) / P(Y)
   *
   * 1보다 크면 X와 자주 붙어 나오고, 1보다 작으면 개별적으로는 흔한데 X와는
   * 거의 안 쓰인다는 뜻이다. 후자가 설계 공간의 빈 자리 후보다.
   */
  const rows = db
    .prepare(`
      SELECT m.id, m.name,
             COUNT(*) AS together,
             (SELECT COUNT(*) FROM game_mechanics x WHERE x.mechanic_id = m.id) AS games
      FROM game_mechanics gm
      JOIN mechanics m ON m.id = gm.mechanic_id
      WHERE gm.game_id IN (SELECT game_id FROM game_mechanics WHERE mechanic_id = ?)
        AND gm.mechanic_id != ?
      GROUP BY m.id
    `)
    .all(target.id, target.id);

  const scored = rows
    .map((row) => ({
      ...row,
      shareWithTarget: Number((row.together / targetGames).toFixed(4)),
      baseShare: Number((row.games / total).toFixed(4)),
      lift: Number((row.together / targetGames / (row.games / total)).toFixed(2)),
    }))
    .filter((row) => row.games >= 20); // 표본이 적으면 lift가 요동친다

  const common = [...scored].sort((a, b) => b.together - a.together).slice(0, 15);
  const rare = [...scored].sort((a, b) => a.lift - b.lift).slice(0, 15);

  // 이 게임들에 한 번도 같이 안 나온 메커니즘
  const pairedIds = new Set(rows.map((row) => row.id));
  const never = db
    .prepare(`
      SELECT m.id, m.name, COUNT(gm.game_id) AS games
      FROM mechanics m JOIN game_mechanics gm ON gm.mechanic_id = m.id
      GROUP BY m.id HAVING games >= 100 ORDER BY games DESC
    `)
    .all()
    .filter((row) => row.id !== target.id && !pairedIds.has(row.id))
    .slice(0, 15);

  output(
    'mechanics',
    {
      target: { ...target, games: targetGames },
      totalGames: total,
      note: 'lift 는 P(Y|X)/P(Y) 입니다. 1보다 크면 자주 붙고, 작으면 개별적으로는 흔한데 이 메커니즘과는 잘 안 쓰인다는 뜻입니다.',
      commonlyPairedWith: common,
      rarelyPairedWith: rare,
      neverPairedWith: never,
    },
    { stale },
  );
}

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

async function commandStats(values) {
  const db = await openDb();
  const stale = nudgeIfStale(db, { open: !values['no-open'] });
  const stats = indexStats(db);

  const hints = [];
  if (stats.games === 0) hints.push('node tools/bgg/cli.mjs seed — 랭킹 덤프에서 ID와 랭크를 임포트합니다');
  else if (stats.hydrated === 0) hints.push('node tools/bgg/cli.mjs hydrate — 메커니즘과 무게를 채웁니다');

  output('stats', { index: stats, hints }, { stale });
}

// ---------------------------------------------------------------------------

const USAGE = `
BGG 조사 CLI

  seed [--csv <경로>] [--crawl] [--resume] [--max-id N]
      랭킹 덤프에서 ID와 랭크를 임포트합니다. 인자 없이 부르면 data/ranks/ 에서
      가장 최신 덤프를 자동으로 고릅니다. --crawl 은 덤프 없이 ID 공간을 훑습니다.

  hydrate [--top 20000] [--expansions]
      상세(메커니즘, 카테고리, 무게, 인원, 시간)를 받아 채웁니다. 20개씩 요청합니다.

  search "<질의>" [--exact]
      BGG 검색. 결과는 24시간 캐시됩니다.

  similar --mechanics "A,B" [--weight 2:3] [--players 4] [--category "..."] [--limit 15]
      로컬 인덱스에서 유사작을 찾습니다.

  mechanics [--with "Worker Placement"]
      --with 없이는 메커니즘 목록을. 주면 같이 쓰이는 조합과 거의 안 쓰이는 조합을 냅니다.

  stats
      인덱스 상태.

공통 옵션
  --no-open   덤프가 오래됐을 때 브라우저를 열지 않습니다.
`;

async function main() {
  loadEnv();

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: false,
    options: {
      csv: { type: 'string' },
      crawl: { type: 'boolean' },
      resume: { type: 'boolean' },
      'max-id': { type: 'string' },
      top: { type: 'string' },
      expansions: { type: 'boolean' },
      exact: { type: 'boolean' },
      mechanics: { type: 'string' },
      with: { type: 'string' },
      weight: { type: 'string' },
      players: { type: 'string' },
      category: { type: 'string' },
      limit: { type: 'string' },
      'no-open': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const [command, ...rest] = positionals;

  if (values.help || !command) {
    console.error(USAGE);
    process.exit(command ? 0 : 1);
  }

  switch (command) {
    case 'seed': return commandSeed(values);
    case 'hydrate': return commandHydrate(values);
    case 'search': return commandSearch(rest, values);
    case 'similar': return commandSimilar(values);
    case 'mechanics': return commandMechanics(values);
    case 'stats': return commandStats(values);
    default:
      bail(`알 수 없는 커맨드: ${command}`, USAGE);
  }
}

main().catch((error) => {
  console.error(`\n${error.message}\n`);
  if (process.env.DEBUG) console.error(error);
  process.exit(1);
});
