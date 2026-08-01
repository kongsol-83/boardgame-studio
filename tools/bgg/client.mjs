/**
 * BoardGameGeek XML API2 클라이언트.
 *
 * 주의할 점 셋:
 *
 *   1. 베이스 URL은 boardgamegeek.com 이다. www 를 붙이면 인증이 깨진다.
 *   2. 헤더는 `Authorization: Bearer <token>` 이다. 콜론 없이 공백 하나.
 *   3. thing?id= 는 한 번에 최대 20개다.
 *
 * 응답 코드도 평범하지 않다. 202는 오류가 아니라 "큐에 넣었으니 다시 물어봐라"는
 * 뜻이고, 429는 레이트 리밋이다. 공식 한도는 공개돼 있지 않아서 분당 55요청
 * 정도로 보수적으로 잡았다.
 */

import { XMLParser } from 'fast-xml-parser';

const BASE_URL = 'https://boardgamegeek.com/xmlapi2';
const THING_CHUNK = 20;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '_text',
  parseAttributeValue: false,
  trimValues: true,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 항상 배열로 만든다. fast-xml-parser는 자식이 하나면 배열로 감싸지 않는다. */
export const asArray = (value) => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);

export class BggError extends Error {
  constructor(message, { status, url, cause } = {}) {
    super(message);
    this.name = 'BggError';
    this.status = status;
    this.url = url;
    if (cause) this.cause = cause;
  }
}

/**
 * @param {object} options
 * @param {string} options.token BGG 액세스 토큰
 * @param {number} [options.requestsPerMinute] 기본 55
 * @param {number} [options.maxRetries] 기본 6
 * @param {number} [options.timeoutMs] 기본 30000
 * @param {(message: string) => void} [options.onProgress]
 */
export function createBggClient({
  token,
  requestsPerMinute = 55,
  maxRetries = 6,
  timeoutMs = 30_000,
  onProgress = () => {},
} = {}) {
  if (!token) throw new BggError('BGG 액세스 토큰이 필요합니다');

  const minInterval = Math.ceil(60_000 / requestsPerMinute);
  let queue = Promise.resolve();
  let lastRequestAt = 0;

  /** 요청을 직렬화하고 사이 간격을 벌린다. 병렬로 쏘면 바로 429가 온다. */
  function schedule(task) {
    const run = queue.then(async () => {
      const wait = lastRequestAt + minInterval - Date.now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = Date.now();
      return task();
    });
    // 실패해도 큐가 멈추지 않게 한다
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function fetchOnce(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/xml',
          'User-Agent': 'boardgame-studio (+https://github.com/kongsol-83/boardgame-studio)',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 엔드포인트 하나를 호출하고 파싱된 객체를 돌려준다.
   * @param {string} endpoint 예: 'thing'
   * @param {Record<string, string|number|undefined>} params
   */
  async function request(endpoint, params = {}) {
    const url = new URL(`${BASE_URL}/${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const href = url.href;

    return schedule(async () => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        let response;
        try {
          response = await fetchOnce(href);
        } catch (error) {
          if (attempt === maxRetries) {
            throw new BggError(`네트워크 오류로 ${maxRetries}회 시도 후 실패했습니다`, { url: href, cause: error });
          }
          await sleep(backoff(attempt));
          continue;
        }

        // 202는 "큐에 넣었다". 오류가 아니라 다시 물어보라는 뜻이다.
        if (response.status === 202) {
          if (attempt === maxRetries) {
            throw new BggError('BGG가 계속 202(큐 대기)를 돌려줍니다. 잠시 후 다시 시도하세요', { status: 202, url: href });
          }
          onProgress(`202 큐 대기, ${attempt}번째 재시도`);
          await sleep(Math.min(2000 * attempt, 15_000));
          continue;
        }

        if (response.status === 429 || response.status === 503 || response.status >= 500) {
          if (attempt === maxRetries) {
            throw new BggError(
              response.status === 429
                ? '레이트 리밋에 걸렸습니다. requestsPerMinute 를 낮추고 다시 시도하세요'
                : `BGG 서버 오류 ${response.status}`,
              { status: response.status, url: href },
            );
          }
          onProgress(`${response.status} 응답, ${attempt}번째 재시도`);
          await sleep(backoff(attempt));
          continue;
        }

        if (response.status === 401 || response.status === 403) {
          throw new BggError(
            [
              `인증에 실패했습니다 (${response.status}).`,
              '',
              '  - .env 의 BGG_API_TOKEN 값이 맞는지 확인하세요',
              '  - 토큰은 https://boardgamegeek.com/applications 에서 발급받습니다',
            ].join('\n'),
            { status: response.status, url: href },
          );
        }

        if (!response.ok) {
          throw new BggError(`BGG가 ${response.status}를 돌려줬습니다`, { status: response.status, url: href });
        }

        const text = await response.text();
        try {
          return parser.parse(text);
        } catch (error) {
          throw new BggError('응답 XML을 파싱하지 못했습니다', { url: href, cause: error });
        }
      }
      throw new BggError('재시도를 모두 소진했습니다', { url: href });
    });
  }

  /**
   * 아이템 상세. 20개씩 잘라서 여러 번 부른다.
   * @param {(number|string)[]} ids
   * @param {{ stats?: boolean, type?: string }} [options]
   * @returns {Promise<object[]>} raw item 노드 배열
   */
  async function thing(ids, { stats = true, type } = {}) {
    const unique = [...new Set(ids.map(Number).filter(Number.isFinite))];
    const items = [];

    for (let i = 0; i < unique.length; i += THING_CHUNK) {
      const chunk = unique.slice(i, i + THING_CHUNK);
      const parsed = await request('thing', {
        id: chunk.join(','),
        stats: stats ? 1 : undefined,
        type,
      });
      items.push(...asArray(parsed?.items?.item));
      onProgress(`thing ${Math.min(i + THING_CHUNK, unique.length)}/${unique.length}`);
    }
    return items;
  }

  async function search(query, { exact = false, type = 'boardgame,boardgameexpansion' } = {}) {
    const parsed = await request('search', { query, type, exact: exact ? 1 : undefined });
    return asArray(parsed?.items?.item);
  }

  async function hot({ type = 'boardgame' } = {}) {
    const parsed = await request('hot', { type });
    return asArray(parsed?.items?.item);
  }

  return { request, thing, search, hot, chunkSize: THING_CHUNK };
}

/** 지수 백오프 + 지터. 여러 클라이언트가 동시에 재시도하며 겹치는 걸 막는다. */
function backoff(attempt, base = 1500, max = 30_000) {
  const exponential = Math.min(base * 2 ** (attempt - 1), max);
  return exponential + Math.random() * 500;
}
