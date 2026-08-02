/**
 * OpenAI 텍스트 클라이언트. 시뮬레이션 플레이어가 쓴다.
 *
 * 보드게임은 턴제라 실시간 제약이 없고, 게임마다 휴리스틱 봇을 짜는 건 진짜 비용인
 * 데다 나쁜 봇은 잘못된 결론을 준다. 그래서 LLM이 매 수를 판단한다.
 *
 * 비용은 프롬프트 캐싱이 대부분을 결정한다. 룰 요약이 매 턴 동일하므로 시스템
 * 메시지 맨 앞에 두면 자동으로 캐시된다. 그래서 캐시 히트를 따로 집계해 보여준다.
 */

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

/** 1M 토큰당 달러. 판당 비용을 추정하려면 필요하다. */
export const PRICING = {
  'gpt-5.4-nano': { input: 0.2, cached: 0.02, output: 1.25 },
  'gpt-5.4-mini': { input: 0.75, cached: 0.075, output: 4.5 },
  'gpt-5.4': { input: 2.5, cached: 0.25, output: 15 },
  'gpt-5.6-luna': { input: 0.2, cached: 0.02, output: 1.2 },
  'gpt-5.6-terra': { input: 2, cached: 0.2, output: 12 },
};

export const DEFAULT_MODEL = 'gpt-5.4-nano';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class LlmError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.body = body;
  }
}

/**
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} [options.model]
 * @param {number} [options.concurrency] 판끼리 독립이므로 동시에 돌린다
 * @param {number} [options.maxRetries]
 */
export function createLlm({
  apiKey,
  model = DEFAULT_MODEL,
  concurrency = 20,
  maxRetries = 4,
  timeoutMs = 120_000,
  /*
   * 추론 모델은 max_completion_tokens 안에서 추론 토큰을 먼저 쓴다. 룰북 전체가
   * 프롬프트에 들어가면 추론이 길어져서 예산을 다 먹고 본문이 빈 채로 돌아온다.
   * 수를 고르는 판단은 깊은 추론이 필요 없으므로 낮게 둔다.
   * 지원하지 않는 모델이면 자동으로 빼고 다시 보낸다.
   */
  reasoningEffort = 'low',
  /** null 이면 파라미터를 안 보낸다. 모델 자체 상한까지 쓰게 되어 빈 응답이 안 나온다. */
  maxCompletionTokens = null,
} = {}) {
  if (!apiKey) throw new LlmError('OpenAI API 키가 필요합니다');

  let sendReasoningEffort = Boolean(reasoningEffort);

  const usage = { calls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, retries: 0, failures: 0 };

  /*
   * 인증 실패처럼 재시도해도 소용없는 오류가 나면 즉시 멈춘다.
   * 이게 없으면 진행 중이던 수십 개 요청이 계속 날아가고, 그 상태로 프로세스를
   * 끝내면 libuv가 죽는다. 실패 하나에 남은 판을 다 태울 이유도 없다.
   */
  let fatal = null;

  // 동시 실행 제한. 초과분은 순서대로 기다린다.
  let active = 0;
  const waiting = [];
  const acquire = () =>
    active < concurrency
      ? ((active += 1), Promise.resolve())
      : new Promise((resolve) => waiting.push(resolve)).then(() => { active += 1; });
  const release = () => {
    active -= 1;
    waiting.shift()?.();
  };

  /**
   * JSON 객체 하나를 받아온다.
   * @param {{ system: string, user: string, maxTokens?: number }} request
   */
  async function askJson({ system, user, maxTokens = maxCompletionTokens }) {
    if (fatal) throw fatal;
    await acquire();
    let budget = maxTokens ?? null;
    try {
      if (fatal) throw fatal;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response;
        try {
          response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            signal: controller.signal,
            body: JSON.stringify({
              model,
              // 시스템 메시지가 매 턴 동일해야 캐시가 걸린다. 상황은 user 로만 보낸다.
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
              ],
              response_format: { type: 'json_object' },
              ...(budget === null ? {} : { max_completion_tokens: budget }),
              ...(sendReasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
            }),
          });
        } catch (error) {
          if (attempt === maxRetries) { usage.failures += 1; throw new LlmError(`네트워크 오류: ${error.message}`); }
          usage.retries += 1;
          await sleep(Math.min(1000 * 2 ** (attempt - 1), 15_000));
          continue;
        } finally {
          clearTimeout(timer);
        }

        if (response.status === 429 || response.status >= 500) {
          if (attempt === maxRetries) { usage.failures += 1; throw new LlmError(`${response.status} 응답이 계속됩니다`, { status: response.status }); }
          usage.retries += 1;
          /*
           * 헤더가 없으면 지수 백오프로 간다. `Number(null)` 이 0이고 그건 유한한
           * 값이라, 있는지를 isFinite 로 판정하면 헤더가 없을 때 대기가 0이 되어
           * 백오프가 통째로 사라진다. 429가 연달아 나는 상황에서 곧바로 다시
           * 때리므로 레이트 리밋이 더 오래 풀리지 않는다.
           */
          const retryAfter = Number(response.headers.get('retry-after'));
          await sleep(retryAfter > 0 ? retryAfter * 1000 : Math.min(2000 * 2 ** (attempt - 1), 30_000));
          continue;
        }

        const body = await response.text();

        // reasoning_effort 를 모르는 모델이면 빼고 다시 보낸다
        if (response.status === 400 && sendReasoningEffort && body.includes('reasoning_effort')) {
          sendReasoningEffort = false;
          usage.retries += 1;
          continue;
        }

        if (!response.ok) {
          usage.failures += 1;
          // 4xx는 재시도해도 같은 답이 온다. 남은 판을 태우지 않고 전체를 멈춘다.
          fatal = new LlmError(
            response.status === 401 || response.status === 403
              ? [
                  `OpenAI 인증에 실패했습니다 (${response.status}).`,
                  '',
                  '  - .env 의 OPENAI_API_KEY 가 맞는지 확인하세요',
                  '  - 키가 만료되었거나 폐기되지 않았는지 https://platform.openai.com/api-keys 에서 확인하세요',
                  `  - 응답: ${body.slice(0, 300)}`,
                ].join('\n')
              : response.status === 404
                ? [
                    `모델 "${model}" 을 찾을 수 없습니다 (404).`,
                    '',
                    '  - --model 로 다른 모델을 지정하거나 studio.config.json 의 models 를 확인하세요',
                    `  - 응답: ${body.slice(0, 300)}`,
                  ].join('\n')
                : `OpenAI가 ${response.status}를 돌려줬습니다: ${body.slice(0, 300)}`,
            { status: response.status, body: body.slice(0, 500) },
          );
          throw fatal;
        }

        const parsed = JSON.parse(body);
        const details = parsed.usage ?? {};
        usage.calls += 1;
        usage.inputTokens += details.prompt_tokens ?? 0;
        usage.cachedTokens += details.prompt_tokens_details?.cached_tokens ?? 0;
        usage.outputTokens += details.completion_tokens ?? 0;

        const choice = parsed.choices?.[0] ?? {};
        const content = choice.message?.content ?? '';
        const reasoningTokens = details.completion_tokens_details?.reasoning_tokens ?? 0;

        /*
         * 추론 토큰이 예산을 다 먹으면 본문이 빈 채로 finish_reason: length 가 온다.
         * 예산을 늘려 다시 시도한다. 프롬프트가 길수록 추론이 길어지므로 흔한 일이다.
         */
        if (content.trim() === '' && choice.finish_reason === 'length') {
          // 예산이 있으면 늘려서 다시. 무제한인데도 걸렸으면 추론을 줄이는 수밖에 없다.
          if (budget !== null && attempt < maxRetries) {
            budget = Math.min(budget * 2, 32_000);
            usage.retries += 1;
            continue;
          }
          usage.failures += 1;
          throw new LlmError(
            [
              `모델이 빈 응답을 냈습니다. 추론 토큰 ${reasoningTokens}개가 ${budget === null ? '모델 상한' : `예산 ${budget}`}을 다 썼습니다.`,
              '',
              `  - studio.config.json 의 sim.reasoningEffort 를 낮추세요 (지금 ${reasoningEffort})`,
              budget === null
                ? '  - 또는 룰북을 줄여 프롬프트를 짧게 만드세요'
                : '  - 또는 sim.maxCompletionTokens 를 null 로 두면 모델 상한까지 씁니다',
            ].join('\n'),
          );
        }

        try {
          return JSON.parse(content);
        } catch {
          // 모델이 JSON을 안 냈으면 한 번 더 시도한다
          if (attempt === maxRetries) {
            usage.failures += 1;
            throw new LlmError(`JSON을 받지 못했습니다 (finish_reason: ${choice.finish_reason}): ${content.slice(0, 200)}`);
          }
          usage.retries += 1;
          continue;
        }
      }
      throw new LlmError('재시도를 모두 소진했습니다');
    } finally {
      release();
    }
  }

  return { askJson, usage, model };
}

/** 토큰 사용량을 달러로. 모르는 모델이면 null. */
export function estimateCost(usage, model) {
  const price = PRICING[model];
  if (!price) return null;
  const fresh = Math.max(0, usage.inputTokens - usage.cachedTokens);
  const dollars =
    (fresh * price.input + usage.cachedTokens * price.cached + usage.outputTokens * price.output) / 1_000_000;
  return Number(dollars.toFixed(4));
}
