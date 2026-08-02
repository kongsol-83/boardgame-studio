import assert from 'node:assert/strict';
import test from 'node:test';

import { estimateImageCost, IMAGE_PRICING, REFERENCE_SURCHARGE } from '../tools/lib/image.mjs';
import { encodePlaceholderPng } from './fixtures/placeholder-png.mjs';

// --- 아트 비용 --------------------------------------------------------------

test('장수와 품질로 비용을 낸다', () => {
  const price = IMAGE_PRICING['gpt-image-2'].low;
  assert.equal(estimateImageCost({ images: 60, quality: 'low', model: 'gpt-image-2' }), Number((60 * price).toFixed(2)));
});

test('품질을 올리면 크게 뛴다', () => {
  const low = estimateImageCost({ images: 60, quality: 'low', model: 'gpt-image-2' });
  const high = estimateImageCost({ images: 60, quality: 'high', model: 'gpt-image-2' });
  // low에서 high가 33배다. 반복 중에 high로 돌리면 그만큼 나간다
  assert.ok(high / low > 30);
});

test('레퍼런스를 붙이면 장당 추가 비용이 붙는다', () => {
  const bare = estimateImageCost({ images: 10, quality: 'low', model: 'gpt-image-2' });
  const withReference = estimateImageCost({
    images: 10,
    quality: 'low',
    model: 'gpt-image-2',
    referencesPerImage: 1,
  });
  assert.equal(withReference, Number((bare + 10 * REFERENCE_SURCHARGE).toFixed(2)));
});

test('모르는 모델이나 품질이면 null 을 돌려준다', () => {
  assert.equal(estimateImageCost({ images: 1, quality: 'low', model: '없는-모델' }), null);
  assert.equal(estimateImageCost({ images: 1, quality: 'ultra', model: 'gpt-image-2' }), null);
});

test('가격표의 모든 모델이 세 품질을 갖고 있다', () => {
  for (const [model, price] of Object.entries(IMAGE_PRICING)) {
    for (const quality of ['low', 'medium', 'high']) {
      assert.equal(typeof price[quality], 'number', `${model} 의 ${quality} 가 없다`);
    }
    assert.ok(price.low < price.medium && price.medium < price.high, `${model} 의 순서가 뒤집혔다`);
  }
});

// --- 자리표시 이미지 --------------------------------------------------------
//
// CI가 아트 없는 경로만 돌지 않게 이걸 만들어 pnp 에 먹인다. 인코더가 깨지면
// PDF 렌더가 아니라 CI 스텝이 먼저 죽으므로 여기서 형태를 확인해둔다.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('PNG 서명과 IHDR 을 갖춘다', () => {
  const png = encodePlaceholderPng({ width: 64, height: 96 });

  assert.deepEqual(png.subarray(0, 8), PNG_SIGNATURE);
  assert.equal(png.subarray(12, 16).toString('latin1'), 'IHDR');
  assert.equal(png.readUInt32BE(16), 64);
  assert.equal(png.readUInt32BE(20), 96);
  assert.equal(png[24], 8, '채널당 8비트여야 한다');
  assert.equal(png[25], 2, '트루컬러 RGB여야 한다');
  assert.equal(png[28], 0, '인터레이스가 없어야 한다');
});

test('IDAT 과 IEND 가 순서대로 있다', () => {
  const png = encodePlaceholderPng({ width: 32, height: 32 }).toString('latin1');
  assert.ok(png.indexOf('IDAT') > png.indexOf('IHDR'));
  assert.ok(png.indexOf('IEND') > png.indexOf('IDAT'));
});

test('카드 크기도 몇십 KB 안에서 끝난다', () => {
  // 300dpi 포커 카드. 그라디언트라 압축이 잘 먹는다
  const png = encodePlaceholderPng({ width: 750, height: 1039 });
  assert.ok(png.length < 60_000, `${png.length} bytes 는 너무 크다`);
});

test('크기가 0이면 만들지 않는다', () => {
  assert.throws(() => encodePlaceholderPng({ width: 0, height: 10 }), /양수/);
  assert.throws(() => encodePlaceholderPng({ height: -1 }), /양수/);
});

test('세로 한 줄이어도 죽지 않는다', () => {
  const png = encodePlaceholderPng({ width: 4, height: 1 });
  assert.equal(png.readUInt32BE(20), 1);
});
