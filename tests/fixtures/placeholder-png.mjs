#!/usr/bin/env node
/**
 * 자리표시 PNG 생성기. **테스트와 CI 전용이다.**
 *
 * `pnp.mjs` 는 아트가 있으면 이미지를 카드에 얹고 없으면 도형과 텍스트로 그린다. 그런데
 * 아트를 뽑으려면 OpenAI 키가 필요해서, 이미지를 얹는 쪽 경로가 CI에서 한 번도 돌지
 * 않았다. 리눅스와 Windows에서 경로 해석이 갈리는 자리라 그냥 두기에는 위험하다.
 *
 * **예제 프로젝트에 그림을 커밋하지 않는 이유가 있다.** 아트 파이프라인은 승인된 스타일
 * 앵커가 없으면 배치 생성을 거부한다. 앵커도 없이 `art/<comp-id>/<row-id>.png` 가 놓여
 * 있으면 파이프라인이 스스로 모순되고, 읽는 사람은 그게 어디서 나왔는지 알 수 없다.
 * 그래서 CI가 실행할 때 만들고 버린다.
 *
 * 의존성을 늘리지 않으므로 PNG를 직접 쓴다. 8비트 RGB, 인터레이스 없음, 필터 없음.
 * pdfkit이 읽는 가장 단순한 형태다.
 *
 *   node tests/fixtures/placeholder-png.mjs <출력 경로> [가로px] [세로px]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const lerp = (from, to, ratio) => Math.round(from + (to - from) * ratio);

/**
 * 위아래로 색이 변하는 자리표시 이미지. 안쪽에 밝은 테두리를 하나 넣는다.
 * 테두리는 안전 여백 자리를 보여주므로, 인쇄해서 자를 때 무엇이 잘리는지 눈에 보인다.
 *
 * @param {object} [options]
 * @param {number} [options.width]
 * @param {number} [options.height]
 * @param {[number,number,number]} [options.top]
 * @param {[number,number,number]} [options.bottom]
 * @param {number} [options.inset] 테두리를 짧은 변의 몇 비율만큼 안쪽에 둘지
 * @returns {Buffer}
 */
export function encodePlaceholderPng({
  width = 508,
  height = 704,
  top = [26, 74, 82],
  bottom = [214, 203, 168],
  inset = 0.05,
} = {}) {
  if (!(width > 0) || !(height > 0)) throw new Error('가로와 세로는 양수여야 합니다');

  const border = Math.max(2, Math.round(Math.min(width, height) * inset));
  const raw = Buffer.alloc(height * (width * 3 + 1));

  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset] = 0; // 필터 없음
    offset += 1;

    const ratio = height === 1 ? 0 : y / (height - 1);
    const base = [lerp(top[0], bottom[0], ratio), lerp(top[1], bottom[1], ratio), lerp(top[2], bottom[2], ratio)];

    for (let x = 0; x < width; x++) {
      const onBorder =
        (x === border || x === width - 1 - border) && y >= border && y <= height - 1 - border;
      const onEdge =
        (y === border || y === height - 1 - border) && x >= border && x <= width - 1 - border;

      if (onBorder || onEdge) {
        raw[offset] = Math.min(255, base[0] + 90);
        raw[offset + 1] = Math.min(255, base[1] + 90);
        raw[offset + 2] = Math.min(255, base[2] + 90);
      } else {
        raw[offset] = base[0];
        raw[offset + 1] = base[1];
        raw[offset + 2] = base[2];
      }
      offset += 3;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 채널당 8비트
  header[9] = 2; // 트루컬러 RGB
  header[10] = 0; // deflate
  header[11] = 0; // 필터 방식
  header[12] = 0; // 인터레이스 없음

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 폴더가 없으면 만들고 쓴다. @returns {number} 바이트 수 */
export function writePlaceholderPng(file, options) {
  const data = encodePlaceholderPng(options);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
  return data.length;
}

// CLI로 부르면 파일을 쓴다. import 하면 여기는 안 돈다. CI가 이렇게 쓴다
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [file, width, height] = process.argv.slice(2);
  if (!file) {
    console.error('사용법: node tests/fixtures/placeholder-png.mjs <출력 경로> [가로px] [세로px]');
    process.exit(1);
  }
  const bytes = writePlaceholderPng(file, {
    width: width ? Number(width) : undefined,
    height: height ? Number(height) : undefined,
  });
  process.stdout.write(`${file} (${bytes} bytes)\n`);
}
