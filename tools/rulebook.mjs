#!/usr/bin/env node
/**
 * 룰북 PDF 렌더러.
 *
 * `ruleset.md` 하나를 A4 PDF로 만든다. 공모전은 대개 룰북과 컴포넌트 시트를 따로
 * 요구하는데 `pnp.mjs` 는 컴포넌트만 낸다. 룰북을 손으로 변환하면 버전과 날짜가
 * 어긋나므로 같은 파이프라인에 둔다.
 *
 * **여백이 컴포넌트 시트와 다르다.** 9mm는 카드 3열이 무너지지 않는 최댓값이라 나온
 * 값이고 룰북에는 자를 것이 없다. `studio.config.json` 의 `print.rulebook` 이 정한다.
 *
 * **`spec.json` 이 없어도 돈다.** 룰셋만 쓴 단계에서 인쇄해 남에게 읽히는 게 이 도구의
 * 첫 쓰임이다. 있으면 인원과 플레이타임을 제목 아래에 붙인다.
 *
 * 이탤릭은 굵기로 대체되지 않고 본문과 같게 나온다. pdfkit은 파일 하나를 한 굵기로
 * 다루고 기울인 짝 폰트까지 찾아 붙이면 얻는 것보다 실패 경로가 늘어난다. 룰북에서
 * 이탤릭은 드물고, 굵게는 흔해서 굵은 짝만 찾는다. 못 찾으면 획을 덧그린다.
 *
 *   node tools/rulebook.mjs <slug>
 *   node tools/rulebook.mjs <slug> --check    렌더 없이 페이지 수와 넘치는 것만 검사
 *   node tools/rulebook.mjs <slug> --toc      목차를 앞에 붙인다
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import PDFDocument from 'pdfkit';

import { loadConfig } from './lib/config.mjs';
import { localDate } from './lib/datetime.mjs';
import { ROOT } from './lib/env.mjs';
import { fontHelp, needsUnicodeFont, resolveBoldFont, resolveFont } from './lib/font.mjs';
import { parseFrontmatter } from './lib/frontmatter.mjs';
import { outline, parseMarkdown, spansToText } from './lib/markdown.mjs';
import { pt } from './lib/pnp.mjs';
import { SHEETS } from './lib/spec.mjs';

const COLOR = {
  text: '#1a1a1a',
  heading: '#000000',
  muted: '#666666',
  code: '#1f4b6e',
  border: '#c8c8c8',
  tableHead: '#f2f2f2',
  quoteBar: '#cfcfcf',
};

/**
 * 제목 배율과 위아래 여백. 전부 본문 크기의 배수다.
 * 본문 크기만 바꾸면 전체가 같은 비율로 따라온다.
 */
const HEADING = {
  1: { scale: 2.0, before: 0, after: 0.9 },
  2: { scale: 1.45, before: 1.5, after: 0.5 },
  3: { scale: 1.18, before: 1.0, after: 0.35 },
  4: { scale: 1.0, before: 0.8, after: 0.25 },
  5: { scale: 1.0, before: 0.7, after: 0.2 },
  6: { scale: 1.0, before: 0.7, after: 0.2 },
};

/**
 * 도구가 만들어 넣는 문구. 룰북 본문은 쓴 사람의 언어지만 목차와 꼬리말은 도구가
 * 만든다. 아는 언어가 아니면 영어로 간다. 여기 없는 언어를 쓰면서 한국어 꼬리말이
 * 붙는 것보다 영어가 낫다.
 */
const LABELS = {
  ko: { contents: '목차', version: '버전', players: (a, b) => (a === b ? `${a}인` : `${a}~${b}인`), playtime: (a, b) => (a === b ? `${a}분` : `${a}~${b}분`) },
  en: { contents: 'Contents', version: 'Version', players: (a, b) => (a === b ? `${a} players` : `${a}-${b} players`), playtime: (a, b) => (a === b ? `${a} min` : `${a}-${b} min`) },
};

function bail(message, hint) {
  console.error(`\n${message}${hint ? `\n\n${hint}` : ''}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 렌더 컨텍스트
// ---------------------------------------------------------------------------

/**
 * 페이지 하나 분량의 좌표와 폰트 상태를 들고 있는 것.
 * 측정만 하는 경우와 실제로 쓰는 경우가 같은 코드를 타야 페이지 수가 맞는다.
 */
function createContext({ font, boldFont, layout }) {
  const paper = SHEETS[layout.sheet] ?? SHEETS.A4;
  const margin = pt(layout.marginMm);

  const doc = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    size: layout.sheet in SHEETS ? layout.sheet : 'A4',
    margins: { top: margin, bottom: margin, left: margin, right: margin },
    // CreationDate 를 빼면 pdfkit이 파일 ID를 만들다 죽는다. info 를 넘기는 쪽이
    // 채워야 한다. 제목을 넣어두면 PDF 뷰어의 창 제목이 파일명이 아니라 게임 이름이 된다
    info: { Title: layout.title, CreationDate: new Date() },
  });

  try {
    doc.registerFont('body', font.path);
  } catch (error) {
    throw new Error(
      [
        `폰트를 PDF에 넣지 못했습니다: ${font.path}`,
        '',
        `pdfkit이 거부했습니다: ${error.message}`,
        '',
        '.ttc 폰트 컬렉션은 아직 지원하지 않습니다. spec.json 의 print.font 나',
        '환경변수 BGS_PDF_FONT 로 .ttf 또는 .otf 를 지정하세요.',
      ].join('\n'),
    );
  }

  // 굵은 짝을 못 붙여도 진행한다. 그때는 획을 덧그려서 굵게 만든다
  let hasBold = false;
  if (boldFont) {
    try {
      doc.registerFont('bold', boldFont.path);
      hasBold = true;
    } catch {
      hasBold = false;
    }
  }

  const ctx = {
    doc,
    base: layout.basePt,
    hasBold,
    width: pt(paper.width) - margin * 2,
    left: margin,
    pageHeight: pt(paper.height),
    pageWidth: pt(paper.width),
    margin,
    page: 0,
    sections: [],
    warnings: [],
  };

  ctx.bottom = ctx.pageHeight - margin;

  doc.on('pageAdded', () => {
    ctx.page += 1;
  });

  /**
   * 스팬에 맞는 폰트와 색을 걸고, 획을 덧그려야 하는지 알려준다.
   * 굵은 짝 폰트가 없을 때만 덧그린다.
   */
  ctx.applyFont = (span, size) => {
    doc.font(span.bold && ctx.hasBold ? 'bold' : 'body').fontSize(size);
    const color = span.code ? COLOR.code : (span.color ?? COLOR.text);
    doc.fillColor(color);
    const stroke = span.bold && !ctx.hasBold;
    if (stroke) doc.lineWidth(size * 0.02).strokeColor(color);
    return stroke;
  };

  ctx.newPage = () => {
    doc.addPage();
  };

  /** 이만큼 더 쓸 자리가 남았는가. 제목이 페이지 끝에 혼자 남는 것을 막는다. */
  ctx.fits = (height) => doc.y + height <= ctx.bottom;

  return ctx;
}

/**
 * 스팬 목록의 높이. 굵은 글자가 더 넓으므로 굵은 폰트로 재서 넉넉하게 잡는다.
 * 모자라게 재면 다음 블록과 겹친다.
 */
function measureSpans(ctx, spans, { size, width, lineGap }) {
  const text = spansToText(spans);
  if (text === '') return size;
  const anyBold = spans.some((span) => span.bold);
  ctx.doc.font(anyBold && ctx.hasBold ? 'bold' : 'body').fontSize(size);
  return ctx.doc.heightOfString(text, { width, lineGap });
}

/**
 * 인라인 스팬을 이어서 그린다.
 *
 * pdfkit의 `continued` 로 이어 붙이면 굵은 글자와 본문이 한 문단 안에서 섞여도
 * 줄바꿈이 유지된다. 첫 호출에만 좌표를 주고 나머지는 이어받는다.
 */
function drawSpans(ctx, spans, { size, width, x, lineGap, align = 'left' }) {
  const { doc } = ctx;
  const list = spans.filter((span) => span.text !== '');

  if (list.length === 0) {
    doc.y += size + lineGap;
    return;
  }

  list.forEach((span, index) => {
    const stroke = ctx.applyFont(span, size);
    const options = {
      width,
      align,
      lineGap,
      continued: index < list.length - 1,
      stroke,
      fill: true,
      underline: Boolean(span.link),
      link: span.link ?? null,
    };
    if (index === 0) doc.text(span.text, x, doc.y, options);
    else doc.text(span.text, options);
  });
}

// ---------------------------------------------------------------------------
// 블록별 렌더
// ---------------------------------------------------------------------------

function drawHeading(ctx, block) {
  const { doc } = ctx;
  const style = HEADING[block.level] ?? HEADING[4];
  const size = ctx.base * style.scale;
  const lineGap = ctx.base * 0.2;

  doc.y += ctx.base * style.before;

  // 제목만 남고 본문이 다음 장으로 넘어가는 것을 막는다
  const height = measureSpans(ctx, block.spans, { size, width: ctx.width, lineGap });
  if (!ctx.fits(height + ctx.base * 2.4)) ctx.newPage();

  ctx.sections.push({ level: block.level, text: spansToText(block.spans), page: ctx.page });

  const spans = block.spans.map((span) => ({ ...span, bold: true, color: COLOR.heading }));
  drawSpans(ctx, spans, { size, width: ctx.width, x: ctx.left, lineGap });

  // 절 경계가 눈에 보여야 훑어읽기가 된다. 2단계에만 긋는다
  if (block.level === 2) {
    const y = doc.y + ctx.base * 0.15;
    doc.moveTo(ctx.left, y).lineTo(ctx.left + ctx.width, y).lineWidth(0.5).strokeColor(COLOR.border).stroke();
    doc.y = y;
  }

  doc.y += ctx.base * style.after;
}

/** 인용 안에서는 글자를 흐리게 한다. 본문과 같은 검정이면 인용인지 알 수 없다. */
const tint = (spans, muted) => (muted ? spans.map((span) => ({ ...span, color: COLOR.muted })) : spans);

function drawParagraph(ctx, block, { x = ctx.left, width = ctx.width, muted = false } = {}) {
  drawSpans(ctx, tint(block.spans, muted), { size: ctx.base, width, x, lineGap: ctx.base * 0.35 });
  ctx.doc.y += ctx.base * 0.55;
}

function drawList(ctx, block, { x = ctx.left, width = ctx.width, muted = false } = {}) {
  const { doc } = ctx;
  const step = ctx.base * 1.1;
  const marker = ctx.base * 1.4;

  block.items.forEach((item, index) => {
    const indent = item.level * step;
    const bodyX = x + indent + marker;
    const bodyWidth = width - indent - marker;

    const height = measureSpans(ctx, item.spans, { size: ctx.base, width: bodyWidth, lineGap: ctx.base * 0.3 });
    if (!ctx.fits(height)) ctx.newPage();

    const top = doc.y;
    doc.font('body').fontSize(ctx.base).fillColor(COLOR.muted);
    doc.text(block.ordered ? `${index + 1}.` : item.level === 0 ? '•' : '–', x + indent, top, {
      width: marker,
      lineBreak: false,
    });

    doc.y = top;
    drawSpans(ctx, tint(item.spans, muted), { size: ctx.base, width: bodyWidth, x: bodyX, lineGap: ctx.base * 0.3 });
    doc.y += ctx.base * 0.25;
  });

  doc.y += ctx.base * 0.4;
}

function drawQuote(ctx, block) {
  const { doc } = ctx;
  const inset = ctx.base * 1.1;
  const x = ctx.left + inset;
  const width = ctx.width - inset;

  doc.y += ctx.base * 0.2;
  const top = doc.y;
  const startPage = ctx.page;

  for (const inner of block.blocks) {
    drawBlock(ctx, inner, { x, width, muted: true });
  }

  // 페이지를 넘겼으면 시작 페이지의 남은 높이만 칠한다. 넘긴 쪽은 포기한다
  const end = ctx.page === startPage ? doc.y : ctx.bottom;
  doc.save()
    .rect(ctx.left, top - ctx.base * 0.2, pt(1), end - top + ctx.base * 0.4)
    .fill(COLOR.quoteBar)
    .restore();

  doc.y += ctx.base * 0.2;
}

function drawCode(ctx, block) {
  const { doc } = ctx;
  const size = ctx.base * 0.9;
  const pad = ctx.base * 0.5;
  const lines = block.text.split('\n');

  doc.font('body').fontSize(size);
  const lineHeight = doc.currentLineHeight() + ctx.base * 0.15;
  const height = lines.length * lineHeight + pad * 2;

  if (!ctx.fits(height) && height < ctx.bottom - ctx.margin) ctx.newPage();

  const top = doc.y;
  doc.save().rect(ctx.left, top, ctx.width, height).fill('#f6f6f6').restore();

  let y = top + pad;
  for (const line of lines) {
    // 코드 블록은 접지 않는다. 접으면 들여쓰기가 무너져서 읽을 수 없다
    if (doc.widthOfString(line) > ctx.width - pad * 2) {
      ctx.warnings.push({
        kind: 'code-overflow',
        text: line.trim().slice(0, 60),
        note: '코드 블록은 접지 않으므로 폭을 넘는 줄은 잘립니다. 줄을 짧게 나누세요.',
      });
    }
    doc.font('body').fontSize(size).fillColor(COLOR.text);
    doc.text(line, ctx.left + pad, y, { width: ctx.width - pad * 2, lineBreak: false });
    y += lineHeight;
  }

  doc.y = top + height + ctx.base * 0.6;
}

function drawRule(ctx) {
  const { doc } = ctx;
  doc.y += ctx.base * 0.5;
  doc.moveTo(ctx.left, doc.y).lineTo(ctx.left + ctx.width, doc.y).lineWidth(0.5).strokeColor(COLOR.border).stroke();
  doc.y += ctx.base * 0.8;
}

/**
 * 표.
 *
 * 열 폭은 내용에서 잡는다. 한 열이 폭을 다 먹지 않게 상한을 두고, 넘치면 비례로
 * 눌러 담은 뒤 좁아진 열을 경고로 남긴다. **잘라내지 않는다.** 도구가 알아서 잘라
 * 버리면 내 표가 바뀐 줄도 모르고 인쇄한다.
 */
function drawTable(ctx, block, { x = ctx.left, width = ctx.width } = {}) {
  const { doc } = ctx;
  const size = ctx.base * 0.95;
  const pad = ctx.base * 0.45;
  const lineGap = ctx.base * 0.2;
  const columns = block.head.length;
  if (columns === 0) return;

  // 자연 폭. 한 열이 전체의 55%를 넘지 못하게 눌러서 좁은 열이 세로로 쌓이는 것을 막는다
  const cap = width * 0.55;
  const natural = [];
  for (let column = 0; column < columns; column++) {
    let widest = 0;
    const cells = [block.head[column], ...block.rows.map((row) => row[column])];
    for (const spans of cells) {
      const anyBold = spans.some((span) => span.bold);
      doc.font(anyBold && ctx.hasBold ? 'bold' : 'body').fontSize(size);
      widest = Math.max(widest, doc.widthOfString(spansToText(spans)));
    }
    natural.push(Math.min(widest + pad * 2, cap));
  }

  const total = natural.reduce((sum, value) => sum + value, 0);
  const widths = natural.map((value) => (value / total) * width);

  const narrow = widths.findIndex((value) => value < pt(12));
  if (narrow !== -1) {
    ctx.warnings.push({
      kind: 'table-narrow',
      column: spansToText(block.head[narrow]) || `${narrow + 1}번째 열`,
      widthMm: Number(((widths[narrow] * 25.4) / 72).toFixed(1)),
      note: '열이 좁아 글자가 한두 자씩 쌓입니다. 열을 줄이거나 항목 이름을 짧게 하세요.',
    });
  }

  const rowHeight = (cells) => {
    let tallest = 0;
    cells.forEach((spans, column) => {
      tallest = Math.max(tallest, measureSpans(ctx, spans, { size, width: widths[column] - pad * 2, lineGap }));
    });
    return tallest + pad * 2;
  };

  const emitRow = (cells, header) => {
    const height = rowHeight(cells);
    if (!ctx.fits(height)) {
      ctx.newPage();
      // 표가 장을 넘기면 헤더를 다시 그린다. 없으면 다음 장이 무슨 표인지 알 수 없다
      if (!header) emitRow(block.head, true);
    }

    const top = doc.y;
    if (header) {
      doc.save().rect(x, top, width, height).fill(COLOR.tableHead).restore();
    }

    let cursor = x;
    cells.forEach((spans, column) => {
      const text = spansToText(spans);
      const bold = header || spans.some((span) => span.bold);
      const allCode = spans.length > 0 && spans.every((span) => span.code);
      const stroke = bold && !ctx.hasBold;

      doc.font(bold && ctx.hasBold ? 'bold' : 'body').fontSize(size);
      doc.fillColor(allCode ? COLOR.code : COLOR.text);
      if (stroke) doc.lineWidth(size * 0.02).strokeColor(allCode ? COLOR.code : COLOR.text);

      if (text !== '') {
        doc.text(text, cursor + pad, top + pad, {
          width: widths[column] - pad * 2,
          align: block.align[column] ?? 'left',
          lineGap,
          stroke,
          fill: true,
        });
      }
      cursor += widths[column];
    });

    doc.y = top + height;
    doc.moveTo(x, doc.y).lineTo(x + width, doc.y).lineWidth(header ? 0.7 : 0.4).strokeColor(COLOR.border).stroke();
  };

  doc.y += ctx.base * 0.2;

  // 머리행과 첫 행이 함께 들어갈 자리가 없으면 표를 다음 장에서 시작한다.
  // 위 경계선만 남고 표가 넘어가면 앞장에 선 하나가 떠 있게 된다
  const opening = rowHeight(block.head) + (block.rows[0] ? rowHeight(block.rows[0]) : 0);
  if (!ctx.fits(opening) && opening < ctx.bottom - ctx.margin) ctx.newPage();

  doc.moveTo(x, doc.y).lineTo(x + width, doc.y).lineWidth(0.7).strokeColor(COLOR.border).stroke();
  emitRow(block.head, true);
  for (const row of block.rows) emitRow(row, false);
  doc.y += ctx.base * 0.7;
}

function drawBlock(ctx, block, options = {}) {
  switch (block.type) {
    case 'heading':
      drawHeading(ctx, block);
      break;
    case 'paragraph':
      drawParagraph(ctx, block, options);
      break;
    case 'list':
      drawList(ctx, block, options);
      break;
    case 'quote':
      drawQuote(ctx, block);
      break;
    case 'table':
      drawTable(ctx, block, options);
      break;
    case 'code':
      drawCode(ctx, block);
      break;
    case 'rule':
      drawRule(ctx);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// 표제와 목차와 꼬리말
// ---------------------------------------------------------------------------

function drawTitleBlock(ctx, { title, version, subtitle }) {
  const { doc } = ctx;
  const size = ctx.base * 2.0;

  doc.font(ctx.hasBold ? 'bold' : 'body').fontSize(size).fillColor(COLOR.heading);
  doc.text(title, ctx.left, doc.y, {
    width: ctx.width,
    align: 'center',
    stroke: !ctx.hasBold,
    fill: true,
    lineGap: ctx.base * 0.2,
  });

  const meta = [version, subtitle].filter(Boolean).join('  ·  ');
  if (meta) {
    doc.y += ctx.base * 0.3;
    doc.font('body').fontSize(ctx.base * 0.95).fillColor(COLOR.muted);
    doc.text(meta, ctx.left, doc.y, { width: ctx.width, align: 'center' });
  }

  doc.y += ctx.base * 0.9;
  doc.moveTo(ctx.left, doc.y).lineTo(ctx.left + ctx.width, doc.y).lineWidth(0.8).strokeColor(COLOR.border).stroke();
  doc.y += ctx.base * 1.2;
}

function drawToc(ctx, sections, { label, offset }) {
  const { doc } = ctx;
  const numberWidth = pt(14);

  doc.font(ctx.hasBold ? 'bold' : 'body').fontSize(ctx.base * 1.45).fillColor(COLOR.heading);
  doc.text(label, ctx.left, doc.y, { width: ctx.width, stroke: !ctx.hasBold, fill: true });
  doc.y += ctx.base * 0.8;

  for (const section of sections) {
    if (section.level === 1) continue;
    const indent = (section.level - 2) * ctx.base * 1.4;
    const height = ctx.base * 1.6;
    if (!ctx.fits(height)) ctx.newPage();

    const top = doc.y;
    doc.font('body').fontSize(ctx.base).fillColor(section.level === 2 ? COLOR.text : COLOR.muted);
    doc.text(section.text, ctx.left + indent, top, {
      width: ctx.width - indent - numberWidth,
      lineBreak: false,
      ellipsis: true,
    });
    doc.font('body').fontSize(ctx.base).fillColor(COLOR.muted);
    doc.text(String(section.page + offset), ctx.left + ctx.width - numberWidth, top, {
      width: numberWidth,
      align: 'right',
      lineBreak: false,
    });
    doc.y = top + height * 0.75;
  }
}

/**
 * 꼬리말은 전부 그린 뒤에 붙인다. 전체 장수를 알아야 `3 / 8` 을 쓸 수 있다.
 * 어느 버전을 인쇄한 룰북인지가 남아야 플레이테스트 기록과 연결된다.
 */
function drawFooters(ctx, { title, version }) {
  const { doc } = ctx;
  const range = doc.bufferedPageRange();
  const size = ctx.base * 0.75;

  /*
   * 종이 끝에서 13mm를 띄운다. 가정용 프린터의 인쇄 가능 영역이 아래쪽에서 10mm쯤
   * 남는 경우가 있어서, 여백에 붙여 놓으면 꼬리말만 잘린 룰북이 나온다.
   * 본문 영역과 겹치면 안 되므로 아래 여백 바로 밑이 하한이다.
   */
  const y = Math.max(ctx.bottom + pt(3), ctx.pageHeight - pt(13) - size);

  for (let index = 0; index < range.count; index++) {
    doc.switchToPage(range.start + index);

    /*
     * 아래 여백을 잠시 0으로 내린다. 여백 밖에 텍스트를 쓰라고 하면 pdfkit은 넘친
     * 것으로 보고 페이지를 새로 만든다. 꼬리말을 그리려다 빈 페이지가 장수만큼
     * 늘어나서, 2쪽짜리 룰북이 6쪽으로 나왔다.
     */
    const keep = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc.font('body').fontSize(size).fillColor(COLOR.muted);
    doc.text(title, ctx.left, y, { width: ctx.width * 0.6, lineBreak: false });
    doc.text(
      `${version ? `${version}  ·  ` : ''}${index + 1} / ${range.count}`,
      ctx.left + ctx.width * 0.6,
      y,
      { width: ctx.width * 0.4, align: 'right', lineBreak: false },
    );

    doc.page.margins.bottom = keep;
  }
}

// ---------------------------------------------------------------------------
// 한 번 렌더
// ---------------------------------------------------------------------------

/**
 * 본문을 한 번 그린다. 측정과 실제 렌더가 같은 함수를 탄다.
 * 목차의 페이지 번호를 알려면 본문을 먼저 그려봐야 하므로 두 번 부른다.
 */
function renderOnce({ blocks, meta, font, boldFont, layout, toc }) {
  const ctx = createContext({ font, boldFont, layout });

  if (toc) {
    ctx.newPage();
    drawToc(ctx, toc.sections, { label: toc.label, offset: toc.offset });
    ctx.tocPages = ctx.page;
  }

  ctx.newPage();
  const bodyStartPage = ctx.page;
  drawTitleBlock(ctx, meta);

  for (const block of blocks) drawBlock(ctx, block);

  // 목차 페이지를 뺀 본문 기준 번호로 남긴다. 두 번째 렌더에서 offset 을 더한다
  const sections = ctx.sections.map((section) => ({
    ...section,
    page: section.page - bodyStartPage + 1,
  }));

  return { ctx, sections, pages: ctx.page, warnings: ctx.warnings };
}

// ---------------------------------------------------------------------------

const USAGE = `
룰북 PDF

  node tools/rulebook.mjs <slug> [--check] [--toc]

  --check   렌더하지 않고 페이지 수와 넘치는 것만 검사
  --toc     목차를 앞에 붙인다

ruleset.md 만 있으면 됩니다. spec.json 이 있으면 인원과 플레이타임을 제목 아래에
붙입니다.
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    check: { type: 'boolean' },
    toc: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const slug = positionals[0];
if (values.help || !slug) {
  console.error(USAGE);
  process.exit(slug ? 0 : 1);
}

const rulesetFile = path.join(ROOT, 'projects', slug, 'ruleset.md');
if (!existsSync(rulesetFile)) {
  bail(
    `${path.relative(ROOT, rulesetFile)} 이 없습니다.`,
    '/bgs-ruleset 으로 룰셋을 먼저 쓰세요.',
  );
}

const source = readFileSync(rulesetFile, 'utf8');
const { body } = parseFrontmatter(source);
const blocks = parseMarkdown(body);

const config = loadConfig();
const specFile = path.join(ROOT, 'projects', slug, 'spec.json');
const spec = existsSync(specFile) ? JSON.parse(readFileSync(specFile, 'utf8')) : {};
const print = { ...config.print, ...(spec.print ?? {}) };
const rulebook = { margin_mm: 20, font_pt: 10.5, ...(print.rulebook ?? {}) };
const labels = LABELS[config.language] ?? LABELS.en;

// 제목과 버전은 룰셋 상단에서 뽑는다. 두 곳에 적으면 어긋난다
const flow = [...blocks];
let title = spec.game?.title ?? slug;
if (flow[0]?.type === 'heading' && flow[0].level === 1) {
  title = spansToText(flow[0].spans);
  flow.shift();
}

let version = null;
const versionPattern = /^\s*(버전|version|v)\s*[\d.]+/i;
if (flow[0]?.type === 'paragraph' && versionPattern.test(spansToText(flow[0].spans))) {
  version = spansToText(flow.shift().spans).trim();
} else if (spec.game?.version) {
  version = `${labels.version} ${spec.game.version}`;
}

const subtitle = [
  spec.game?.players ? labels.players(spec.game.players[0], spec.game.players[1] ?? spec.game.players[0]) : null,
  spec.game?.playtime ? labels.playtime(spec.game.playtime[0], spec.game.playtime[1] ?? spec.game.playtime[0]) : null,
]
  .filter(Boolean)
  .join('  ·  ');

// 폰트: 본문에 비ASCII가 있으면 CJK 지원 폰트가 필요하다
const needsCjk = needsUnicodeFont(source) || needsUnicodeFont(title);
let font;
try {
  font = resolveFont({ configured: print.font, requireCjk: needsCjk });
} catch (error) {
  bail(error.message);
}
if (!font) bail(fontHelp(needsCjk));
const boldFont = resolveBoldFont(font.path);

const meta = { title, version, subtitle };
const layout = {
  sheet: print.sheet ?? 'A4',
  marginMm: rulebook.margin_mm,
  basePt: rulebook.font_pt,
  title,
};

// 이미지는 렌더하지 않는다. 조용히 빠뜨리는 것보다 알리는 편이 낫다
for (const match of source.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
  meta.hasImages = true;
  (meta.images ??= []).push(match[1]);
}

// 1차: 본문만 그려 페이지 번호를 얻는다
let first;
try {
  first = renderOnce({ blocks: flow, meta, font, boldFont, layout, toc: null });
} catch (error) {
  bail(error.message);
}
const boldLabel = first.ctx.hasBold ? boldFont.label : '없음 (획을 덧그립니다)';

const warnings = [...first.warnings];
const h1Count = blocks.filter((block) => block.type === 'heading' && block.level === 1).length;
if (h1Count > 1) {
  warnings.push({
    kind: 'multiple-h1',
    count: h1Count,
    note: '최상위 제목이 둘 이상입니다. 룰북의 제목은 하나여야 표제와 꼬리말이 맞습니다.',
  });
}
const deep = outline(blocks, { maxLevel: 6 }).filter((section) => section.level >= 5);
if (deep.length > 0) {
  warnings.push({
    kind: 'heading-too-deep',
    sections: deep.map((section) => section.text),
    note: '5단계 이상 제목은 본문과 크기가 같아 구분되지 않습니다. 절을 나누세요.',
  });
}
if (meta.images) {
  warnings.push({
    kind: 'image-unsupported',
    images: meta.images,
    note: '이 렌더러는 이미지를 그리지 않습니다. 도판은 컴포넌트로 넣고 pnp.mjs 로 인쇄하세요.',
  });
}

// --- --check: 렌더 없이 검사만 ----------------------------------------------
if (values.check) {
  process.stdout.write(
    `${JSON.stringify(
      {
        command: 'rulebook check',
        slug,
        title,
        version,
        font: font.label,
        bold: boldLabel,
        sheet: layout.sheet,
        margin_mm: layout.marginMm,
        font_pt: layout.basePt,
        pages: first.pages,
        sections: first.sections,
        warnings,
        note: warnings.length > 0
          ? '인쇄하면 위 항목이 그대로 남습니다. 인쇄한 뒤 발견하면 다시 뽑아야 합니다.'
          : '넘치는 것 없습니다.',
      },
      null,
      2,
    )}\n`,
  );
  process.exit(warnings.length > 0 ? 1 : 0);
}

// --- 렌더 -------------------------------------------------------------------
let final = first;
let tocPages = 0;

if (values.toc) {
  /*
   * 목차를 앞에 붙이면 본문 페이지 번호가 목차 장수만큼 밀린다. 목차 자체의 장수는
   * 목차를 그려봐야 알기 때문에 세 번 그린다. 본문은 항상 새 장에서 시작하므로
   * 앞에 몇 장이 붙든 본문 레이아웃은 같다. 그래서 밀리는 값이 정확히 목차 장수다.
   */
  const probe = renderOnce({
    blocks: flow,
    meta,
    font,
    boldFont,
    layout,
    toc: { sections: first.sections, label: labels.contents, offset: 0 },
  });
  tocPages = probe.ctx.tocPages;

  final = renderOnce({
    blocks: flow,
    meta,
    font,
    boldFont,
    layout,
    toc: { sections: first.sections, label: labels.contents, offset: tocPages },
  });
}

const outDir = path.join(ROOT, 'projects', slug, 'pnp');
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${slug}-rulebook-${localDate()}.pdf`);

drawFooters(final.ctx, { title, version });

const stream = createWriteStream(outFile);
final.ctx.doc.pipe(stream);
final.ctx.doc.end();
await new Promise((resolve, reject) => {
  stream.on('finish', resolve);
  stream.on('error', reject);
});

process.stdout.write(
  `${JSON.stringify(
    {
      command: 'rulebook',
      slug,
      output: path.relative(ROOT, outFile),
      title,
      version,
      font: font.label,
      bold: boldLabel,
      sheet: layout.sheet,
      margin_mm: layout.marginMm,
      pages: final.pages,
      toc: values.toc ? { pages: tocPages } : null,
      sections: final.sections.length,
      warnings,
      note: '룰셋 상단의 버전이 꼬리말에 박힙니다. 플레이테스트 기록의 버전과 맞춰 두세요.',
    },
    null,
    2,
  )}\n`,
);
