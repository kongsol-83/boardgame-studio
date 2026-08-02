import assert from 'node:assert/strict';
import test from 'node:test';

import { createLlm, estimateCost, LlmError, PRICING } from '../tools/lib/llm.mjs';

/**
 * fetch 를 갈아끼운다. 실제로 호출하지 않으므로 키도 네트워크도 필요 없다.
 * 여기가 돈이 나가는 경로라 재시도와 중단 조건을 눈으로 확인해둘 필요가 있다.
 */
function withFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options) => {
    const index = calls.length;
    calls.push({ url, body: JSON.parse(options.body) });
    const reply = await handler(index, calls);
    return {
      status: reply.status ?? 200,
      ok: (reply.status ?? 200) < 400,
      headers: { get: (name) => reply.headers?.[name.toLowerCase()] ?? null },
      text: async () => (typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)),
    };
  };

  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** 정상 응답 한 개. */
const answer = (content, extra = {}) => ({
  body: {
    choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 800 }, ...extra },
  },
});

const ask = (llm) => llm.askJson({ system: '룰북', user: '지금 상황' });

// --- 비용 -------------------------------------------------------------------

test('캐시된 입력은 더 싸게 계산한다', () => {
  const price = PRICING['gpt-5.6-luna'];
  const usage = { inputTokens: 1_000_000, cachedTokens: 900_000, outputTokens: 100_000 };
  const expected = (100_000 * price.input + 900_000 * price.cached + 100_000 * price.output) / 1_000_000;

  assert.equal(estimateCost(usage, 'gpt-5.6-luna'), Number(expected.toFixed(4)));
});

test('캐시가 없을 때보다 있을 때가 싸다', () => {
  const cold = estimateCost({ inputTokens: 1_000_000, cachedTokens: 0, outputTokens: 0 }, 'gpt-5.6-luna');
  const warm = estimateCost({ inputTokens: 1_000_000, cachedTokens: 1_000_000, outputTokens: 0 }, 'gpt-5.6-luna');
  assert.ok(warm < cold);
});

test('캐시가 입력보다 많다고 적혀도 음수가 되지 않는다', () => {
  const cost = estimateCost({ inputTokens: 100, cachedTokens: 500, outputTokens: 0 }, 'gpt-5.6-luna');
  assert.ok(cost >= 0);
});

test('모르는 모델이면 null 을 돌려준다', () => {
  assert.equal(estimateCost({ inputTokens: 1, cachedTokens: 0, outputTokens: 1 }, '없는-모델'), null);
});

// --- 만들 때 ----------------------------------------------------------------

test('키가 없으면 만들 때 막는다', () => {
  assert.throws(() => createLlm({}), LlmError);
});

// --- 정상 경로 --------------------------------------------------------------

test('JSON을 돌려주고 토큰을 집계한다', async () => {
  const fake = withFetch(() => answer({ move: 2 }));
  try {
    const llm = createLlm({ apiKey: 'test', model: 'gpt-5.6-luna' });
    assert.deepEqual(await ask(llm), { move: 2 });

    assert.equal(llm.usage.calls, 1);
    assert.equal(llm.usage.inputTokens, 1000);
    assert.equal(llm.usage.cachedTokens, 800);
    assert.equal(llm.usage.outputTokens, 50);
    assert.equal(llm.usage.retries, 0);
  } finally {
    fake.restore();
  }
});

test('룰 요약은 시스템 메시지에만 넣는다', async () => {
  // 시스템 메시지가 매 턴 같아야 프롬프트 캐시가 걸린다. 상황은 user 로만 보낸다
  const fake = withFetch(() => answer({ move: 0 }));
  try {
    const llm = createLlm({ apiKey: 'test' });
    await ask(llm);
    const [{ body }] = fake.calls;
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.messages[0].content, '룰북');
    assert.equal(body.messages[1].content, '지금 상황');
    assert.deepEqual(body.response_format, { type: 'json_object' });
  } finally {
    fake.restore();
  }
});

test('예산이 null 이면 파라미터를 아예 안 보낸다', async () => {
  const fake = withFetch(() => answer({ move: 0 }));
  try {
    await ask(createLlm({ apiKey: 'test', maxCompletionTokens: null }));
    assert.equal('max_completion_tokens' in fake.calls[0].body, false);
  } finally {
    fake.restore();
  }
});

// --- 재시도 -----------------------------------------------------------------

test('429 다음에 성공하면 재시도로 센다', async () => {
  const fake = withFetch((index) =>
    index === 0
      ? { status: 429, headers: { 'retry-after': '0.02' }, body: 'rate limited' }
      : answer({ move: 1 }),
  );
  try {
    const llm = createLlm({ apiKey: 'test' });
    assert.deepEqual(await ask(llm), { move: 1 });
    assert.equal(fake.calls.length, 2);
    assert.equal(llm.usage.retries, 1);
    assert.equal(llm.usage.calls, 1);
  } finally {
    fake.restore();
  }
});

test('429가 재시도 안에 안 풀리면 상태 코드를 알려준다', async () => {
  const fake = withFetch(() => ({ status: 429, body: 'rate limited' }));
  try {
    const llm = createLlm({ apiKey: 'test', maxRetries: 1 });
    await assert.rejects(() => ask(llm), (error) => {
      assert.match(error.message, /429/);
      assert.equal(error.status, 429);
      return true;
    });
    assert.equal(llm.usage.failures, 1);
  } finally {
    fake.restore();
  }
});

test('reasoning_effort 를 모르는 모델이면 빼고 다시 보낸다', async () => {
  const fake = withFetch((index) =>
    index === 0
      ? { status: 400, body: JSON.stringify({ error: { message: "Unsupported parameter: 'reasoning_effort'" } }) }
      : answer({ move: 0 }),
  );
  try {
    const llm = createLlm({ apiKey: 'test', reasoningEffort: 'low' });
    assert.deepEqual(await ask(llm), { move: 0 });

    assert.equal(fake.calls[0].body.reasoning_effort, 'low');
    assert.equal('reasoning_effort' in fake.calls[1].body, false);
  } finally {
    fake.restore();
  }
});

test('한 번 빼면 다음 요청부터도 안 보낸다', async () => {
  const fake = withFetch((index) =>
    index === 0
      ? { status: 400, body: JSON.stringify({ error: { message: "Unsupported parameter: 'reasoning_effort'" } }) }
      : answer({ move: 0 }),
  );
  try {
    const llm = createLlm({ apiKey: 'test', reasoningEffort: 'low' });
    await ask(llm);
    await ask(llm);
    assert.equal('reasoning_effort' in fake.calls[2].body, false);
  } finally {
    fake.restore();
  }
});

test('추론이 예산을 다 먹으면 예산을 늘려 다시 시도한다', async () => {
  const empty = {
    body: {
      choices: [{ message: { content: '' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 900, completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 100 } },
    },
  };
  const fake = withFetch((index) => (index === 0 ? empty : answer({ move: 3 })));
  try {
    const llm = createLlm({ apiKey: 'test', maxCompletionTokens: 100, maxRetries: 3 });
    assert.deepEqual(await ask(llm), { move: 3 });

    assert.equal(fake.calls[0].body.max_completion_tokens, 100);
    assert.equal(fake.calls[1].body.max_completion_tokens, 200);
    // 빈 응답도 과금되므로 호출로 센다
    assert.equal(llm.usage.calls, 2);
    assert.equal(llm.usage.retries, 1);
  } finally {
    fake.restore();
  }
});

test('예산이 무제한인데도 비어 오면 무엇을 낮추라고 알려준다', async () => {
  const fake = withFetch(() => ({
    body: {
      choices: [{ message: { content: '' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 900, completion_tokens: 4000, completion_tokens_details: { reasoning_tokens: 4000 } },
    },
  }));
  try {
    const llm = createLlm({ apiKey: 'test', maxCompletionTokens: null, reasoningEffort: 'high' });
    await assert.rejects(() => ask(llm), (error) => {
      assert.match(error.message, /빈 응답/);
      assert.match(error.message, /reasoningEffort/);
      assert.match(error.message, /high/);
      return true;
    });
  } finally {
    fake.restore();
  }
});

test('JSON이 아니면 다시 시도하고 끝까지 아니면 내용을 보여준다', async () => {
  const notJson = {
    body: { choices: [{ message: { content: '카드를 내겠습니다' }, finish_reason: 'stop' }], usage: {} },
  };
  const fake = withFetch(() => notJson);
  try {
    const llm = createLlm({ apiKey: 'test', maxRetries: 2 });
    await assert.rejects(() => ask(llm), (error) => {
      assert.match(error.message, /JSON을 받지 못했습니다/);
      assert.match(error.message, /카드를 내겠습니다/);
      return true;
    });
    assert.equal(fake.calls.length, 2);
  } finally {
    fake.restore();
  }
});

test('네트워크 오류도 재시도한다', async () => {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async () => {
    count += 1;
    if (count === 1) throw new Error('socket hang up');
    return {
      status: 200,
      ok: true,
      headers: { get: () => null },
      text: async () => JSON.stringify(answer({ move: 0 }).body),
    };
  };
  try {
    const llm = createLlm({ apiKey: 'test' });
    assert.deepEqual(await ask(llm), { move: 0 });
    assert.equal(llm.usage.retries, 1);
  } finally {
    globalThis.fetch = original;
  }
});

// --- 즉시 중단 --------------------------------------------------------------

test('인증 실패는 즉시 멈추고 다음 요청은 보내지도 않는다', async () => {
  /*
   * 이게 없으면 진행 중이던 수십 개 요청이 계속 날아간다. 90판을 동시에 돌리는
   * 중이었다면 전부 401을 받고 나서 끝난다.
   */
  const fake = withFetch(() => ({ status: 401, body: 'invalid api key' }));
  try {
    const llm = createLlm({ apiKey: 'test' });

    await assert.rejects(() => ask(llm), (error) => {
      assert.match(error.message, /인증에 실패했습니다/);
      assert.match(error.message, /OPENAI_API_KEY/);
      return true;
    });
    assert.equal(fake.calls.length, 1);

    await assert.rejects(() => ask(llm), /인증에 실패했습니다/);
    assert.equal(fake.calls.length, 1, '두 번째 요청이 나갔다');
  } finally {
    fake.restore();
  }
});

test('없는 모델이면 어디를 고치라고 알려준다', async () => {
  const fake = withFetch(() => ({ status: 404, body: 'model not found' }));
  try {
    const llm = createLlm({ apiKey: 'test', model: '없는-모델' });
    await assert.rejects(() => ask(llm), (error) => {
      assert.match(error.message, /없는-모델/);
      assert.match(error.message, /studio\.config\.json/);
      return true;
    });
    assert.equal(fake.calls.length, 1);
  } finally {
    fake.restore();
  }
});

// --- 동시 실행 --------------------------------------------------------------

test('동시 실행 수를 넘기지 않는다', async () => {
  let inFlight = 0;
  let peak = 0;
  const original = globalThis.fetch;

  globalThis.fetch = async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return {
      status: 200,
      ok: true,
      headers: { get: () => null },
      text: async () => JSON.stringify(answer({ move: 0 }).body),
    };
  };

  try {
    const llm = createLlm({ apiKey: 'test', concurrency: 2 });
    await Promise.all(Array.from({ length: 6 }, () => ask(llm)));
    assert.equal(peak, 2);
    assert.equal(llm.usage.calls, 6);
  } finally {
    globalThis.fetch = original;
  }
});
