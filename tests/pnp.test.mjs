import assert from 'node:assert/strict';
import test from 'node:test';

import PDFDocument from 'pdfkit';

import {
  checkOverflow,
  expandRows,
  pageGrid,
  pick,
  pt,
  QTY_COLUMNS,
  typeScale,
} from '../tools/lib/pnp.mjs';

const A4 = { sheet: 'A4', margin_mm: 9, cut_gap_mm: 0 };

// --- 단위 -------------------------------------------------------------------

test('1인치는 72포인트다', () => {
  assert.equal(pt(25.4), 72);
  assert.equal(pt(0), 0);
  // A4 폭 210mm
  assert.equal(Math.round(pt(210)), 595);
});

// --- 글자 크기 --------------------------------------------------------------

test('포커 카드가 기준값을 낸다', () => {
  assert.deepEqual(typeScale(63.5), { id: 6, title: 13, stats: 10.5, body: 9.5 });
});

test('카드가 작아도 본문은 7.5pt 아래로 내려가지 않는다', () => {
  // 보드게임 카드 본문은 8pt 언저리가 실질적 하한이다. 무한정 줄이면 인쇄해봐야
  // 못 읽는 카드가 나오므로, 안 들어가면 문구를 줄이거나 카드를 키우는 게 답이다
  for (const width of [20, 10, 1, 0.1]) {
    const type = typeScale(width);
    assert.equal(type.body, 7.5, `${width}mm 에서 본문이 ${type.body}`);
    assert.equal(type.stats, 8);
    assert.equal(type.title, 8.5);
    assert.equal(type.id, 4.5);
  }
});

test('카드가 커도 상한에서 멈춘다', () => {
  const board = typeScale(420);
  assert.deepEqual(board, { id: 8, title: 19, stats: 15, body: 13 });
  assert.deepEqual(typeScale(4200), board, '더 커져도 같다');
});

test('수치는 본문보다 크다', () => {
  // 코스트와 파워는 한눈에 읽혀야 하는 정보다
  for (const width of [20, 44, 63.5, 70, 120]) {
    const type = typeScale(width);
    assert.ok(type.stats >= type.body, `${width}mm 에서 수치가 본문보다 작다`);
  }
});

test('font_scale 이 비례로 곱해진다', () => {
  const base = typeScale(63.5);
  const bigger = typeScale(63.5, 1.15);
  assert.ok(bigger.body > base.body);
  assert.equal(Number(bigger.body.toFixed(3)), Number((base.body * 1.15).toFixed(3)));
});

test('font_scale 을 키워도 상한은 지킨다', () => {
  assert.equal(typeScale(63.5, 10).body, 13);
});

// --- 컬럼 고르기 ------------------------------------------------------------

test('대소문자를 무시하고 컬럼을 찾는다', () => {
  assert.equal(pick(['ID', 'Name'], ['id', 'card_id']), 'ID');
  assert.equal(pick(['cost', 'QTY'], QTY_COLUMNS), 'QTY');
});

test('후보에 없으면 null 이다', () => {
  assert.equal(pick(['cost', 'power'], ['id']), null);
  assert.equal(pick([], ['id']), null);
});

// --- 수량 펼치기 ------------------------------------------------------------

test('수량 컬럼이 없으면 그대로 둔다', () => {
  const rows = [{ id: 'A' }, { id: 'B' }];
  assert.equal(expandRows(rows, null), rows);
});

test('수량만큼 행을 늘린다', () => {
  const rows = [{ id: 'A', qty: '3' }, { id: 'B', qty: '1' }];
  assert.deepEqual(expandRows(rows, 'qty').map((row) => row.id), ['A', 'A', 'A', 'B']);
});

test('수량이 비어 있거나 이상하면 한 장으로 본다', () => {
  // 여기가 틀리면 인쇄 장수가 조용히 어긋난다
  const rows = [{ id: 'A', qty: '' }, { id: 'B', qty: '0' }, { id: 'C', qty: '-2' }, { id: 'D', qty: 'many' }];
  assert.deepEqual(expandRows(rows, 'qty').map((row) => row.id), ['A', 'B', 'C', 'D']);
});

test('소수는 반올림한다', () => {
  assert.equal(expandRows([{ id: 'A', qty: '2.6' }], 'qty').length, 3);
});

// --- 격자 -------------------------------------------------------------------

test('포커 카드는 A4 세로에 3x3으로 9장 들어간다', () => {
  const grid = pageGrid(63.5, 88, A4);
  assert.equal(grid.orientation, 'portrait');
  assert.equal(grid.cols, 3);
  assert.equal(grid.rows, 3);
  assert.equal(grid.perSheet, 9);
});

test('여백을 10mm로 올리면 세로 3열이 무너지고 종이를 눕혀 8장을 건진다', () => {
  /*
   * 포커 카드 3열이 190.5mm인데 여백 10mm면 인쇄 영역이 190mm다. 0.5mm 차이로
   * 세로 3열이 2열로 떨어져서 2x3 = 6장이 된다. 그런데 눕히면 4x2 = 8장이라
   * 도구가 눕히는 쪽을 고른다. 그래도 9장에서 한 장을 잃는다.
   */
  const grid = pageGrid(63.5, 88, { ...A4, margin_mm: 10 });
  assert.equal(grid.perSheet, 8);
  assert.equal(grid.orientation, 'landscape');
  assert.equal(grid.cols, 4);
  assert.equal(grid.rows, 2);
});

test('눕히는 쪽이 더 들어가면 종이를 눕힌다', () => {
  // 물때 표시 띠 100x25mm. 카드를 회전시키지 않고 종이 방향을 바꾼다
  const grid = pageGrid(100, 25, A4);
  assert.equal(grid.orientation, 'landscape');
  assert.equal(grid.perSheet, 14);
});

test('시트보다 크면 한 장도 안 들어간다고 말한다', () => {
  const grid = pageGrid(420, 297, A4);
  assert.equal(grid.perSheet, 0);
});

test('간격을 주면 시트당 장수가 줄어든다', () => {
  const tight = pageGrid(63.5, 88, A4);
  const spaced = pageGrid(63.5, 88, { ...A4, cut_gap_mm: 5 });
  assert.ok(spaced.perSheet < tight.perSheet);
});

test('모르는 용지 이름이면 A4로 본다', () => {
  assert.deepEqual(pageGrid(63.5, 88, { sheet: '없는용지', margin_mm: 9 }).perSheet, 9);
});

// --- 텍스트 오버플로 --------------------------------------------------------
//
// pdfkit 내장 폰트로 잰다. 시스템에 한글 폰트가 없는 러너에서도 돌아야 하므로
// 본문은 ASCII로 둔다. 재는 방식은 실제 렌더와 같다.

function measuringDoc() {
  const doc = new PDFDocument({ autoFirstPage: false });
  doc.font('Helvetica');
  return doc;
}

const card = { size_mm: [63.5, 88] };

test('텍스트 컬럼이 없으면 검사할 것이 없다', () => {
  assert.deepEqual(checkOverflow(measuringDoc(), card, [{ id: 'A', cost: 1 }], typeScale(63.5)), []);
});

test('행이 없으면 빈 배열이다', () => {
  assert.deepEqual(checkOverflow(measuringDoc(), card, [], typeScale(63.5)), []);
});

test('짧은 텍스트는 통과한다', () => {
  const rows = [{ id: 'A', name: 'Dive', text: 'Gain two resources.' }];
  assert.deepEqual(checkOverflow(measuringDoc(), card, rows, typeScale(63.5)), []);
});

test('긴 텍스트는 id와 함께 잡아낸다', () => {
  const long = 'Gain two resources. '.repeat(40);
  const rows = [{ id: 'TP99', name: 'Wordy', text: long }];
  const over = checkOverflow(measuringDoc(), card, rows, typeScale(63.5));

  assert.equal(over.length, 1);
  assert.equal(over[0].id, 'TP99');
  assert.equal(over[0].name, 'Wordy');
  assert.ok(over[0].neededMm > over[0].availableMm);
});

test('빈 텍스트는 넘친 것으로 세지 않는다', () => {
  const rows = [{ id: 'A', text: '' }, { id: 'B', text: '   ' }];
  assert.deepEqual(checkOverflow(measuringDoc(), card, rows, typeScale(63.5)), []);
});

test('카드가 작으면 같은 텍스트가 넘친다', () => {
  const text = 'Gain two resources and draw a card.';
  const small = { size_mm: [20, 20] };
  assert.deepEqual(checkOverflow(measuringDoc(), card, [{ id: 'A', text }], typeScale(63.5)), []);
  assert.equal(checkOverflow(measuringDoc(), small, [{ id: 'A', text }], typeScale(20)).length, 1);
});
