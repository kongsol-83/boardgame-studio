#!/usr/bin/env node
/**
 * 프린트 앤 플레이 PDF 렌더러.
 *
 * spec.json 이 배치를 결정한다. A4 고정, 여백은 설정값(기본 9mm).
 *
 * **아트 없이도 나오는 게 중요하다.** 룰이 흔들리는 동안 카드 아트를 뽑으면 카드가
 * 바뀔 때마다 다시 뽑아야 한다. 도형과 텍스트만으로 먼저 플레이테스트를 돌려 룰을
 * 굳히고 아트는 그다음에 얹는다.
 *
 *   node tools/pnp.mjs <slug>
 *   node tools/pnp.mjs <slug> --component action-card
 *   node tools/pnp.mjs <slug> --check          텍스트 오버플로만 검사, 렌더 안 함
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import PDFDocument from 'pdfkit';

import { parseCsvToArray, toNumber } from './lib/csv.mjs';
import { loadConfig } from './lib/config.mjs';
import { ROOT } from './lib/env.mjs';
import { fontHelp, needsUnicodeFont, resolveFont } from './lib/font.mjs';
import { printableArea, SHEETS } from './lib/spec.mjs';

/** mm -> PDF 포인트. 1pt = 1/72 인치. */
const pt = (mm) => (mm * 72) / 25.4;

const CUT_LINE_WIDTH = 0.4;
const CUT_OVERHANG_MM = 3;
const CARD_PADDING_MM = 3;
/** 손으로 자르면 1~2mm는 틀어진다. 잘리면 안 되는 요소는 이만큼 안쪽에 둔다. */
const SAFE_MARGIN_MM = 3;

/**
 * 글자 크기. 포커 카드(63.5mm)를 기준으로 잡고 카드 폭에 비례해 조정한다.
 *
 * 하한이 중요하다. 보드게임 카드 본문은 8pt가 실질적 하한이고, 그 아래로 내려가면
 * 인쇄물에서 읽히지 않는다. 카드가 작다고 무한정 줄이면 인쇄해봐야 못 읽는 카드가
 * 나오므로, 안 들어가면 줄이지 말고 --check 로 잡아서 문구를 줄이는 게 맞다.
 *
 * 수치는 본문보다 크게 둔다. 코스트와 파워는 한눈에 읽혀야 하는 정보다.
 */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function typeScale(widthMm, scale = 1) {
  const k = (widthMm / 63.5) * scale;
  return {
    id: clamp(6 * k, 4.5, 8),
    title: clamp(13 * k, 8.5, 19),
    stats: clamp(10.5 * k, 8, 15),
    body: clamp(9.5 * k, 7.5, 13),
  };
}

const ID_COLUMNS = ['id', 'card_id', 'component_id', 'code'];
const NAME_COLUMNS = ['name', 'title', '이름', '제목'];
const TEXT_COLUMNS = ['text', 'rules', 'effect', '효과', '텍스트'];
const ART_COLUMNS = ['art_file', 'art', 'image'];
const QTY_COLUMNS = ['qty', 'quantity', 'count', '수량'];
const SKIP_NUMERIC = new Set([...QTY_COLUMNS, ...ID_COLUMNS]);

function bail(message, hint) {
  console.error(`\n${message}${hint ? `\n\n${hint}` : ''}\n`);
  process.exit(1);
}

const pick = (columns, candidates) =>
  columns.find((column) => candidates.includes(column.toLowerCase())) ?? null;

/**
 * 페이지 방향까지 고려한 격자.
 * 카드를 회전시키는 대신 종이를 눕힌다. 결과는 같고 좌표 변환이 없어 안전하다.
 */
function pageGrid(widthMm, heightMm, print) {
  const paper = SHEETS[print.sheet];
  const gap = print.cut_gap_mm ?? 0;

  const options = [
    { orientation: 'portrait', pw: paper.width, ph: paper.height },
    { orientation: 'landscape', pw: paper.height, ph: paper.width },
  ].map((option) => {
    const areaW = option.pw - print.margin_mm * 2;
    const areaH = option.ph - print.margin_mm * 2;
    const cols = Math.floor((areaW + gap) / (widthMm + gap));
    const rows = Math.floor((areaH + gap) / (heightMm + gap));
    return { ...option, areaW, areaH, cols: Math.max(cols, 0), rows: Math.max(rows, 0), perSheet: Math.max(cols, 0) * Math.max(rows, 0) };
  });

  options.sort((a, b) => b.perSheet - a.perSheet);
  return options[0];
}

/** qty 만큼 행을 펼친다. 같은 카드를 여러 장 넣는 경우가 흔하다. */
function expandRows(rows, qtyColumn) {
  if (!qtyColumn) return rows;
  const expanded = [];
  for (const row of rows) {
    const qty = Math.max(1, Math.round(toNumber(row[qtyColumn]) ?? 1));
    for (let i = 0; i < qty; i++) expanded.push(row);
  }
  return expanded;
}

function loadComponentRows(slug, componentId) {
  const file = path.join(ROOT, 'projects', slug, 'components', `${componentId}.csv`);
  if (!existsSync(file)) return null;
  return parseCsvToArray(readFileSync(file, 'utf8'));
}

// ---------------------------------------------------------------------------
// 카드 한 장 그리기
// ---------------------------------------------------------------------------

function drawCard(doc, { x, y, widthMm, heightMm, row, columns, type, artDir }) {
  const w = pt(widthMm);
  const h = pt(heightMm);

  doc.save();
  doc.rect(x, y, w, h).lineWidth(0.3).strokeColor('#999999').stroke();

  /*
   * art_file 컬럼이 있으면 그걸 쓰고, 없으면 규칙으로 찾는다.
   * art.mjs 가 art/<comp-id>/<row-id>.png 로 저장하므로 손으로 채울 이유가 없다.
   */
  const artColumn = pick(columns, ART_COLUMNS);
  const idColumnForArt = pick(columns, ID_COLUMNS);
  const artFile =
    (artColumn ? String(row[artColumn] ?? '').trim() : '') ||
    (idColumnForArt && row[idColumnForArt] ? `${row[idColumnForArt]}.png` : '');

  if (artFile) {
    const artPath = path.isAbsolute(artFile) ? artFile : path.join(artDir, artFile);
    if (existsSync(artPath)) {
      try {
        // cover 로 채워서 잘려도 흰 테두리가 안 나오게 한다
        doc.save().rect(x, y, w, h).clip();
        doc.image(artPath, x, y, { cover: [w, h], align: 'center', valign: 'center' });
        doc.restore();
        doc.restore();
        return;
      } catch {
        // 이미지가 깨졌으면 도형으로 폴백한다
        doc.restore();
        doc.save();
      }
    }
  }

  // --- 아트 없는 폴백: 도형과 텍스트 -----------------------------------------
  const pad = pt(CARD_PADDING_MM);
  const safe = pt(SAFE_MARGIN_MM);
  const innerX = x + safe;
  const innerW = w - safe * 2;
  let cursor = y + safe;

  const idColumn = pick(columns, ID_COLUMNS);
  const nameColumn = pick(columns, NAME_COLUMNS);
  const textColumn = pick(columns, TEXT_COLUMNS);
  const numericColumns = columns.filter(
    (column) => !SKIP_NUMERIC.has(column.toLowerCase()) && toNumber(row[column]) !== null,
  );

  if (idColumn && row[idColumn]) {
    doc.fontSize(type.id).fillColor('#999999');
    doc.text(String(row[idColumn]), innerX, cursor, { width: innerW, align: 'left', lineBreak: false });
    cursor += type.id + 2;
  }

  if (nameColumn && row[nameColumn]) {
    doc.fontSize(type.title).fillColor('#111111');
    doc.text(String(row[nameColumn]), innerX, cursor, { width: innerW, align: 'center', ellipsis: true, height: type.title * 2.4 });
    cursor += type.title + 5;
  }

  // 수치는 이름 아래 한 줄에 모은다. 본문보다 크게 둔다
  if (numericColumns.length > 0) {
    const label = numericColumns.map((column) => `${column} ${row[column]}`).join('  ·  ');
    doc.fontSize(type.stats).fillColor('#333333');
    doc.text(label, innerX, cursor, { width: innerW, align: 'center', ellipsis: true, lineBreak: false });
    cursor += type.stats + 5;
  }

  if (textColumn && row[textColumn]) {
    doc.fontSize(type.body).fillColor('#222222');
    const available = y + h - safe - cursor;
    if (available > type.body) {
      doc.text(String(row[textColumn]), innerX, cursor + pad * 0.3, {
        width: innerW,
        height: available,
        align: 'left',
        ellipsis: true,
        lineGap: 1.5,
      });
    }
  }

  doc.restore();
}

/** 격자 경계에 재단선을 긋는다. 블록 밖으로 조금 삐져나오게 해서 자를 대기 편하게 한다. */
function drawCutLines(doc, { originX, originY, cols, rows, widthMm, heightMm, gapMm }) {
  const cellW = pt(widthMm + gapMm);
  const cellH = pt(heightMm + gapMm);
  const blockW = cols * cellW - pt(gapMm);
  const blockH = rows * cellH - pt(gapMm);
  const over = pt(CUT_OVERHANG_MM);

  doc.save().lineWidth(CUT_LINE_WIDTH).strokeColor('#000000');

  for (let c = 0; c <= cols; c++) {
    const x = originX + c * cellW - (c === cols ? pt(gapMm) : 0);
    doc.moveTo(x, originY - over).lineTo(x, originY + blockH + over).stroke();
  }
  for (let r = 0; r <= rows; r++) {
    const y = originY + r * cellH - (r === rows ? pt(gapMm) : 0);
    doc.moveTo(originX - over, y).lineTo(originX + blockW + over, y).stroke();
  }
  doc.restore();
}

// ---------------------------------------------------------------------------
// 오버사이즈: 여러 장에 나눠 찍기
// ---------------------------------------------------------------------------

function renderTiled(doc, component, { print, artDir, fontSize }) {
  const [widthMm, heightMm] = component.size_mm;
  const paper = SHEETS[print.sheet];
  const options = [
    { orientation: 'portrait', cw: paper.width - print.margin_mm * 2, ch: paper.height - print.margin_mm * 2 },
    { orientation: 'landscape', cw: paper.height - print.margin_mm * 2, ch: paper.width - print.margin_mm * 2 },
  ].map((option) => ({
    ...option,
    cols: Math.ceil(widthMm / option.cw),
    rows: Math.ceil(heightMm / option.ch),
  }));
  options.forEach((option) => { option.sheets = option.cols * option.rows; });
  options.sort((a, b) => a.sheets - b.sheets);
  const plan = options[0];

  const artColumn = component.art_file ?? null;
  const artPath = artColumn ? path.join(artDir, artColumn) : null;

  let piece = 0;
  for (let r = 0; r < plan.rows; r++) {
    for (let c = 0; c < plan.cols; c++) {
      piece += 1;
      doc.addPage({ size: print.sheet, layout: plan.orientation, margin: 0 });

      const ox = pt(print.margin_mm);
      const oy = pt(print.margin_mm);
      const pieceW = pt(Math.min(plan.cw, widthMm - c * plan.cw));
      const pieceH = pt(Math.min(plan.ch, heightMm - r * plan.ch));

      // 조각 경계에서 잘라 배치하므로 이음새에서 그림이 이어진다
      if (artPath && existsSync(artPath)) {
        doc.save().rect(ox, oy, pieceW, pieceH).clip();
        doc.image(artPath, ox - pt(c * plan.cw), oy - pt(r * plan.ch), {
          width: pt(widthMm),
          height: pt(heightMm),
        });
        doc.restore();
      }

      doc.rect(ox, oy, pieceW, pieceH).lineWidth(CUT_LINE_WIDTH).strokeColor('#000000').stroke();

      // 이어 붙일 때 어느 장이 어디인지 헷갈리지 않게 한다
      doc.fontSize(fontSize).fillColor('#000000');
      doc.text(
        `${component.label ?? component.id}  ${piece}/${plan.sheets}  (${r + 1}행 ${c + 1}열)`,
        ox + pt(2),
        oy + pieceH + pt(2),
        { width: pieceW, lineBreak: false },
      );

      // 정렬 마크
      const mark = pt(4);
      doc.lineWidth(0.3).strokeColor('#666666');
      for (const [mx, my] of [[ox, oy], [ox + pieceW, oy], [ox, oy + pieceH], [ox + pieceW, oy + pieceH]]) {
        doc.moveTo(mx - mark, my).lineTo(mx + mark, my).stroke();
        doc.moveTo(mx, my - mark).lineTo(mx, my + mark).stroke();
      }
    }
  }
  return plan.sheets;
}

// ---------------------------------------------------------------------------
// 텍스트 오버플로 검사
// ---------------------------------------------------------------------------

function checkOverflow(doc, component, rows, type) {
  if (rows.length === 0) return [];
  const columns = Object.keys(rows[0]);
  const textColumn = pick(columns, TEXT_COLUMNS);
  if (!textColumn) return [];

  const idColumn = pick(columns, ID_COLUMNS);
  const nameColumn = pick(columns, NAME_COLUMNS);
  const [widthMm, heightMm] = component.size_mm;
  const innerW = pt(widthMm - SAFE_MARGIN_MM * 2);

  // 이름과 수치 줄이 차지하고 남는 높이
  const used = type.id + 2 + type.title + 5 + type.stats + 5;
  const available = pt(heightMm - SAFE_MARGIN_MM * 2) - used;

  const over = [];
  doc.fontSize(type.body);
  for (const row of rows) {
    const text = String(row[textColumn] ?? '').trim();
    if (!text) continue;
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

// ---------------------------------------------------------------------------

const USAGE = `
프린트 앤 플레이 PDF

  node tools/pnp.mjs <slug> [--component <id>] [--check]

  --component  특정 컴포넌트만
  --check      렌더하지 않고 카드에 텍스트가 들어가는지만 검사

아트가 없으면 도형과 텍스트로 렌더합니다. 룰을 굳히기 전에 프로토타입을 뽑아
플레이테스트를 돌리려는 것이므로 아트는 나중에 얹으면 됩니다.
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    component: { type: 'string' },
    check: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const slug = positionals[0];
if (values.help || !slug) {
  console.error(USAGE);
  process.exit(slug ? 0 : 1);
}

const specFile = path.join(ROOT, 'projects', slug, 'spec.json');
if (!existsSync(specFile)) {
  bail(`${path.relative(ROOT, specFile)} 이 없습니다.`, '/bgs-components 로 컴포넌트 규격을 먼저 정의하세요.');
}

const spec = JSON.parse(readFileSync(specFile, 'utf8'));
const print = { ...loadConfig().print, ...(spec.print ?? {}) };
const area = printableArea(print);

const targets = (spec.components ?? []).filter(
  (component) => !values.component || component.id === values.component,
);
if (targets.length === 0) {
  bail(
    values.component ? `컴포넌트 "${values.component}" 를 spec.json 에서 찾지 못했습니다.` : 'spec.json 에 컴포넌트가 없습니다.',
    `있는 컴포넌트: ${(spec.components ?? []).map((component) => component.id).join(', ') || '없음'}`,
  );
}

// 폰트: 데이터에 비ASCII가 있으면 CJK 지원 폰트가 필요하다
const allRows = new Map();
let anyNonAscii = false;
for (const component of targets) {
  const rows = loadComponentRows(slug, component.id) ?? [];
  allRows.set(component.id, rows);
  if (!anyNonAscii && rows.some((row) => Object.values(row).some(needsUnicodeFont))) anyNonAscii = true;
}
if (!anyNonAscii) anyNonAscii = needsUnicodeFont(spec.game?.title ?? '');

let font;
try {
  font = resolveFont({ configured: print.font, requireCjk: anyNonAscii });
} catch (error) {
  // 지정한 폰트가 없을 때. 스택 트레이스는 여기서 도움이 안 된다
  bail(error.message);
}
if (!font) bail(fontHelp(anyNonAscii));

const artRoot = path.join(ROOT, 'projects', slug, 'art');

// --- --check: 렌더 없이 검사만 ----------------------------------------------
if (values.check) {
  const probe = new PDFDocument({ autoFirstPage: false });
  probe.font(font.path);

  const report = targets.map((component) => {
    const rows = allRows.get(component.id) ?? [];
    const type = typeScale(component.size_mm?.[0] ?? 63.5, print.font_scale ?? 1);
    const rounded = Object.fromEntries(Object.entries(type).map(([key, value]) => [key, Number(value.toFixed(1))]));
    return { component: component.id, rows: rows.length, fontSizes: rounded, overflow: checkOverflow(probe, component, rows, type) };
  });
  probe.end();

  const total = report.reduce((sum, entry) => sum + entry.overflow.length, 0);
  process.stdout.write(
    `${JSON.stringify(
      {
        command: 'pnp check',
        slug,
        font: font.label,
        overflowing: total,
        note: total > 0
          ? '카드에 안 들어가는 텍스트입니다. 문구를 줄이거나 카드를 키우세요. 인쇄한 뒤 발견하면 룰을 다시 써야 합니다.'
          : '전부 들어갑니다.',
        components: report,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(total > 0 ? 1 : 0);
}

// --- 렌더 -------------------------------------------------------------------
const outDir = path.join(ROOT, 'projects', slug, 'pnp');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const outFile = path.join(outDir, `${slug}-${stamp}.pdf`);

const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
const stream = (await import('node:fs')).createWriteStream(outFile);
doc.pipe(stream);
doc.font(font.path);

const summary = [];

for (const component of targets) {
  const [widthMm, heightMm] = component.size_mm ?? [];
  if (!(widthMm > 0) || !(heightMm > 0)) continue;

  const artDir = path.join(artRoot, component.id);
  const type = typeScale(widthMm, print.font_scale ?? 1);

  // 시트보다 크면 조각으로
  if (widthMm > area.width || heightMm > area.height) {
    const sheets = renderTiled(doc, component, { print, artDir: artRoot, fontSize: 9 });
    summary.push({ component: component.id, mode: 'tiled', sheets: sheets * (component.count ?? 1) });
    continue;
  }

  const rows = allRows.get(component.id) ?? [];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const qtyColumn = pick(columns, QTY_COLUMNS);
  const items = rows.length > 0
    ? expandRows(rows, qtyColumn)
    : Array.from({ length: component.count ?? 0 }, () => ({}));

  if (items.length === 0) {
    summary.push({ component: component.id, mode: 'skipped', reason: 'CSV도 count도 없습니다' });
    continue;
  }

  const grid = pageGrid(widthMm, heightMm, print);
  if (grid.perSheet === 0) {
    summary.push({ component: component.id, mode: 'skipped', reason: '인쇄 영역에 한 장도 안 들어갑니다' });
    continue;
  }

  const gapMm = print.cut_gap_mm ?? 0;
  const cellW = pt(widthMm + gapMm);
  const cellH = pt(heightMm + gapMm);
  const originX = pt(print.margin_mm);
  const originY = pt(print.margin_mm);

  let pages = 0;
  for (let start = 0; start < items.length; start += grid.perSheet) {
    const page = items.slice(start, start + grid.perSheet);
    doc.addPage({ size: print.sheet, layout: grid.orientation, margin: 0 });
    pages += 1;

    const usedCols = Math.min(grid.cols, page.length);
    const usedRows = Math.ceil(page.length / grid.cols);
    drawCutLines(doc, { originX, originY, cols: usedCols, rows: usedRows, widthMm, heightMm, gapMm });

    page.forEach((row, index) => {
      const col = index % grid.cols;
      const rowIndex = Math.floor(index / grid.cols);
      drawCard(doc, {
        x: originX + col * cellW,
        y: originY + rowIndex * cellH,
        widthMm,
        heightMm,
        row,
        columns,
        type,
        artDir,
      });
    });

    /*
     * 뒷면. 양면 인쇄에서 종이는 **용지 중심**을 기준으로 뒤집힌다. 격자 블록의
     * 중심이 아니다. 포커 카드 3열은 190.5mm인데 인쇄 영역은 192mm라 블록이
     * 오른쪽으로 1.5mm 남으므로, 블록 안에서 열만 뒤집으면 그만큼 어긋난다.
     *
     * 그래서 각 카드의 뒷면 위치를 용지 폭에서 직접 계산한다.
     *   backX = 용지폭 - 앞면X - 카드폭
     */
    if (component.back === 'shared') {
      const paper = SHEETS[print.sheet];
      const pageWidthPt = pt(grid.orientation === 'landscape' ? paper.height : paper.width);
      const cardW = pt(widthMm);
      const mirrorX = (frontX) => pageWidthPt - frontX - cardW;

      doc.addPage({ size: print.sheet, layout: grid.orientation, margin: 0 });
      pages += 1;

      // 재단선도 뒤집힌 블록 위치에 긋는다
      const blockW = usedCols * cellW - pt(gapMm);
      drawCutLines(doc, {
        originX: pageWidthPt - originX - blockW,
        originY,
        cols: usedCols,
        rows: usedRows,
        widthMm,
        heightMm,
        gapMm,
      });

      const backImage = path.join(artRoot, `${component.id}-back.png`);
      page.forEach((_, index) => {
        const x = mirrorX(originX + (index % grid.cols) * cellW);
        const y = originY + Math.floor(index / grid.cols) * cellH;
        if (existsSync(backImage)) {
          doc.save().rect(x, y, cardW, pt(heightMm)).clip();
          doc.image(backImage, x, y, { cover: [cardW, pt(heightMm)] });
          doc.restore();
        } else {
          doc.rect(x, y, cardW, pt(heightMm)).lineWidth(0.3).fillAndStroke('#eeeeee', '#999999');
        }
      });
    }
  }

  summary.push({
    component: component.id,
    mode: 'sheet',
    items: items.length,
    orientation: grid.orientation,
    grid: `${grid.cols}x${grid.rows}`,
    perSheet: grid.perSheet,
    pages,
    back: component.back ?? 'none',
  });
}

doc.end();
await new Promise((resolve, reject) => {
  stream.on('finish', resolve);
  stream.on('error', reject);
});

process.stdout.write(
  `${JSON.stringify(
    {
      command: 'pnp',
      slug,
      output: path.relative(ROOT, outFile),
      sheet: print.sheet,
      margin_mm: print.margin_mm,
      font: font.label,
      components: summary,
      note: '아트가 없는 컴포넌트는 도형과 텍스트로 렌더됩니다. 룰을 굳힌 뒤 /bgs-art 로 얹으세요.',
    },
    null,
    2,
  )}\n`,
);
