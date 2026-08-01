import assert from 'node:assert/strict';
import { test } from 'node:test';

import { IMAGE_LIMITS, printableArea, resolvePixels, sheetLayout, tilePlan, validateSpec } from '../tools/lib/spec.mjs';

const withinLimits = (result) => {
  const { multiple, maxEdge, minPixels, maxPixels } = IMAGE_LIMITS;
  assert.equal(result.width % multiple, 0, '가로가 16의 배수여야 한다');
  assert.equal(result.height % multiple, 0, '세로가 16의 배수여야 한다');
  assert.ok(Math.max(result.width, result.height) <= maxEdge, '최대 변을 넘지 않아야 한다');
  assert.ok(result.width * result.height >= minPixels, '최소 픽셀을 넘어야 한다');
  assert.ok(result.width * result.height <= maxPixels, '최대 픽셀을 넘지 않아야 한다');
};

test('포커 카드는 300dpi 근처에서 해석된다', () => {
  const result = resolvePixels(63, 88);
  assert.ok(result.ok);
  withinLimits(result);
  assert.ok(Math.abs(result.effectiveDpi - 300) < 15, `유효 DPI ${result.effectiveDpi}`);
});

test('여러 실제 규격이 전부 제약을 만족한다', () => {
  const sizes = [
    [63, 88],   // 포커
    [44, 68],   // 미니
    [70, 120],  // 타로
    [59, 92],   // 브리지 변형
    [50, 50],   // 정사각 타일
    [80, 80],
  ];
  for (const [w, h] of sizes) {
    const result = resolvePixels(w, h);
    assert.ok(result.ok, `${w}x${h} 가 실패했다: ${result.reason}`);
    withinLimits(result);
  }
});

test('작은 토큰은 최소 픽셀을 넘기려고 키운다', () => {
  // 20x20mm 는 300dpi로 236px, 최소 픽셀에 한참 못 미친다
  const result = resolvePixels(20, 20);
  assert.ok(result.ok);
  withinLimits(result);
  assert.ok(result.effectiveDpi > 300, '키운 만큼 유효 DPI가 올라가야 한다');
});

test('큰 보드는 줄이면서 유효 DPI를 보고한다', () => {
  const result = resolvePixels(420, 297);
  assert.ok(result.ok);
  withinLimits(result);
  // 300dpi로는 최대 픽셀과 최대 변을 둘 다 넘으므로 반드시 낮아진다
  assert.ok(result.effectiveDpi < 300, `보드는 300dpi를 못 낸다 (실제 ${result.effectiveDpi})`);
  assert.ok(result.effectiveDpi > 150, '그래도 인쇄할 만해야 한다');
});

test('비율 3:1 을 넘으면 실패하고 선택지를 알려준다', () => {
  const result = resolvePixels(100, 25);
  assert.equal(result.ok, false);
  assert.match(result.reason, /비율/);
  assert.equal(result.options.length, 3, '잘라 쓰기 / 쪼개기 / 아트 포기');
  assert.ok(result.options.some((option) => option.includes('art: null')));
});

test('3:1 경계는 통과한다', () => {
  assert.equal(resolvePixels(90, 30).ok, true);
  assert.equal(resolvePixels(91, 30).ok, false);
});

test('크기가 0이거나 음수면 실패한다', () => {
  assert.equal(resolvePixels(0, 88).ok, false);
  assert.equal(resolvePixels(63, -1).ok, false);
});

test('A4 여백 9mm 인쇄 영역', () => {
  const area = printableArea({ sheet: 'A4', margin_mm: 9 });
  assert.equal(area.width, 192);
  assert.equal(area.height, 279);
});

test('여백 9mm 에서 포커 카드가 장당 9장이다', () => {
  const layout = sheetLayout(63.5, 88, { count: 54, print: { sheet: 'A4', margin_mm: 9 } });
  assert.equal(layout.perSheet, 9);
  assert.equal(layout.cols, 3);
  assert.equal(layout.rows, 3);
  assert.equal(layout.sheets, 6);
});

test('여백 0.5mm 차이로 포커 3열이 무너진다', () => {
  // 포커 실제 규격은 63.5mm 이고 3열이면 190.5mm. 여백 10mm면 인쇄 영역이
  // 190mm 라 0.5mm 가 모자라서 장당 9장이 8장이 된다. 기본값을 9mm 로 둔 이유다.
  assert.equal(sheetLayout(63.5, 88, { count: 54, print: { margin_mm: 9.75 } }).perSheet, 9);
  assert.equal(sheetLayout(63.5, 88, { count: 54, print: { margin_mm: 10 } }).perSheet, 8);
});

test('워드 기본 좁게(12.7mm)는 더 손해다', () => {
  const wide = sheetLayout(63.5, 88, { count: 54, print: { margin_mm: 12.7 } });
  assert.ok(wide.perSheet < 9, `실제 ${wide.perSheet}`);
});

test('회전하면 더 들어가는 경우 회전을 고른다', () => {
  const layout = sheetLayout(88, 63.5, { count: 10, print: { margin_mm: 9 } });
  assert.equal(layout.perSheet, 9);
  assert.equal(layout.rotated, true);
});

test('시트보다 큰 컴포넌트는 안 들어간다고 알려준다', () => {
  const layout = sheetLayout(420, 297, { count: 1, print: { margin_mm: 9 } });
  assert.equal(layout.fitsOnSheet, false);
  assert.equal(layout.sheets, null);
});

test('보드 타일 분할은 페이지 방향을 양쪽 다 계산한다', () => {
  const plan = tilePlan(420, 297, { print: { sheet: 'A4', margin_mm: 9 } });
  assert.equal(plan.sheets, 4, '가로로 깔면 2x2 로 4장이다');
  assert.equal(plan.orientation, 'landscape');
  assert.ok(plan.alternatives[0].sheets > plan.sheets, '세로는 더 많이 든다');
});

test('겹침을 주면 조각이 늘어날 수 있다', () => {
  const tight = tilePlan(400, 400, { print: { margin_mm: 9 } });
  const overlapped = tilePlan(400, 400, { print: { margin_mm: 9 }, overlapMm: 20 });
  assert.ok(overlapped.sheets >= tight.sheets);
});

// ---------------------------------------------------------------------------

function sampleSpec(overrides = {}) {
  return {
    game: { title: '테스트 게임', players: [2, 4], playtime: [45, 60] },
    print: { sheet: 'A4', margin_mm: 10, dpi: 300, cut_gap_mm: 0 },
    anchor_sets: ['character', 'scene'],
    components: [
      { id: 'action-card', type: 'card', label: '액션 카드', count: 60, size_mm: [63, 88], art: 'character', back: 'shared' },
      { id: 'terrain-tile', type: 'tile', label: '지형 타일', count: 24, size_mm: [50, 50], art: 'scene', back: 'none' },
    ],
    ...overrides,
  };
}

test('정상 spec 은 통과한다', () => {
  const result = validateSpec(sampleSpec());
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
});

test('선언 수량과 CSV 실제 수량이 다르면 잡는다', () => {
  const result = validateSpec(sampleSpec(), { rowCounts: { 'action-card': 54 } });
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /count 는 60 인데 CSV 실제 수량은 54/);
});

test('anchor_sets 에 없는 art 를 잡는다', () => {
  const spec = sampleSpec();
  spec.components[0].art = 'artifact';
  const result = validateSpec(spec);
  assert.match(result.problems[0], /anchor_sets 에 없습니다/);
});

test('art: null 은 정상이다', () => {
  const spec = sampleSpec();
  spec.components[0].art = null;
  assert.equal(validateSpec(spec).ok, true);
});

test('컴포넌트 id 는 영문 소문자여야 한다', () => {
  const spec = sampleSpec();
  spec.components[0].id = '액션카드';
  const result = validateSpec(spec);
  assert.match(result.problems.join(' '), /영문 소문자/);
});

test('id 중복을 잡는다', () => {
  const spec = sampleSpec();
  spec.components[1].id = 'action-card';
  assert.match(validateSpec(spec).problems.join(' '), /중복/);
});

test('필수 필드가 없으면 잡는다', () => {
  assert.match(validateSpec({}).problems.join(' '), /game\.title/);
  assert.match(validateSpec({ game: { title: 'x', players: [2, 4] } }).problems.join(' '), /components/);
  assert.equal(validateSpec(null).ok, false);
});

test('back 값과 용지 이름을 검사한다', () => {
  const spec = sampleSpec();
  spec.components[0].back = 'flipped';
  spec.print.sheet = 'B5';
  const joined = validateSpec(spec).problems.join(' ');
  assert.match(joined, /back 은 shared, none, per-card/);
  assert.match(joined, /print\.sheet/);
});
