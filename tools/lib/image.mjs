/**
 * OpenAI 이미지 생성 클라이언트.
 *
 * 덱 전체의 화풍을 맞추는 게 전부다. 카드마다 따로 생성하면 60장이 60가지 화풍으로
 * 나온다. 그래서 승인된 **스타일 앵커**를 레퍼런스로 붙여 edits 로 생성한다.
 * generations 는 레퍼런스를 실을 수 없어서 앵커를 처음 뽑을 때만 쓴다.
 */

const BASE = 'https://api.openai.com/v1/images';

/**
 * 이미지 한 장당 대략적인 비용(달러). OpenAI 계산기 기준의 추정치다.
 * 실제 과금은 토큰 단위이고 크기에 따라 달라지므로 정확한 값이 아니다.
 * 세로형(1024x1536)을 대표값으로 쓴다.
 */
export const IMAGE_PRICING = {
  'gpt-image-2': { low: 0.005, medium: 0.041, high: 0.165 },
  'gpt-image-1.5': { low: 0.013, medium: 0.05, high: 0.2 },
  'gpt-image-1': { low: 0.016, medium: 0.063, high: 0.25 },
  'gpt-image-1-mini': { low: 0.006, medium: 0.015, high: 0.052 },
};

/**
 * 레퍼런스 이미지 한 장당 추가 비용의 대략치.
 * gpt-image-2 는 레퍼런스를 항상 high fidelity 로 처리하고 이를 끌 수 없다.
 */
export const REFERENCE_SURCHARGE = 0.02;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ImageError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'ImageError';
    this.status = status;
  }
}

/**
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} [options.model]
 * @param {number} [options.imagesPerMinute] 계정 티어에 맞춘다. Tier 1은 5
 * @param {(message: string) => void} [options.onProgress]
 */
export function createImageClient({
  apiKey,
  model = 'gpt-image-2',
  imagesPerMinute = 5,
  maxRetries = 4,
  timeoutMs = 180_000,
  onProgress = () => {},
} = {}) {
  if (!apiKey) throw new ImageError('OpenAI API 키가 필요합니다');

  const usage = { images: 0, retries: 0, failures: 0 };
  const minInterval = Math.ceil(60_000 / Math.max(imagesPerMinute, 1));

  // 분당 이미지 제한이 있으므로 직렬로 간격을 벌린다
  let queue = Promise.resolve();
  let lastAt = 0;
  const schedule = (task) => {
    const run = queue.then(async () => {
      const wait = lastAt + minInterval - Date.now();
      if (wait > 0) {
        onProgress(`레이트 리밋 대기 ${Math.ceil(wait / 1000)}초`);
        await sleep(wait);
      }
      lastAt = Date.now();
      return task();
    });
    queue = run.then(() => undefined, () => undefined);
    return run;
  };

  async function send(path, body, headers = {}) {
    return schedule(async () => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response;
        try {
          response = await fetch(`${BASE}/${path}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, ...headers },
            body,
            signal: controller.signal,
          });
        } catch (error) {
          if (attempt === maxRetries) { usage.failures += 1; throw new ImageError(`네트워크 오류: ${error.message}`); }
          usage.retries += 1;
          await sleep(Math.min(2000 * 2 ** (attempt - 1), 30_000));
          continue;
        } finally {
          clearTimeout(timer);
        }

        if (response.status === 429 || response.status >= 500) {
          if (attempt === maxRetries) { usage.failures += 1; throw new ImageError(`${response.status} 응답이 계속됩니다`, { status: response.status }); }
          usage.retries += 1;
          onProgress(`${response.status} 응답, ${attempt}번째 재시도`);
          await sleep(Math.min(5000 * 2 ** (attempt - 1), 60_000));
          continue;
        }

        const text = await response.text();
        if (!response.ok) {
          usage.failures += 1;
          throw new ImageError(
            response.status === 401
              ? 'OpenAI 인증에 실패했습니다. .env 의 OPENAI_API_KEY 를 확인하세요.'
              : `OpenAI가 ${response.status}를 돌려줬습니다: ${text.slice(0, 300)}`,
            { status: response.status },
          );
        }

        const parsed = JSON.parse(text);
        const images = (parsed.data ?? []).map((entry) => Buffer.from(entry.b64_json, 'base64'));
        usage.images += images.length;
        return images;
      }
      throw new ImageError('재시도를 모두 소진했습니다');
    });
  }

  /** 레퍼런스 없이 새로 만든다. 스타일 앵커를 처음 뽑을 때만 쓴다. */
  async function generate({ prompt, size, quality = 'low', n = 1 }) {
    return send(
      'generations',
      JSON.stringify({ model, prompt, size, quality, n, output_format: 'png' }),
      { 'Content-Type': 'application/json' },
    );
  }

  /**
   * 레퍼런스를 붙여 만든다. 덱 전체의 화풍을 맞추는 핵심이다.
   * @param {{ prompt: string, size: string, quality?: string, references: {name: string, data: Buffer}[] }} options
   */
  async function edit({ prompt, size, quality = 'low', references }) {
    if (!references?.length) throw new ImageError('레퍼런스가 없으면 generate 를 쓰세요');

    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('quality', quality);
    form.append('output_format', 'png');
    for (const reference of references) {
      form.append('image[]', new Blob([reference.data], { type: 'image/png' }), reference.name);
    }
    // FormData 를 넘기면 fetch 가 boundary 를 포함한 Content-Type 을 붙인다
    return send('edits', form);
  }

  return { generate, edit, usage, model };
}

/**
 * 대략적인 비용. 정확한 값이 아니라 규모를 가늠하는 용도다.
 * @param {{ images: number, quality: string, model: string, referencesPerImage?: number }} options
 */
export function estimateImageCost({ images, quality, model, referencesPerImage = 0 }) {
  const price = IMAGE_PRICING[model]?.[quality];
  if (price === undefined) return null;
  return Number((images * (price + referencesPerImage * REFERENCE_SURCHARGE)).toFixed(2));
}
