/**
 * 최소 ZIP 리더.
 *
 * BGG 랭킹 덤프는 CSV 하나가 deflate로 들어 있는 단순한 zip이다.
 * 이걸 읽자고 의존성을 늘리지 않는다. zlib은 Node 내장이다.
 *
 * 로컬 헤더가 아니라 중앙 디렉토리에서 크기를 읽는다. 로컬 헤더는
 * 데이터 디스크립터를 쓰는 경우 크기가 0으로 비어 있을 수 있다.
 */

import { inflateRawSync } from 'node:zlib';

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** EOCD는 파일 끝에 있고 주석 때문에 최대 64KB 앞까지 밀릴 수 있다. */
function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - (0xffff + 22));
  for (let i = buffer.length - 22; i >= minOffset; i--) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new Error('ZIP 파일이 아니거나 손상되었습니다 (EOCD를 찾을 수 없음)');
}

/**
 * 중앙 디렉토리를 훑어 엔트리 목록을 만든다. 데이터는 아직 풀지 않는다.
 * @param {Buffer} buffer
 * @returns {{ name: string, method: number, compressedSize: number, size: number, localOffset: number }[]}
 */
export function listZipEntries(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  const total = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  const entries = [];
  for (let i = 0; i < total; i++) {
    if (buffer.readUInt32LE(offset) !== SIG_CENTRAL) {
      throw new Error(`중앙 디렉토리 엔트리 ${i}의 시그니처가 올바르지 않습니다`);
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    entries.push({ name, method, compressedSize, size, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * 엔트리 하나의 내용을 꺼낸다.
 * @param {Buffer} buffer
 * @param {{ name: string, method: number, compressedSize: number, localOffset: number }} entry
 * @returns {Buffer}
 */
export function readZipEntry(buffer, entry) {
  const { localOffset } = entry;
  if (buffer.readUInt32LE(localOffset) !== SIG_LOCAL) {
    throw new Error(`"${entry.name}"의 로컬 헤더 시그니처가 올바르지 않습니다`);
  }

  // 로컬 헤더의 이름/추가필드 길이는 중앙 디렉토리와 다를 수 있으므로 여기서 다시 읽는다.
  const nameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLength + extraLength;
  const raw = buffer.subarray(start, start + entry.compressedSize);

  if (entry.method === METHOD_STORE) return Buffer.from(raw);
  if (entry.method === METHOD_DEFLATE) return inflateRawSync(raw);
  throw new Error(`지원하지 않는 압축 방식입니다: ${entry.method} ("${entry.name}")`);
}

/**
 * 이름으로 엔트리 하나를 찾아 문자열로 읽는다.
 * 이름을 안 주면 첫 번째 파일 엔트리를 쓴다.
 *
 * @param {Buffer} buffer
 * @param {{ name?: string, encoding?: BufferEncoding }} [options]
 * @returns {{ name: string, text: string }}
 */
export function readTextFromZip(buffer, options = {}) {
  const { name, encoding = 'utf8' } = options;
  const entries = listZipEntries(buffer).filter((entry) => !entry.name.endsWith('/'));

  if (entries.length === 0) throw new Error('ZIP 안에 파일이 없습니다');

  const entry = name
    ? entries.find((candidate) => candidate.name === name)
    : entries[0];

  if (!entry) {
    const available = entries.map((candidate) => candidate.name).join(', ');
    throw new Error(`ZIP 안에 "${name}"이(가) 없습니다. 들어 있는 것: ${available}`);
  }

  return { name: entry.name, text: readZipEntry(buffer, entry).toString(encoding) };
}
