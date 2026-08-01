/**
 * 최소 YAML 프론트매터 파서.
 *
 * Node에는 YAML 파서가 없고 이 저장소는 런타임 의존성을 늘리지 않는다.
 * Cursor 스킬과 에이전트 프론트매터에서 실제로 쓰는 형태만 다룬다.
 *
 *   key: value
 *   key: "quoted value"
 *   key: >-
 *     접힌 여러 줄
 *   key:
 *     - 리스트 항목
 *
 * 중첩 매핑이나 앵커 같은 건 지원하지 않는다. 필요해지는 순간이
 * 프론트매터가 너무 복잡해졌다는 신호다.
 */

const DELIMITER = /^---\s*$/;

/** `"a"` / `'a'` 를 벗기고 스칼라를 적절한 타입으로 바꾼다. */
function coerce(raw) {
  const value = raw.trim();
  if (value === '') return '';
  const quoted = /^(["'])([\s\S]*)\1$/.exec(value);
  if (quoted) return quoted[2];
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

/**
 * @param {string} source 파일 전체 내용
 * @returns {{ data: Record<string, unknown>, body: string, hasFrontmatter: boolean }}
 */
export function parseFrontmatter(source) {
  const text = source.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);

  if (!DELIMITER.test(lines[0] ?? '')) {
    return { data: {}, body: text, hasFrontmatter: false };
  }

  const closing = lines.findIndex((line, i) => i > 0 && DELIMITER.test(line));
  if (closing === -1) {
    return { data: {}, body: text, hasFrontmatter: false };
  }

  const data = {};
  const block = lines.slice(1, closing);

  for (let i = 0; i < block.length; i++) {
    const line = block[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (indentOf(line) > 0) continue; // 상위 키가 이미 소비했어야 할 줄

    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;

    const [, key, rest] = match;

    // 접힌/유지 블록 스칼라: `key: >-` 또는 `key: |`
    if (/^[>|][-+]?$/.test(rest.trim())) {
      const fold = rest.trim().startsWith('>');
      const collected = [];
      while (i + 1 < block.length && (block[i + 1].trim() === '' || indentOf(block[i + 1]) > 0)) {
        collected.push(block[++i].trim());
      }
      data[key] = fold ? collected.join(' ').trim() : collected.join('\n').trim();
      continue;
    }

    // 블록 리스트: `key:` 뒤에 `  - item` 들
    if (rest.trim() === '') {
      const items = [];
      while (i + 1 < block.length && /^\s+-\s/.test(block[i + 1])) {
        items.push(coerce(block[++i].trim().slice(1)));
      }
      data[key] = items.length > 0 ? items : '';
      continue;
    }

    // 인라인 리스트: `key: [a, b]`
    const inline = /^\[(.*)\]$/.exec(rest.trim());
    if (inline) {
      data[key] = inline[1].trim() === ''
        ? []
        : inline[1].split(',').map((item) => coerce(item));
      continue;
    }

    data[key] = coerce(rest);
  }

  return { data, body: lines.slice(closing + 1).join('\n'), hasFrontmatter: true };
}
