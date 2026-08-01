import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCsv, parseCsvToArray, toNumber } from '../tools/lib/csv.mjs';

test('헤더를 키로 쓴 객체를 만든다', () => {
  const rows = parseCsvToArray('id,name\n1,Brass\n2,Ark Nova\n');
  assert.deepEqual(rows, [
    { id: '1', name: 'Brass' },
    { id: '2', name: 'Ark Nova' },
  ]);
});

test('따옴표 안의 쉼표를 필드 구분자로 보지 않는다', () => {
  const rows = parseCsvToArray('id,name,year\n224517,"Brass: Birmingham",2018\n');
  assert.equal(rows[0].name, 'Brass: Birmingham');
  assert.equal(rows[0].year, '2018');

  const withComma = parseCsvToArray('id,name\n1,"Ticket to Ride, Europe"\n');
  assert.equal(withComma[0].name, 'Ticket to Ride, Europe');
});

test('두 개의 따옴표를 하나로 푼다', () => {
  const rows = parseCsvToArray('id,name\n1,"He said ""go"""\n');
  assert.equal(rows[0].name, 'He said "go"');
});

test('따옴표 안의 줄바꿈을 유지한다', () => {
  const rows = parseCsvToArray('id,note\n1,"첫 줄\n둘째 줄"\n2,단순\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].note, '첫 줄\n둘째 줄');
  assert.equal(rows[1].note, '단순');
});

test('CRLF와 BOM을 처리한다', () => {
  const rows = parseCsvToArray('\uFEFFid,name\r\n1,Brass\r\n');
  assert.deepEqual(rows, [{ id: '1', name: 'Brass' }]);
});

test('마지막 줄에 줄바꿈이 없어도 읽는다', () => {
  const rows = parseCsvToArray('id,name\n1,Brass');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Brass');
});

test('빈 줄은 건너뛴다', () => {
  const rows = parseCsvToArray('id,name\n1,Brass\n\n2,Ark Nova\n\n');
  assert.equal(rows.length, 2);
});

test('빈 필드는 빈 문자열로 남긴다', () => {
  const rows = parseCsvToArray('id,rank,thematic_rank\n1,1,\n');
  assert.equal(rows[0].rank, '1');
  assert.equal(rows[0].thematic_rank, '');
});

test('헤더보다 짧은 행은 빈 문자열로 채운다', () => {
  const rows = parseCsvToArray('a,b,c\n1,2\n');
  assert.deepEqual(rows[0], { a: '1', b: '2', c: '' });
});

test('콜백에 인덱스를 넘기고 결과를 쌓지 않는다', () => {
  const seen = [];
  const result = parseCsv('id\n10\n20\n30\n', (row, index) => seen.push([index, row.id]));
  assert.deepEqual(result.header, ['id']);
  assert.equal(result.count, 3);
  assert.deepEqual(seen, [[0, '10'], [1, '20'], [2, '30']]);
});

test('빈 입력에서 죽지 않는다', () => {
  assert.deepEqual(parseCsvToArray(''), []);
  assert.deepEqual(parseCsvToArray('id,name\n'), []);
});

test('toNumber는 빈 값을 null로 본다', () => {
  assert.equal(toNumber('8.39073'), 8.39073);
  assert.equal(toNumber('2018'), 2018);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber('  '), null);
  assert.equal(toNumber(undefined), null);
  assert.equal(toNumber('N/A'), null);
});

test('BGG 랭킹 덤프 형태를 그대로 읽는다', () => {
  const dump = [
    'id,name,yearpublished,rank,bayesaverage,average,usersrated,is_expansion,abstracts_rank,strategygames_rank',
    '224517,"Brass: Birmingham",2018,1,8.39073,8.56081,59445,0,,1',
    '342942,"Ark Nova",2021,2,8.35348,8.53882,62186,0,,2',
  ].join('\n');

  const rows = parseCsvToArray(dump);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Brass: Birmingham');
  assert.equal(toNumber(rows[0].rank), 1);
  assert.equal(toNumber(rows[0].abstracts_rank), null);
  assert.equal(toNumber(rows[1].strategygames_rank), 2);
});
