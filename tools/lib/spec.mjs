/**
 * 컴포넌트 규격 해석.
 *
 * 카드 크기를 코드에 박지 않는다. 게임마다 다르고, 한 게임 안에서도 카드와 타일과
 * 토큰과 보드가 전부 다르다. spec.json 에 mm로 선언하면 픽셀은 여기서 산출한다.
 *
 * art.mjs 와 pnp.mjs 가 둘 다 이 모듈을 쓴다. 같은 계산이 세 군데 있으면
 * 반드시 어긋난다.
 */

/**
 * gpt-image-2 의 크기 제약.
 * 이 값들이 규격 설계에 직접 영향을 준다.
 */
export const IMAGE_LIMITS = {
  multiple: 16,
  maxEdge: 3840,
  minPixels: 655_360,
  maxPixels: 8_294_400,
  maxRatio: 3,
};

/** 용지. 출력은 A4 고정이지만 계산은 일반화해둔다. */
export const SHEETS = {
  A4: { width: 210, height: 297 },
  Letter: { width: 215.9, height: 279.4 },
  A3: { width: 297, height: 420 },
};

const MM_PER_INCH = 25.4;

const snap = (value, multiple) => Math.max(multiple, Math.round(value / multiple) * multiple);

/**
 * mm 크기를 이미지 모델이 받는 픽셀 크기로 바꾼다.
 *
 * 작은 컴포넌트는 최소 픽셀을 넘기려고 키우고(인쇄 시점에 줄인다), 큰 컴포넌트는
 * 최대 픽셀과 최대 변에 맞춰 줄인다. **줄인 경우 유효 DPI를 같이 보고한다.**
 * 보드가 203dpi가 한계라는 걸 모르고 잔글씨를 넣으면 인쇄하고 나서 알게 된다.
 *
 * @param {number} widthMm
 * @param {number} heightMm
 * @param {{ dpi?: number }} [options]
 * @returns {{ ok: boolean, width: number|null, height: number|null, effectiveDpi: number|null,
 *             ratio: number, reason: string|null, options: string[] }}
 */
export function resolvePixels(widthMm, heightMm, { dpi = 300 } = {}) {
  const { multiple, maxEdge, minPixels, maxPixels, maxRatio } = IMAGE_LIMITS;

  if (!(widthMm > 0) || !(heightMm > 0)) {
    return { ok: false, width: null, height: null, effectiveDpi: null, ratio: 0, reason: 'size_mm 은 양수여야 합니다', options: [] };
  }

  const ratio = Math.max(widthMm / heightMm, heightMm / widthMm);
  if (ratio > maxRatio) {
    return {
      ok: false,
      width: null,
      height: null,
      effectiveDpi: null,
      ratio: Number(ratio.toFixed(2)),
      reason: `긴 변과 짧은 변의 비율이 ${ratio.toFixed(2)}:1 입니다. 이미지 모델은 ${maxRatio}:1 까지만 받습니다`,
      options: [
        `${maxRatio}:1 이내로 생성한 뒤 잘라 씁니다`,
        '컴포넌트를 둘로 쪼갭니다',
        '이 컴포넌트는 아트를 포기하고 도형과 텍스트로 갑니다 (spec.json 에서 art: null)',
      ],
    };
  }

  let width = (widthMm / MM_PER_INCH) * dpi;
  let height = (heightMm / MM_PER_INCH) * dpi;

  // 최소/최대 픽셀에 맞춰 비율을 유지한 채 조정한다. 경계에 딱 붙으면 스냅 후
  // 다시 벗어날 수 있어서 살짝 안쪽으로 넣는다.
  const pixels = width * height;
  if (pixels < minPixels) {
    const scale = Math.sqrt(minPixels / pixels) * 1.02;
    width *= scale;
    height *= scale;
  } else if (pixels > maxPixels) {
    const scale = Math.sqrt(maxPixels / pixels) * 0.98;
    width *= scale;
    height *= scale;
  }

  if (Math.max(width, height) > maxEdge) {
    const scale = maxEdge / Math.max(width, height);
    width *= scale;
    height *= scale;
  }

  let snappedWidth = snap(width, multiple);
  let snappedHeight = snap(height, multiple);

  // 스냅 때문에 경계를 넘었으면 긴 변부터 한 칸씩 되돌린다
  while (snappedWidth * snappedHeight > maxPixels || Math.max(snappedWidth, snappedHeight) > maxEdge) {
    if (snappedWidth > snappedHeight) snappedWidth -= multiple;
    else snappedHeight -= multiple;
  }
  while (snappedWidth * snappedHeight < minPixels) {
    if (snappedWidth < snappedHeight) snappedWidth += multiple;
    else snappedHeight += multiple;
  }

  return {
    ok: true,
    width: snappedWidth,
    height: snappedHeight,
    effectiveDpi: Math.round(snappedWidth / (widthMm / MM_PER_INCH)),
    ratio: Number((Math.max(snappedWidth, snappedHeight) / Math.min(snappedWidth, snappedHeight)).toFixed(2)),
    reason: null,
    options: [],
  };
}

/** 인쇄 가능 영역. 용지에서 여백을 뺀 것. */
export function printableArea({ sheet = 'A4', margin_mm = 10 } = {}) {
  const paper = SHEETS[sheet];
  if (!paper) throw new Error(`알 수 없는 용지: ${sheet}. 가능한 값: ${Object.keys(SHEETS).join(', ')}`);
  return {
    sheet,
    width: Number((paper.width - margin_mm * 2).toFixed(2)),
    height: Number((paper.height - margin_mm * 2).toFixed(2)),
    margin: margin_mm,
    paper,
  };
}

/**
 * 컴포넌트 한 종류를 시트에 몇 개씩 몇 장에 나눠 담는지.
 * 세로/가로 두 방향을 다 계산해서 많이 들어가는 쪽을 고른다.
 */
export function sheetLayout(widthMm, heightMm, { count = 1, print = {} } = {}) {
  const { cut_gap_mm: gap = 0 } = print;
  const area = printableArea(print);

  const fit = (w, h) => {
    const cols = Math.floor((area.width + gap) / (w + gap));
    const rows = Math.floor((area.height + gap) / (h + gap));
    return { cols: Math.max(cols, 0), rows: Math.max(rows, 0), perSheet: Math.max(cols, 0) * Math.max(rows, 0) };
  };

  const upright = { ...fit(widthMm, heightMm), rotated: false };
  const sideways = { ...fit(heightMm, widthMm), rotated: true };
  const best = sideways.perSheet > upright.perSheet ? sideways : upright;

  if (best.perSheet === 0) {
    return { fitsOnSheet: false, perSheet: 0, sheets: null, ...best, area };
  }

  return {
    fitsOnSheet: true,
    cols: best.cols,
    rows: best.rows,
    rotated: best.rotated,
    perSheet: best.perSheet,
    sheets: Math.ceil(count / best.perSheet),
    area,
  };
}

/**
 * 시트보다 큰 컴포넌트를 몇 조각으로 나눠 찍을지.
 *
 * **페이지 방향을 양쪽 다 시도한다.** 420x297mm 보드를 세로 A4로 깔면 3x2로 6장이지만
 * 가로로 깔면 2x2로 4장이다. 붙일 이음새가 두 개 줄어드는 건 프로토타입에서 체감이 크다.
 */
export function tilePlan(widthMm, heightMm, { print = {}, overlapMm = 0 } = {}) {
  const area = printableArea(print);

  const candidates = [
    { orientation: 'portrait', cellWidth: area.width, cellHeight: area.height },
    { orientation: 'landscape', cellWidth: area.height, cellHeight: area.width },
  ].map((candidate) => {
    const stepX = candidate.cellWidth - overlapMm;
    const stepY = candidate.cellHeight - overlapMm;
    const cols = Math.ceil(widthMm / stepX);
    const rows = Math.ceil(heightMm / stepY);
    return { ...candidate, cols, rows, sheets: cols * rows };
  });

  candidates.sort((a, b) => a.sheets - b.sheets);
  const best = candidates[0];

  return {
    ...best,
    cellWidth: Number(best.cellWidth.toFixed(2)),
    cellHeight: Number(best.cellHeight.toFixed(2)),
    overlapMm,
    alternatives: candidates.slice(1),
    area,
  };
}

const COMPONENT_TYPES = new Set(['card', 'tile', 'token', 'board', 'mat', 'standee', 'other']);

/**
 * spec.json 을 검증한다.
 *
 * @param {object} spec
 * @param {{ rowCounts?: Record<string, number> }} [context]
 *        rowCounts 는 컴포넌트별 실제 CSV 행 수(또는 수량 합계).
 *        "카드 60장"이라 써놓고 CSV가 54행인 상태를 인쇄 직전이 아니라 지금 잡는다.
 */
export function validateSpec(spec, { rowCounts = {} } = {}) {
  const problems = [];
  const notes = [];
  const add = (message) => problems.push(message);

  if (!spec || typeof spec !== 'object') {
    return { ok: false, problems: ['spec.json 이 객체가 아닙니다'], notes: [] };
  }

  if (!spec.game?.title) add('game.title 이 없습니다');

  const players = spec.game?.players;
  if (!Array.isArray(players) || players.length !== 2 || !(players[0] > 0) || players[1] < players[0]) {
    add('game.players 는 [최소, 최대] 형태의 양수 배열이어야 합니다');
  }

  const print = spec.print ?? {};
  if (print.sheet && !SHEETS[print.sheet]) {
    add(`print.sheet "${print.sheet}" 를 모릅니다. 가능한 값: ${Object.keys(SHEETS).join(', ')}`);
  }
  if (print.margin_mm !== undefined && !(print.margin_mm >= 0)) {
    add('print.margin_mm 은 0 이상이어야 합니다');
  }

  const components = spec.components;
  if (!Array.isArray(components) || components.length === 0) {
    add('components 에 최소 하나는 있어야 합니다');
    return { ok: problems.length === 0, problems, notes };
  }

  const anchorSets = new Set(spec.anchor_sets ?? []);
  const seen = new Set();

  for (const [index, component] of components.entries()) {
    const where = component?.id ? `components[${component.id}]` : `components[${index}]`;

    if (!component?.id) { add(`${where}: id 가 없습니다`); continue; }
    if (!/^[a-z0-9-]+$/.test(component.id)) {
      add(`${where}: id 는 영문 소문자, 숫자, 하이픈만 씁니다. 언어 설정과 무관하게 식별자는 영문입니다`);
    }
    if (seen.has(component.id)) add(`${where}: id 가 중복입니다`);
    seen.add(component.id);

    if (component.type && !COMPONENT_TYPES.has(component.type)) {
      add(`${where}: type "${component.type}" 를 모릅니다. 가능한 값: ${[...COMPONENT_TYPES].join(', ')}`);
    }

    const size = component.size_mm;
    if (!Array.isArray(size) || size.length !== 2 || !(size[0] > 0) || !(size[1] > 0)) {
      add(`${where}: size_mm 은 [가로, 세로] 형태의 양수 배열이어야 합니다`);
    }

    if (!(component.count > 0)) add(`${where}: count 는 1 이상이어야 합니다`);

    if (component.art !== null && component.art !== undefined && !anchorSets.has(component.art)) {
      add(`${where}: art "${component.art}" 가 anchor_sets 에 없습니다. 선언하거나 null 로 두세요`);
    }

    if (component.back && !['shared', 'none', 'per-card'].includes(component.back)) {
      add(`${where}: back 은 shared, none, per-card 중 하나여야 합니다`);
    }

    // 선언 수량과 실제 데이터가 어긋나는지
    const actual = rowCounts[component.id];
    if (actual !== undefined && component.count > 0 && actual !== component.count) {
      add(`${where}: count 는 ${component.count} 인데 CSV 실제 수량은 ${actual} 입니다`);
    }
  }

  return { ok: problems.length === 0, problems, notes };
}
