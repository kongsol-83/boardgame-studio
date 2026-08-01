/**
 * CSV 파서. RFC 4180의 실용적인 부분만 다룬다.
 *
 * 따옴표로 감싼 필드, 필드 안의 쉼표와 줄바꿈, `""` 이스케이프, CRLF, BOM을 처리한다.
 *
 * 랭킹 덤프가 15만 행쯤 되므로 전부 객체로 만들어 배열에 담으면 메모리를 크게 먹는다.
 * `parseCsv` 는 행마다 콜백을 부르고 아무것도 쌓아두지 않는다. 전체가 필요하면
 * `parseCsvToArray` 를 쓴다.
 */

/**
 * 한 행씩 콜백으로 넘긴다.
 *
 * @param {string} text
 * @param {(row: Record<string, string>, index: number) => void} onRow
 * @returns {{ header: string[], count: number }}
 */
export function parseCsv(text, onRow) {
  const source = text.replace(/^\uFEFF/, '');
  const length = source.length;

  let header = null;
  let count = 0;
  let field = '';
  let row = [];
  let inQuotes = false;
  let sawAnyChar = false;

  const endField = () => {
    row.push(field);
    field = '';
  };

  const endRow = () => {
    endField();
    // 완전히 빈 줄은 건너뛴다
    if (row.length === 1 && row[0] === '') {
      row = [];
      return;
    }
    if (header === null) {
      header = row.map((name) => name.trim());
    } else {
      const record = {};
      for (let i = 0; i < header.length; i++) record[header[i]] = row[i] ?? '';
      onRow(record, count);
      count += 1;
    }
    row = [];
  };

  for (let i = 0; i < length; i++) {
    const char = source[i];
    sawAnyChar = true;

    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') {
      inQuotes = true;
    } else if (char === ',') {
      endField();
    } else if (char === '\n') {
      endRow();
    } else if (char === '\r') {
      if (source[i + 1] === '\n') i += 1;
      endRow();
    } else {
      field += char;
    }
  }

  // 마지막 줄에 줄바꿈이 없는 경우
  if (sawAnyChar && (field !== '' || row.length > 0)) endRow();

  return { header: header ?? [], count };
}

/**
 * 전부 배열로 만든다. 큰 파일에는 쓰지 말 것.
 *
 * @param {string} text
 * @returns {Record<string, string>[]}
 */
export function parseCsvToArray(text) {
  const rows = [];
  parseCsv(text, (row) => rows.push(row));
  return rows;
}

/** 빈 문자열을 null로 보고 숫자로 바꾼다. 랭크 컬럼처럼 비어 있는 값이 흔하다. */
export function toNumber(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
