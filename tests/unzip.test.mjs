import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

import { listZipEntries, readTextFromZip, readZipEntry } from '../tools/lib/unzip.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 테스트용 최소 ZIP 빌더.
 * 리더가 CRC를 확인하지 않으므로 0으로 둔다. 여기서 검증하려는 건 리더다.
 */
function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const raw = Buffer.from(file.content, 'utf8');
    const method = file.method ?? 8;
    const data = method === 8 ? deflateRawSync(raw) : raw;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const localBlock = Buffer.concat(locals);
  const centralBlock = Buffer.concat(centrals);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBlock.length, 12);
  eocd.writeUInt32LE(localBlock.length, 16);

  return Buffer.concat([localBlock, centralBlock, eocd]);
}

test('deflate로 압축된 엔트리를 푼다', () => {
  const content = 'id,name\n224517,"Brass: Birmingham"\n'.repeat(50);
  const zip = buildZip([{ name: 'boardgames_ranks.csv', content, method: 8 }]);

  const entries = listZipEntries(zip);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'boardgames_ranks.csv');
  assert.equal(entries[0].method, 8);
  assert.ok(entries[0].compressedSize < entries[0].size, '압축이 실제로 줄었어야 한다');

  assert.equal(readZipEntry(zip, entries[0]).toString('utf8'), content);
});

test('압축하지 않은 엔트리도 읽는다', () => {
  const zip = buildZip([{ name: 'plain.txt', content: '압축 안 함', method: 0 }]);
  assert.equal(readTextFromZip(zip).text, '압축 안 함');
});

test('이름으로 엔트리를 고른다', () => {
  const zip = buildZip([
    { name: 'first.csv', content: '첫 번째' },
    { name: 'second.csv', content: '두 번째' },
  ]);

  assert.equal(readTextFromZip(zip, { name: 'second.csv' }).text, '두 번째');
  assert.equal(readTextFromZip(zip).name, 'first.csv', '이름을 안 주면 첫 엔트리');
});

test('없는 이름을 요청하면 들어 있는 것을 알려준다', () => {
  const zip = buildZip([{ name: 'boardgames_ranks.csv', content: 'x' }]);
  assert.throws(
    () => readTextFromZip(zip, { name: 'nope.csv' }),
    /boardgames_ranks\.csv/,
  );
});

test('ZIP이 아니면 명확히 실패한다', () => {
  assert.throws(() => listZipEntries(Buffer.from('이건 zip이 아니다')), /EOCD/);
});

test('UTF-8 파일명을 유지한다', () => {
  const zip = buildZip([{ name: '랭킹덤프.csv', content: '내용' }]);
  assert.equal(listZipEntries(zip)[0].name, '랭킹덤프.csv');
});

// 실제 BGG 덤프가 로컬에 있으면 같이 검증한다. data/ 는 gitignore라 CI에는 없다.
test('실제 BGG 랭킹 덤프를 읽는다', { skip: !existsSync(path.join(ROOT, 'data', 'ranks')) }, () => {
  const dir = path.join(ROOT, 'data', 'ranks');
  const dumps = readdirSync(dir).filter((name) => name.endsWith('.zip'));
  if (dumps.length === 0) return;

  const zip = readFileSync(path.join(dir, dumps[0]));
  const { name, text } = readTextFromZip(zip);

  assert.match(name, /\.csv$/);
  assert.match(text.split('\n')[0], /^id,name,yearpublished,rank/);
  assert.ok(text.length > 1_000_000, '덤프가 예상보다 작습니다');
});
