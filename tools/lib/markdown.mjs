/**
 * 룰북 렌더에 쓰는 최소 마크다운 파서.
 *
 * Node에는 마크다운 파서가 없고 이 저장소는 런타임 의존성을 늘리지 않는다.
 * `ruleset.md` 가 실제로 쓰는 형태만 다룬다. 제목, 문단, 목록, 인용, 표, 코드 블록,
 * 그리고 강조와 인라인 코드와 링크다.
 *
 * **PDF 렌더러와 분리해 둔 이유가 있다.** 파서는 문자열만 다루므로 pdfkit도 폰트도
 * 없이 테스트된다. 표의 열이 몇 개로 잡혔는지, 인용 안의 목록이 살아 있는지를
 * PDF를 열어보지 않고 확인할 수 있다.
 *
 * 지원하지 않는 것: 참조 링크, 각주, HTML, 셋엑스트 제목, 느슨한 목록의 문단 구분.
 * 필요해지는 순간이 룰북이 너무 복잡해졌다는 신호다.
 *
 * 이탤릭은 `*기울임*` 만 본다. `_` 를 쓰면 `art_file` 이나 `size_mm` 처럼 밑줄이 든
 * 식별자가 기울어진다. 룰북에서 이탤릭보다 식별자가 훨씬 자주 나온다.
 */

const FENCE = /^\s*(```+|~~~+)\s*(\S*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBER = /^(\s*)(\d+)[.)]\s+(.*)$/;
// 구분선 셀은 하이픈 하나여도 된다. `| :-: |` 를 쓰는 사람이 있다
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/** 스팬은 항상 같은 모양이다. 렌더러가 필드 존재를 확인하지 않게 한다. */
const span = (text, flags = {}) => ({
  text,
  bold: flags.bold ?? false,
  italic: flags.italic ?? false,
  code: flags.code ?? false,
  link: flags.link ?? null,
});

/**
 * 인라인 마크업을 스팬 목록으로 만든다.
 *
 * 강조 안의 강조는 플래그가 합쳐진다. `**굵고 *기울인* 것**` 이 그런 경우다.
 *
 * @param {string} text
 * @param {{ bold?: boolean, italic?: boolean, code?: boolean, link?: string|null }} [flags]
 * @returns {ReturnType<typeof span>[]}
 */
export function parseInline(text, flags = {}) {
  const source = String(text ?? '');
  const spans = [];
  let buffer = '';

  const flush = () => {
    if (buffer !== '') spans.push(span(buffer, flags));
    buffer = '';
  };

  let i = 0;
  while (i < source.length) {
    const char = source[i];

    // 이스케이프는 다음 한 글자를 그대로 통과시킨다
    if (char === '\\' && i + 1 < source.length) {
      buffer += source[i + 1];
      i += 2;
      continue;
    }

    // 인라인 코드는 내용을 해석하지 않는다. `**` 가 들어 있어도 글자다
    if (char === '`') {
      const end = source.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        spans.push(span(source.slice(i + 1, end), { ...flags, code: true }));
        i = end + 1;
        continue;
      }
    }

    if (char === '*' && source[i + 1] === '*') {
      const end = source.indexOf('**', i + 2);
      if (end > i + 1) {
        flush();
        spans.push(...parseInline(source.slice(i + 2, end), { ...flags, bold: true }));
        i = end + 2;
        continue;
      }
    }

    if (char === '*') {
      const end = source.indexOf('*', i + 1);
      if (end > i + 1) {
        flush();
        spans.push(...parseInline(source.slice(i + 1, end), { ...flags, italic: true }));
        i = end + 1;
        continue;
      }
    }

    if (char === '[') {
      const close = source.indexOf(']', i + 1);
      if (close > i && source[close + 1] === '(') {
        const paren = source.indexOf(')', close + 2);
        if (paren > close) {
          flush();
          const label = source.slice(i + 1, close);
          const href = source.slice(close + 2, paren).trim();
          spans.push(...parseInline(label, { ...flags, link: href }));
          i = paren + 1;
          continue;
        }
      }
    }

    buffer += char;
    i += 1;
  }

  flush();
  return spans;
}

/** 스팬 목록을 평문으로 되돌린다. 목차와 경고 문구에 쓴다. */
export const spansToText = (spans) => (spans ?? []).map((item) => item.text).join('');

/** `| a | b |` 를 셀 배열로. 양끝 파이프는 있어도 없어도 된다. */
function splitRow(line) {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);

  const cells = [];
  let buffer = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && text[i + 1] === '|') {
      buffer += '|';
      i += 1;
      continue;
    }
    if (text[i] === '|') {
      cells.push(buffer.trim());
      buffer = '';
      continue;
    }
    buffer += text[i];
  }
  cells.push(buffer.trim());
  return cells;
}

function parseAlign(line) {
  return splitRow(line).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

const indentOf = (line) => line.length - line.trimStart().length;

/**
 * 마크다운을 블록 목록으로 만든다.
 *
 * 블록 종류는 `heading`, `paragraph`, `list`, `quote`, `table`, `code`, `rule` 이다.
 * `quote` 는 블록을 다시 담으므로 인용 안의 목록과 표가 유지된다.
 *
 * @param {string} source
 * @returns {object[]}
 */
export function parseMarkdown(source) {
  const lines = String(source ?? '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/);

  const blocks = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    // 마크다운의 줄바꿈 하나는 공백이다. 원문이 공백 자리에서 줄을 넘긴다
    blocks.push({ type: 'paragraph', spans: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const marker = fence[1][0].repeat(3);
      const collected = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) {
        collected.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'code', lang: fence[2] || null, text: collected.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        spans: parseInline(heading[2].replace(/\s+#+\s*$/, '').trim()),
      });
      continue;
    }

    // 표 판정이 수평선보다 앞이다. `| --- |` 도 RULE 에 걸릴 수 있다
    if (line.includes('|') && TABLE_DELIMITER.test(lines[i + 1] ?? '')) {
      flushParagraph();
      const head = splitRow(line).map((cell) => parseInline(cell));
      const align = parseAlign(lines[i + 1]);
      i += 2;

      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]).map((cell) => parseInline(cell)));
        i += 1;
      }
      i -= 1;

      // 열 수는 헤더가 정한다. 행이 짧으면 채우고 길면 버린다
      const width = head.length;
      const normalized = rows.map((row) => {
        const cells = row.slice(0, width);
        while (cells.length < width) cells.push([]);
        return cells;
      });

      blocks.push({ type: 'table', head, align, rows: normalized });
      continue;
    }

    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ type: 'rule' });
      continue;
    }

    if (QUOTE.test(line)) {
      flushParagraph();
      const collected = [];
      while (i < lines.length) {
        const quote = QUOTE.exec(lines[i]);
        if (quote) {
          collected.push(quote[1]);
          i += 1;
          continue;
        }
        // 인용 안의 빈 줄은 문단을 나누되 인용을 끝내지 않는다
        if (lines[i].trim() === '' && QUOTE.test(lines[i + 1] ?? '')) {
          collected.push('');
          i += 1;
          continue;
        }
        break;
      }
      i -= 1;
      blocks.push({ type: 'quote', blocks: parseMarkdown(collected.join('\n')) });
      continue;
    }

    const bullet = BULLET.exec(line);
    const number = NUMBER.exec(line);
    if (bullet || number) {
      flushParagraph();
      const ordered = Boolean(number);
      const items = [];

      while (i < lines.length) {
        const current = lines[i];
        const nextBullet = BULLET.exec(current);
        const nextNumber = NUMBER.exec(current);

        if (nextBullet || nextNumber) {
          const match = nextBullet ?? nextNumber;
          const indent = match[1].length;
          const text = nextBullet ? nextBullet[2] : nextNumber[3];
          items.push({ level: Math.min(Math.floor(indent / 2), 2), text });
          i += 1;
          continue;
        }

        // 들여쓴 이어지는 줄은 앞 항목에 붙인다
        if (current.trim() !== '' && indentOf(current) >= 2 && items.length > 0) {
          items[items.length - 1].text += ` ${current.trim()}`;
          i += 1;
          continue;
        }

        break;
      }
      i -= 1;

      blocks.push({
        type: 'list',
        ordered,
        items: items.map((item) => ({ level: item.level, spans: parseInline(item.text) })),
      });
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  return blocks;
}

/**
 * 제목만 뽑아 목차용 목록으로.
 *
 * @param {object[]} blocks
 * @param {{ maxLevel?: number }} [options]
 */
export function outline(blocks, { maxLevel = 3 } = {}) {
  return blocks
    .filter((block) => block.type === 'heading' && block.level <= maxLevel)
    .map((block) => ({ level: block.level, text: spansToText(block.spans) }));
}
