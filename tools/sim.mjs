#!/usr/bin/env node
/**
 * 자동 플레이 시뮬레이션.
 *
 * **목적은 밸런싱이 아니다.** 테이블에 들고 가기 전에 명백한 사고를 거르는 필터다.
 * 30판 승률로 카드 수치를 조정하려 들면 오버피팅이다.
 *
 *   node tools/sim.mjs smoke <slug>      랜덤 봇으로 엔진 건전성 검사
 *   node tools/sim.mjs estimate <slug>   비용과 시간 추정
 *   node tools/sim.mjs run <slug>        LLM 플레이
 *   node tools/sim.mjs report <slug>     최근 로그를 리포트로
 *   node tools/sim.mjs serve <slug>      play.html 정적 서버
 */

import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { loadConfig } from './lib/config.mjs';
import { fileStamp, localIso } from './lib/datetime.mjs';
import { loadEnv, requireEnv, ROOT } from './lib/env.mjs';
import { createLlm, DEFAULT_MODEL, estimateCost, PRICING } from './lib/llm.mjs';
import { aggregate, loadEngine, makeRng, playGame, randomChooser } from './lib/sim.mjs';

const projectDir = (slug) => path.join(ROOT, 'projects', slug);
const simDir = (slug) => path.join(projectDir(slug), 'sim');
const logDir = (slug) => path.join(simDir(slug), 'logs');

function bail(message, hint) {
  console.error(`\n${message}${hint ? `\n\n${hint}` : ''}\n`);
  process.exit(1);
}

const log = (...args) => console.error(...args);
const output = (payload) => process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

/** ruleset.md 상단의 `버전 0.4` 를 읽는다. */
function readRuleset(slug) {
  const file = path.join(projectDir(slug), 'ruleset.md');
  if (!existsSync(file)) return { text: null, version: null };
  const text = readFileSync(file, 'utf8');
  const match = /(?:버전|version|v)\s*([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i.exec(text.slice(0, 600));
  return { text, version: match?.[1] ?? null };
}

const parsePlayers = (value) =>
  String(value ?? '3')
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isInteger(entry) && entry > 0);

// ---------------------------------------------------------------------------
// smoke — 랜덤 봇으로 엔진이 멀쩡한지
// ---------------------------------------------------------------------------

async function commandSmoke(slug, values) {
  const { version } = readRuleset(slug);
  const engine = await loadEngine(slug, { rulesetVersion: version });
  const games = Number(values.games ?? 20_000);
  const playerCounts = parsePlayers(values.players ?? '2,3,4');
  const maxTurns = Number(values['max-turns'] ?? 2000);

  log(`랜덤 봇으로 ${games}판을 돌립니다. 밸런스가 아니라 엔진 검사입니다.`);

  const problems = [];
  const byPlayers = {};
  const started = Date.now();

  for (const playerCount of playerCounts) {
    const results = [];
    for (let i = 0; i < games; i++) {
      const rng = makeRng(i + 1);
      try {
        results.push(await playGame(engine, { playerCount, rng, chooser: randomChooser(rng), maxTurns }));
      } catch (error) {
        problems.push({ playerCount, seed: i + 1, kind: 'exception', message: error.message });
        if (problems.length > 5) break;
      }
    }
    const stats = aggregate(results, { playerCount });
    byPlayers[playerCount] = stats;

    if (stats.unfinished > 0) {
      problems.push({
        playerCount,
        kind: 'unfinished',
        count: stats.unfinished,
        reasons: stats.unfinishedReasons,
        message: '끝나지 않은 판이 있습니다. 다른 어떤 지표보다 우선입니다',
      });
    }
  }

  const ok = problems.length === 0;
  output({
    command: 'sim smoke',
    slug,
    ok,
    elapsedSec: Number(((Date.now() - started) / 1000).toFixed(1)),
    gamesPerPlayerCount: games,
    byPlayers,
    problems,
    note: ok
      ? '엔진이 멀쩡합니다. run 으로 넘어가도 됩니다.'
      : '엔진을 먼저 고치세요. 교착에 빠지는 엔진으로 LLM 판을 돌리면 돈만 태웁니다.',
  });
  if (!ok) process.exit(1);
}

// ---------------------------------------------------------------------------
// estimate — 판당 결정 수를 실측해서 비용을 뽑는다
// ---------------------------------------------------------------------------

async function commandEstimate(slug, values) {
  const { version, text } = readRuleset(slug);
  const engine = await loadEngine(slug, { rulesetVersion: version });
  const config = loadConfig();
  const sim = config.sim;
  const games = Number(values.games ?? sim.games);
  const playerCounts = parsePlayers(values.players ?? '2,3,4');
  const model = values.model ?? config.models.sim ?? DEFAULT_MODEL;

  // 결정 수는 랜덤 봇으로 재도 충분히 비슷하다
  let decisions = 0;
  let sampled = 0;
  for (const playerCount of playerCounts) {
    for (let i = 0; i < 20; i++) {
      const rng = makeRng(i + 1);
      const result = await playGame(engine, { playerCount, rng, chooser: randomChooser(rng) });
      decisions += result.turns;
      sampled += 1;
    }
  }
  const perGame = Math.round(decisions / Math.max(sampled, 1));

  // 룰북이 시스템 메시지에 통째로 들어가고 캐시된다
  const rulesTokens = Math.ceil((text?.length ?? 4000) / 2.2);
  const perCall = { cachedIn: rulesTokens, freshIn: 400, out: 90 };
  const price = PRICING[model];

  const totalGames = games * playerCounts.length;
  const calls = totalGames * (perGame + 1); // 판마다 마지막에 소감 한 번
  const cost = price
    ? Number((
        (calls * perCall.cachedIn * price.cached +
          calls * perCall.freshIn * price.input +
          calls * perCall.out * price.output) / 1_000_000
      ).toFixed(2))
    : null;

  const concurrency = Number(values.concurrency ?? sim.concurrency);
  const minutes = Number(((calls * 1.5) / concurrency / 60).toFixed(1));

  output({
    command: 'sim estimate',
    slug,
    model,
    playerCounts,
    gamesPerPlayerCount: games,
    totalGames,
    decisionsPerGame: perGame,
    estimatedCalls: calls,
    estimatedCostUsd: cost,
    estimatedMinutes: minutes,
    note:
      perGame > 200
        ? `판당 결정이 ${perGame}회입니다. 게임이 너무 길다는 신호일 수 있으니 룰셋을 한 번 보세요.`
        : '30판이면 완주율, 플레이타임, 명백한 좌석 쏠림까지는 나옵니다. 그 이상은 오버피팅입니다.',
  });
}

// ---------------------------------------------------------------------------
// run — LLM 플레이
// ---------------------------------------------------------------------------

const SYSTEM_TEMPLATE = (rules) => `당신은 보드게임 플레이테스터입니다. 아래 룰북만 읽고 게임을 플레이합니다.

${rules}

--- 당신이 할 일 ---

매 턴 제시된 수 중 하나를 고릅니다. 이기려고 플레이하되, 처음 이 게임을 배우는
사람처럼 룰북에 적힌 것만 근거로 판단합니다.

반드시 아래 형식의 JSON 객체 하나만 응답합니다.

{
  "move": 고를 수의 인덱스 (정수),
  "why": "왜 골랐는지 한 문장",
  "strategy": "이번 판에서 노리는 것을 한두 단어로. 매 턴 같은 값을 유지하세요",
  "confusion": "룰북이 애매해서 헷갈린 점이 있으면 한 문장, 없으면 null"
}`;

const REVIEW_PROMPT = `방금 판이 끝났습니다. 플레이테스터로서 소감을 남겨주세요.

반드시 아래 형식의 JSON 객체 하나만 응답합니다.

{
  "interesting": "선택이 의미 있게 느껴졌는가. 그렇지 않았다면 왜",
  "boring": "지루했던 구간이 있었다면 언제쯤 어떤 이유로. 없으면 null",
  "confusing": "룰북에서 헷갈렸거나 답이 없던 부분. 없으면 null",
  "blocked": "하고 싶었는데 룰이 막은 것. 없으면 null"
}`;

async function commandRun(slug, values) {
  const apiKey = requireEnv('OPENAI_API_KEY', 'https://platform.openai.com/api-keys 에서 발급받습니다.');
  const { version, text } = readRuleset(slug);
  const engine = await loadEngine(slug, { rulesetVersion: version, requireLlm: true });

  if (!text) {
    bail(
      `projects/${slug}/ruleset.md 이 없습니다.`,
      'LLM 플레이어는 룰북을 읽고 판단합니다. 룰북이 없으면 "룰북만 읽고 이해되는가"를 테스트할 수 없습니다.',
    );
  }

  const config = loadConfig();
  const sim = config.sim;
  const games = Number(values.games ?? sim.games);
  const playerCounts = parsePlayers(values.players ?? '2,3,4');
  const model = values.model ?? config.models.sim ?? DEFAULT_MODEL;
  const concurrency = Number(values.concurrency ?? sim.concurrency);

  const llm = createLlm({
    apiKey,
    model,
    concurrency,
    reasoningEffort: sim.reasoningEffort,
    maxCompletionTokens: sim.maxCompletionTokens,
  });
  const system = SYSTEM_TEMPLATE(text);

  log(
    `${model} 로 ${games} x ${playerCounts.length}판을 돌립니다. 동시 ${concurrency}판. ` +
      `추론 ${sim.reasoningEffort} · 토큰 예산 ${sim.maxCompletionTokens ?? '무제한'}`,
  );

  const started = Date.now();
  const perPlayers = {};
  const reviews = [];
  const confusions = [];
  const strategyTally = new Map();
  const focus = values.focus?.trim() || null;

  for (const playerCount of playerCounts) {
    const tasks = Array.from({ length: games }, (_, index) => async () => {
      // 초기 배치는 같은 시드를 쓴다. 상황을 고정하고 판단만 흔들리게 해서
      // 룰 개정 전후 비교의 노이즈를 줄인다.
      const rng = makeRng(index + 1);
      const strategies = new Map();

      const result = await playGame(engine, {
        playerCount,
        rng,
        chooser: async ({ state, moves, player }) => {
          const options = moves.map((move, i) => `${i}. ${engine.describeMove(move)}`).join('\n');
          const answer = await llm.askJson({
            system,
            user: `${engine.describe(state, player)}\n\n--- 고를 수 있는 수 ---\n${options}`,
          });
          if (answer.confusion) confusions.push({ playerCount, seat: player, note: String(answer.confusion) });
          if (answer.strategy) strategies.set(player, String(answer.strategy));
          const index = Number(answer.move);
          return Number.isInteger(index) && index >= 0 && index < moves.length ? index : 0;
        },
      });

      if (result.finished) {
        try {
          const review = await llm.askJson({ system, user: REVIEW_PROMPT });
          reviews.push({ playerCount, ...review });
        } catch {
          // 소감을 못 받아도 판 자체는 유효하다
        }
      }
      /*
       * LLM이 스스로 붙인 전략 태그를 승패와 함께 센다. 특정 전략이 계속 이기면
       * 지배 전략 후보다. 봇으로는 이런 신호를 못 얻는다.
       */
      for (const [seat, tag] of strategies) {
        const key = String(tag).trim().slice(0, 40);
        const entry = strategyTally.get(key) ?? { tag: key, played: 0, won: 0 };
        entry.played += 1;
        if (result.finished && result.winners.includes(seat)) entry.won += 1 / result.winners.length;
        strategyTally.set(key, entry);
      }

      return { ...result, strategies: Object.fromEntries(strategies) };
    });

    const results = await Promise.all(tasks.map((task) => task()));
    perPlayers[playerCount] = { ...aggregate(results, { playerCount }), raw: results };
    log(`  ${playerCount}인 ${results.length}판 완료`);
  }

  /*
   * 인원별 첫 판만 수 인덱스를 남긴다. 90판 전부의 이력을 담으면 로그가 커지는데,
   * 리플레이는 "왜 이렇게 됐는지"를 눈으로 보려는 것이라 몇 판이면 충분하다.
   * 엔진이 결정적이므로 시드와 인덱스만 있으면 그대로 재생된다.
   */
  const samples = Object.entries(perPlayers).map(([playerCount, stats]) => ({
    playerCount: Number(playerCount),
    seed: 1,
    moves: (stats.raw?.[0]?.history ?? []).map((entry) => entry.index),
    scores: stats.raw?.[0]?.scores ?? null,
  }));

  // 로그 저장
  mkdirSync(logDir(slug), { recursive: true });
  const logFile = path.join(logDir(slug), `${fileStamp()}.json`);
  writeFileSync(
    logFile,
    JSON.stringify(
      {
        at: localIso(),
        model,
        rulesetVersion: version,
        focus,
        playerCounts,
        gamesPerPlayerCount: games,
        strategies: [...strategyTally.values()]
          .map((entry) => ({ ...entry, won: Number(entry.won.toFixed(1)), winRate: Number((entry.won / entry.played).toFixed(2)) }))
          .sort((a, b) => b.played - a.played),
        byPlayers: Object.fromEntries(
          Object.entries(perPlayers).map(([key, value]) => [key, { ...value, raw: undefined }]),
        ),
        reviews,
        confusions,
        samples,
      },
      null,
      2,
    ),
  );

  const cost = estimateCost(llm.usage, model);
  output({
    command: 'sim run',
    slug,
    model,
    rulesetVersion: version,
    log: path.relative(ROOT, logFile),
    elapsedMin: Number(((Date.now() - started) / 60_000).toFixed(1)),
    usage: { ...llm.usage, cacheHitRate: llm.usage.inputTokens > 0 ? Number((llm.usage.cachedTokens / llm.usage.inputTokens).toFixed(2)) : 0 },
    costUsd: cost,
    byPlayers: Object.fromEntries(Object.entries(perPlayers).map(([key, value]) => [key, { ...value, raw: undefined }])),
    confusionCount: confusions.length,
    next: `node tools/sim.mjs report ${slug}`,
  });
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

/**
 * 90판에서 나온 소감과 헷갈린 대목을 묶어 정리한다.
 *
 * 표현만 다르고 같은 말이 반복되는데, 문자열 비교로는 못 묶는다. 이건 기계적인
 * 정리 작업이라 모델에 맡기고, 해석과 제안은 검토 단계의 에이전트에게 남긴다.
 * 리포트당 한 번만 부르므로 플레이 모델보다 좋은 걸 써도 부담이 적다.
 */
async function clusterFeedback(data, { model, apiKey }) {
  const confusions = (data.confusions ?? []).map((entry) => entry.note);
  const reviews = data.reviews ?? [];
  if (confusions.length === 0 && reviews.length === 0) return null;

  const llm = createLlm({ apiKey, model, concurrency: 1 });
  const payload = {
    focus: data.focus ?? null,
    confusions,
    reviews: reviews.map((review) => ({
      interesting: review.interesting ?? null,
      boring: review.boring ?? null,
      confusing: review.confusing ?? null,
      blocked: review.blocked ?? null,
    })),
  };

  try {
    return await llm.askJson({
      system: [
        '보드게임 플레이테스트에서 나온 피드백을 정리하는 일을 합니다.',
        '',
        '같은 말이 표현만 다르게 반복되므로 묶어서 빈도순으로 정리하세요.',
        '**해석하거나 제안하지 마세요.** 무엇을 고쳐야 한다는 말은 쓰지 않습니다.',
        '그건 다음 단계에서 다른 사람이 합니다. 여기서는 무엇이 관찰됐는지만 정리합니다.',
        '',
        '반드시 아래 형식의 JSON 객체 하나만 응답합니다.',
        '{',
        '  "themes": [{ "note": "묶은 관찰 한 문장", "count": 몇 번 나왔는지, "kind": "rulebook" 또는 "unclear" }],',
        '  "boring": ["지루했다는 언급을 묶은 것"],',
        '  "blocked": ["하고 싶은데 막혔다는 언급을 묶은 것"],',
        '  "focusAnswer": "focus 질문에 대해 이 피드백이 말해주는 것. focus 가 null 이면 null"',
        '}',
        '',
        'kind 는 룰북에 정보가 없다는 지적이면 rulebook, 그 외 애매함이면 unclear 입니다.',
      ].join('\n'),
      user: JSON.stringify(payload),
    });
  } catch (error) {
    log(`피드백 정리를 건너뜁니다: ${error.message.split('\n')[0]}`);
    return null;
  }
}

async function commandReport(slug, values) {
  const dir = logDir(slug);
  const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')).sort() : [];
  if (files.length === 0) bail('시뮬레이션 로그가 없습니다.', `node tools/sim.mjs run ${slug} 를 먼저 실행하세요.`);

  const data = JSON.parse(readFileSync(path.join(dir, files[files.length - 1]), 'utf8'));
  const lines = [];

  lines.push(`# 시뮬레이션 리포트 ${data.at.slice(0, 10)}`);
  lines.push('');
  lines.push(`룰셋 v${data.rulesetVersion ?? '?'} · ${data.model} · 인원별 ${data.gamesPerPlayerCount}판`);
  lines.push('');

  if (data.focus) {
    lines.push('## 이번에 확인하려던 것');
    lines.push('');
    lines.push(`> ${data.focus}`);
    lines.push('');
    lines.push('검토는 이 질문에 먼저 답해야 합니다. 나머지는 그다음입니다.');
    lines.push('');
  }

  lines.push('> 이 리포트는 사실만 담습니다. 해석과 제안은 `/bgs-sim` 의 검토 단계에서');
  lines.push('> 각 각도별 에이전트가 붙입니다.');
  lines.push('>');
  lines.push('> 밸런스를 결정하는 자리가 아닙니다. 아래 판수로는 완주율, 플레이타임, 명백한');
  lines.push('> 좌석 쏠림까지만 말할 수 있고, 미세한 승률 차이로 수치를 조정하면 오버피팅입니다.');
  lines.push('');

  const flags = [];
  lines.push('## 인원별');
  lines.push('');
  for (const [players, stats] of Object.entries(data.byPlayers)) {
    lines.push(`### ${players}인`);
    lines.push('');
    lines.push(`- 완주 ${stats.finished}/${stats.games}${stats.unfinished > 0 ? ` (미종료 ${stats.unfinished}: ${stats.unfinishedReasons.join(', ')})` : ''}`);
    lines.push(`- 턴 수 최소 ${stats.turns.min} · 중앙 ${stats.turns.median} · 최대 ${stats.turns.max}`);
    lines.push(`- 좌석별 승수 ${stats.seatWins.join(' / ')}${stats.ties > 0 ? ` · 동점 ${stats.ties}판` : ''}`);
    lines.push('');

    if (stats.unfinished > 0) flags.push(`${players}인에서 끝나지 않은 판이 ${stats.unfinished}건입니다. 다른 어떤 지표보다 우선입니다.`);

    /*
     * 명백한 쏠림만 본다. 표본이 적으면 아예 판정하지 않는다.
     * 3판에서 한 좌석이 83% 나오는 건 우연이지 신호가 아닌데, 경고로 올리면
     * 쓸데없는 개정을 부른다. 판수 부족은 부족하다고 말하는 게 맞다.
     */
    const MIN_SAMPLE = 20;
    const expected = 1 / Number(players);
    const worst = stats.seatWinRate.reduce((acc, rate, seat) => (rate > (acc?.rate ?? 0) ? { seat, rate } : acc), null);

    if (stats.finished < MIN_SAMPLE) {
      lines.push(`- 판수가 ${stats.finished}판이라 좌석 편중은 판단하지 않습니다 (최소 ${MIN_SAMPLE}판)`);
      lines.push('');
    } else if (worst && worst.rate > expected * 2) {
      flags.push(`${players}인에서 ${worst.seat + 1}번 좌석이 ${(worst.rate * 100).toFixed(0)}% 승률입니다 (기대 ${(expected * 100).toFixed(0)}%). 명백한 쏠림입니다.`);
    }
  }

  const unused = [];
  for (const stats of Object.values(data.byPlayers)) {
    for (const entry of stats.moveUsage ?? []) if (entry.count === 0) unused.push(entry.move);
  }

  /*
   * 전략 태그는 LLM이 스스로 붙인 것이라 표현이 제각각이다. 그래도 한 갈래가
   * 압도적으로 이기면 지배 전략 후보로 볼 만하다. 표본이 적은 건 버린다.
   */
  const totalFinished = Object.values(data.byPlayers).reduce((sum, stats) => sum + stats.finished, 0);
  const strategies = (data.strategies ?? []).filter((entry) => entry.played >= 3);
  if (strategies.length > 0) {
    lines.push('## 플레이어가 노린 전략');
    lines.push('');
    lines.push('LLM이 판마다 스스로 붙인 태그입니다. 표현이 제각각이라 그대로 믿을 수는 없지만,');
    lines.push('한 갈래가 압도적으로 이기면 지배 전략 후보로 볼 만합니다.');
    lines.push('');
    for (const entry of strategies.slice(0, 12)) {
      lines.push(`- ${entry.tag} — ${entry.played}회, 승률 ${(entry.winRate * 100).toFixed(0)}%`);
    }
    lines.push('');

    // 좌석 편중과 같은 이유로 표본이 적으면 판정하지 않는다
    if (totalFinished >= 20) {
      for (const entry of strategies.filter((item) => item.played >= 10 && item.winRate >= 0.6)) {
        flags.push(`"${entry.tag}" 가 ${entry.played}회 중 승률 ${(entry.winRate * 100).toFixed(0)}% 입니다. 지배 전략인지 확인하세요.`);
      }
    }
  }

  lines.push('## 눈에 띄는 것');
  lines.push('');
  if (flags.length === 0) lines.push('- 완주율과 좌석 쏠림에서 명백한 문제는 안 보입니다.');
  for (const flag of flags) lines.push(`- ${flag}`);
  if (unused.length > 0) lines.push(`- 한 번도 안 쓰인 수: ${unused.join(', ')}`);
  lines.push('');

  // 모델로 묶은 결과가 있으면 그걸 쓰고, 없으면 원문을 그대로 센다
  const clustered = values.raw ? null : await clusterFeedback(data, {
    model: loadConfig().models.review,
    apiKey: process.env.OPENAI_API_KEY?.trim(),
  });

  if (clustered?.focusAnswer && data.focus) {
    lines.push('### 피드백이 말해주는 것');
    lines.push('');
    lines.push(clustered.focusAnswer);
    lines.push('');
  }

  if (clustered?.themes?.length > 0) {
    lines.push('## 룰북에서 헷갈린 대목');
    lines.push('');
    lines.push('플레이 도중 나온 지적을 묶었습니다. **룰북의 애매한 자리를 그대로 가리킵니다.**');
    lines.push('`rulebook` 은 룰북에 정보가 없다는 지적이고, `unclear` 는 그 외 애매함입니다.');
    lines.push('');
    for (const theme of clustered.themes.slice(0, 15)) {
      lines.push(`- (${theme.count}회 · ${theme.kind}) ${theme.note}`);
    }
    lines.push('');
  } else if (data.confusions?.length > 0) {
    lines.push('## 룰북에서 헷갈린 대목');
    lines.push('');
    const counted = new Map();
    for (const entry of data.confusions) counted.set(entry.note, (counted.get(entry.note) ?? 0) + 1);
    for (const [note, count] of [...counted.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      lines.push(`- (${count}회) ${note}`);
    }
    lines.push('');
  }

  for (const [key, label] of [['boring', '지루했던 구간'], ['blocked', '룰이 막은 것']]) {
    if (!clustered?.[key]?.length) continue;
    lines.push(`## ${label}`);
    lines.push('');
    for (const note of clustered[key].slice(0, 8)) lines.push(`- ${note}`);
    lines.push('');
  }

  if (!clustered && data.reviews?.length > 0) {
    lines.push('## 플레이 소감 (원문)');
    lines.push('');
    for (const key of ['confusing', 'boring', 'blocked', 'interesting']) {
      const label = { confusing: '헷갈린 것', boring: '지루했던 구간', blocked: '룰이 막은 것', interesting: '선택의 의미' }[key];
      const notes = data.reviews.map((review) => review[key]).filter((note) => note && note !== 'null');
      if (notes.length === 0) continue;
      lines.push(`### ${label}`);
      lines.push('');
      for (const note of [...new Set(notes)].slice(0, 8)) lines.push(`- ${note}`);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push('## 다음: 검토');
  lines.push('');
  lines.push('여기까지는 사실입니다. 해석과 제안은 다음 단계에서 붙입니다.');
  lines.push('`/bgs-sim` 의 검토 단계나 `/bgs-review` 로 넘기세요.');
  lines.push('');
  lines.push('- **컨셉과 테마** — 이 결과가 concept.md 의 핵심 동사를 만들어내고 있는가');
  lines.push('- **메커니즘** — 겉도는 것, 다운타임, 지배 전략의 구조적 원인');
  lines.push('- **룰** — 위의 "헷갈린 대목"이 룰북 결함인지 엔진 describe 누락인지');
  lines.push('- **밸런스** — 수치로 뒷받침되는 것과 판수 부족으로 보류할 것');
  lines.push('');

  const outFile = path.join(projectDir(slug), 'playtest', `sim-${data.at.slice(0, 10)}.md`);
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${lines.join('\n')}\n`);

  output({
    command: 'sim report',
    slug,
    source: files[files.length - 1],
    output: path.relative(ROOT, outFile),
    focus: data.focus ?? null,
    clusteredBy: clustered ? loadConfig().models.review : null,
    flags,
    next: '이 리포트를 각 각도별 에이전트에게 넘겨 해석과 제안을 받으세요.',
  });
}

// ---------------------------------------------------------------------------
// serve — play.html
// ---------------------------------------------------------------------------

function commandServe(slug, values) {
  const root = path.resolve(projectDir(slug));
  const port = Number(values.port ?? 4173);
  /*
   * 루프백에만 바인딩한다. 이 서버는 프로젝트 폴더를 그대로 내주고, 그 안에는 아직
   * 공개하지 않은 룰셋과 컴포넌트가 있다. 기본으로 모든 인터페이스에 열면 같은 네트워크의
   * 아무 기기나 미공개 출품작을 읽는다. 저장소가 gitignore와 CI로 막아둔 것을
   * 로컬 서버가 뚫어주면 앞의 방어가 의미를 잃는다.
   *
   * 태블릿을 테이블에 놓고 플레이하려면 --host 0.0.0.0 으로 직접 연다.
   */
  const host = values.host ?? '127.0.0.1';
  const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8' };

  createServer((request, response) => {
    /*
     * URL 파서가 `/../` 는 정규화하지만 `%2e%2e%2f` 는 그대로 남긴다. 그걸 풀고 나서
     * 경로를 합치므로 아래 포함 검사가 실제 방어선이다.
     *
     * 구분자를 붙여서 비교한다. 붙이지 않으면 프로젝트 이름이 `example` 일 때
     * `example-tidepool` 이 접두어로 걸려서 옆 프로젝트가 열린다.
     */
    const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = requested === '/' ? '/sim/play.html' : requested;
    const file = path.resolve(path.join(root, relative));

    if (!(file + path.sep).startsWith(root + path.sep) || !existsSync(file)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('없습니다');
      return;
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
    response.end(readFileSync(file));
  }).listen(port, host, () => {
    log(`http://${host === '0.0.0.0' ? 'localhost' : host}:${port} 에서 열립니다. Ctrl+C 로 종료.`);
    if (host !== '127.0.0.1' && host !== 'localhost') {
      log(`주의: ${host} 로 열었습니다. 같은 네트워크의 다른 기기가 projects/${slug}/ 를 읽습니다.`);
    }
  });
}

// ---------------------------------------------------------------------------

const USAGE = `
자동 플레이 시뮬레이션

  smoke <slug> [--games 20000] [--players 2,3,4]
      랜덤 봇으로 엔진 건전성 검사. 교착, 무한 루프, 예외, 미종료 판을 잡는다.
      밸런스 판단이 아니다. run 전에 반드시 통과해야 한다.

  estimate <slug> [--games 30] [--model gpt-5.4-nano]
      판당 결정 수를 실측해 비용과 시간을 추정한다.

  run <slug> [--games 30] [--players 2,3,4] [--model] [--concurrency 20] [--focus "..."]
      LLM 플레이. 룰북을 읽고 판단하므로 "룰북만 읽고 이해되는가"가 함께 검증된다.
      --focus 에 이번에 확인하려는 것을 적어두면 리포트와 검토가 그걸 먼저 다룬다.

  report <slug> [--raw]
      최근 로그를 playtest/sim-YYYY-MM-DD.md 로 정리한다. 표현만 다르고 같은 말인
      피드백을 models.review 모델로 묶는다. --raw 는 묶지 않고 원문을 그대로 낸다.

  serve <slug> [--port 4173] [--host 0.0.0.0]
      sim/play.html 정적 서버. 사람이 직접 플레이하거나 리플레이를 본다.
      기본은 루프백만 듣는다. --host 로 열면 같은 네트워크가 프로젝트 폴더를 읽는다.

목적은 밸런싱이 아니라 테이블에 가기 전 사고 방지다.
`;

loadEnv();
loadConfig();

const { values, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    games: { type: 'string' },
    players: { type: 'string' },
    model: { type: 'string' },
    concurrency: { type: 'string' },
    'max-turns': { type: 'string' },
    focus: { type: 'string' },
    raw: { type: 'boolean' },
    port: { type: 'string' },
    host: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

const [command, slug] = positionals;
if (values.help || !command) {
  console.error(USAGE);
  process.exit(command ? 0 : 1);
}
if (!slug) bail(`${command} 에는 프로젝트 슬러그가 필요합니다.`, USAGE);

try {
  if (command === 'smoke') await commandSmoke(slug, values);
  else if (command === 'estimate') await commandEstimate(slug, values);
  else if (command === 'run') await commandRun(slug, values);
  else if (command === 'report') await commandReport(slug, values);
  else if (command === 'serve') commandServe(slug, values);
  else bail(`알 수 없는 커맨드: ${command}`, USAGE);
} catch (error) {
  console.error(`\n${error.message}\n`);
  if (process.env.DEBUG) console.error(error);
  /*
   * process.exit 로 즉시 끝내면 아직 떠 있는 fetch 핸들 때문에 libuv가 죽는다.
   * exitCode 만 세우고 이벤트 루프가 자연히 비도록 둔다.
   */
  process.exitCode = 1;
}
