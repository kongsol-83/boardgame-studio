/**
 * 인쇄 배치와 글자 크기 계산. 컴포넌트 시트와 룰북 두 렌더러가 함께 쓴다.
 *
 * `tools/pnp.mjs` 에서 떼어냈다. CLI 파일 안에 있으면 프로세스를 띄우지 않고는
 * 테스트할 수 없는데, 여기 있는 값들은 **인쇄하고 나서 알면 늦는** 것들이다.
 * 글자가 8pt 아래로 내려갔는지, 카드가 시트당 몇 장 들어가는지, 텍스트가 카드에
 * 들어가는지는 종이가 나오기 전에 확인해야 한다.
 *
 * pdfkit을 import하지 않는다. 문자열을 재는 것만 문서 객체를 인자로 받는다.
 */

import { toNumber } from './csv.mjs';
import { SHEETS } from './spec.mjs';

/** mm -> PDF 포인트. 1pt = 1/72 인치. */
export const pt = (mm) => (mm * 72) / 25.4;

/** 손으로 자르면 1~2mm는 틀어진다. 잘리면 안 되는 요소는 이만큼 안쪽에 둔다. */
export const SAFE_MARGIN_MM = 3;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * 글자 크기. 포커 카드(63.5mm)를 기준으로 잡고 카드 폭에 비례해 조정한다.
 *
 * **하한이 이 함수의 핵심이다.** 보드게임 카드 본문은 8pt가 실질적 하한이고 그 아래로
 * 내려가면 인쇄물에서 읽히지 않는다. 카드가 작다고 무한정 줄이면 인쇄해봐야 못 읽는
 * 카드가 나오므로, 안 들어가면 줄이지 말고 `--check` 로 잡아서 문구를 줄이는 게 맞다.
 *
 * 수치는 본문보다 크게 둔다. 코스트와 파워는 한눈에 읽혀야 하는 정보다.
 *
 * @param {number} widthMm 컴포넌트 폭
 * @param {number} [scale] spec.json 의 print.font_scale
 */
export function typeScale(widthMm, scale = 1) {
  const k = (widthMm / 63.5) * scale;
  return {
    id: clamp(6 * k, 4.5, 8),
    title: clamp(13 * k, 8.5, 19),
    stats: clamp(10.5 * k, 8, 15),
    body: clamp(9.5 * k, 7.5, 13),
  };
}

/** CSV 컬럼 이름을 짐작하는 후보들. 손으로 매핑을 적지 않게 한다. */
export const ID_COLUMNS = ['id', 'card_id', 'component_id', 'code'];
export const NAME_COLUMNS = ['name', 'title', '이름', '제목'];
export const TEXT_COLUMNS = ['text', 'rules', 'effect', '효과', '텍스트'];
export const ART_COLUMNS = ['art_file', 'art', 'image'];
export const QTY_COLUMNS = ['qty', 'quantity', 'count', '수량'];
export const SKIP_NUMERIC = new Set([...QTY_COLUMNS, ...ID_COLUMNS]);

/** 후보 목록에서 실제로 있는 컬럼을 고른다. 대소문자는 무시한다. */
export const pick = (columns, candidates) =>
  columns.find((column) => candidates.includes(column.toLowerCase())) ?? null;

/**
 * 페이지 방향까지 고려한 격자.
 *
 * 카드를 회전시키는 대신 종이를 눕힌다. 결과는 같고 좌표 변환이 없어 안전하다.
 * 시트당 장수가 많은 쪽을 고른다.
 *
 * @param {number} widthMm
 * @param {number} heightMm
 * @param {{ sheet: string, margin_mm: number, cut_gap_mm?: number }} print
 */
export function pageGrid(widthMm, heightMm, print) {
  const paper = SHEETS[print.sheet] ?? SHEETS.A4;
  const gap = print.cut_gap_mm ?? 0;

  const options = [
    { orientation: 'portrait', pw: paper.width, ph: paper.height },
    { orientation: 'landscape', pw: paper.height, ph: paper.width },
  ].map((option) => {
    const areaW = option.pw - print.margin_mm * 2;
    const areaH = option.ph - print.margin_mm * 2;
    const cols = Math.floor((areaW + gap) / (widthMm + gap));
    const rows = Math.floor((areaH + gap) / (heightMm + gap));
    return {
      ...option,
      areaW,
      areaH,
      cols: Math.max(cols, 0),
      rows: Math.max(rows, 0),
      perSheet: Math.max(cols, 0) * Math.max(rows, 0),
    };
  });

  options.sort((a, b) => b.perSheet - a.perSheet);
  return options[0];
}

/**
 * qty 만큼 행을 펼친다. 같은 카드를 여러 장 넣는 경우가 흔하다.
 * 여기가 틀리면 인쇄 장수가 조용히 어긋난다.
 */
export function expandRows(rows, qtyColumn) {
  if (!qtyColumn) return rows;
  const expanded = [];
  for (const row of rows) {
    // 비어 있으면 1장으로 본다. 0이나 음수도 1로 올린다
    const qty = Math.max(1, Math.round(toNumber(row[qtyColumn]) ?? 1));
    for (let i = 0; i < qty; i++) expanded.push(row);
  }
  return expanded;
}

/**
 * 카드에 텍스트가 들어가는지 본다. 렌더하지 않고 높이만 잰다.
 *
 * 이름과 수치 줄이 차지하는 높이를 뺀 나머지에 본문이 들어가야 한다. 넘치면
 * 글자를 줄이는 게 아니라 문구를 줄이거나 카드를 키우는 쪽이 답이다.
 *
 * @param {{ font: Function, fontSize: Function, heightOfString: Function }} doc
 *        pdfkit 문서. 글자를 재는 데만 쓴다
 * @param {{ size_mm: number[] }} component
 * @param {object[]} rows
 * @param {{ id: number, title: number, stats: number, body: number }} type
 */
export function checkOverflow(doc, component, rows, type) {
  if (rows.length === 0) return [];
  const columns = Object.keys(rows[0]);
  const textColumn = pick(columns, TEXT_COLUMNS);
  if (!textColumn) return [];

  const idColumn = pick(columns, ID_COLUMNS);
  const nameColumn = pick(columns, NAME_COLUMNS);
  const [widthMm, heightMm] = component.size_mm;
  const innerW = pt(widthMm - SAFE_MARGIN_MM * 2);

  const used = type.id + 2 + type.title + 5 + type.stats + 5;
  const available = pt(heightMm - SAFE_MARGIN_MM * 2) - used;

  const over = [];
  doc.fontSize(type.body);
  for (const row of rows) {
    const text = String(row[textColumn] ?? '').trim();
    if (text === '') continue;
    const needed = doc.heightOfString(text, { width: innerW, lineGap: 1.5 });
    if (needed > available) {
      over.push({
        id: idColumn ? row[idColumn] : null,
        name: nameColumn ? row[nameColumn] : null,
        neededMm: Number(((needed * 25.4) / 72).toFixed(1)),
        availableMm: Number(((available * 25.4) / 72).toFixed(1)),
      });
    }
  }
  return over;
}
