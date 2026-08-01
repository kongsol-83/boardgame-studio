/**
 * 시뮬레이션 공통. 엔진 계약과 플레이 루프.
 *
 * **목적은 밸런싱이 아니다.** 테이블에 들고 가기 전에 명백한 사고를 거르는 필터다.
 * 사람을 모아놓고 30분 룰 설명을 했는데 게임이 안 끝나거나 3라운드 만에 필승법이
 * 드러나면 그 자리가 통째로 날아간다. 그걸 막는 게 전부다.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROOT } from './env.mjs';

/** 엔진이 반드시 내보내야 하는 것. */
export const REQUIRED_EXPORTS = ['setup', 'legalMoves', 'applyMove', 'isTerminal', 'scores'];

/** LLM 플레이에 추가로 필요한 것. 봇만 돌릴 거면 없어도 된다. */
export const LLM_EXPORTS = ['describe', 'describeMove'];

/**
 * mulberry32. 시드를 고정하면 같은 수열이 나온다.
 * 초기 배치와 카드 순서를 재현해야 룰 개정 전후를 같은 상황에서 비교할 수 있다.
 */
export function makeRng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (max) => Math.floor(next() * max);
  next.pick = (array) => array[next.int(array.length)];
  next.shuffle = (array) => {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = next.int(i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  return next;
}

export function enginePath(slug) {
  return path.join(ROOT, 'projects', slug, 'sim', 'engine.mjs');
}

/**
 * 엔진을 불러오고 계약을 검사한다.
 *
 * 룰셋 버전이 어긋나면 멈춘다. 엔진이 룰셋보다 뒤처지면 코드가 진실이 되어버리고,
 * 룰북과 실제가 갈라지는 순간 검증 자체가 의미를 잃는다.
 */
export async function loadEngine(slug, { rulesetVersion, requireLlm = false } = {}) {
  const file = enginePath(slug);
  let engine;
  try {
    engine = await import(pathToFileURL(file).href);
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('engine.mjs')) {
      throw new Error(
        [
          `${path.relative(ROOT, file)} 이 없습니다.`,
          '',
          '/bgs-sim 으로 규칙 엔진을 먼저 구현하세요.',
          '게임 전체가 부담이면 의심스러운 핵심 루프만 떼어내도 됩니다.',
        ].join('\n'),
      );
    }
    throw error;
  }

  const missing = REQUIRED_EXPORTS.filter((name) => typeof engine[name] !== 'function');
  if (missing.length > 0) {
    throw new Error(`엔진에 다음 함수가 없습니다: ${missing.join(', ')}`);
  }

  if (requireLlm) {
    const missingLlm = LLM_EXPORTS.filter((name) => typeof engine[name] !== 'function');
    if (missingLlm.length > 0) {
      throw new Error(
        [
          `LLM 플레이에는 다음이 더 필요합니다: ${missingLlm.join(', ')}`,
          '',
          'describe(state, player) 는 그 플레이어가 보는 상황을 글로 설명하고,',
          'describeMove(move) 는 수 하나를 짧게 이름 붙입니다.',
        ].join('\n'),
      );
    }
  }

  if (rulesetVersion && engine.rulesetVersion && engine.rulesetVersion !== rulesetVersion) {
    throw new Error(
      [
        `엔진과 룰셋의 버전이 다릅니다.`,
        `  룰셋: ${rulesetVersion}`,
        `  엔진: ${engine.rulesetVersion}`,
        '',
        '엔진이 룰셋보다 뒤처진 채로 돌리면 검증한 것이 룰북과 다른 게임이 됩니다.',
        '엔진을 맞추고 상단의 rulesetVersion 을 올리세요.',
      ].join('\n'),
    );
  }

  return engine;
}

/**
 * 한 판을 끝까지 진행한다. 수를 고르는 건 chooser 에게 맡긴다.
 *
 * @param {object} engine
 * @param {object} options
 * @param {number} options.playerCount
 * @param {Function} options.rng
 * @param {(context: object) => Promise<number>|number} options.chooser 고를 수의 인덱스
 * @param {number} [options.maxTurns] 안전장치. 넘으면 미종료로 본다
 */
export async function playGame(engine, { playerCount, rng, chooser, maxTurns = 2000 }) {
  let state = engine.setup(playerCount, rng);
  const history = [];
  let turns = 0;

  while (!engine.isTerminal(state)) {
    if (turns >= maxTurns) {
      return { finished: false, reason: 'maxTurns', turns, history, state };
    }

    const moves = engine.legalMoves(state);
    if (!Array.isArray(moves) || moves.length === 0) {
      return { finished: false, reason: 'noLegalMoves', turns, history, state };
    }

    const player = typeof engine.currentPlayer === 'function' ? engine.currentPlayer(state) : (state.current ?? 0);
    const choice = await chooser({ state, moves, player, turn: turns, engine });
    const index = Number.isInteger(choice) ? choice : 0;
    if (index < 0 || index >= moves.length) {
      return { finished: false, reason: 'illegalChoice', turns, history, state };
    }

    history.push({ turn: turns, player, move: moves[index], options: moves.length, meta: choice?.meta });
    state = engine.applyMove(state, moves[index]);
    turns += 1;
  }

  const finalScores = engine.scores(state);
  const best = Math.max(...finalScores);
  const winners = finalScores.map((score, index) => (score === best ? index : -1)).filter((index) => index >= 0);

  return {
    finished: true,
    turns,
    history,
    state,
    scores: finalScores,
    winners,
    tie: winners.length > 1,
    summary: typeof engine.summarize === 'function' ? engine.summarize(state) : null,
  };
}

/** 무작위로 고른다. 게임별 전략 지식이 필요 없어서 엔진 검사에 쓴다. */
export const randomChooser = (rng) => ({ moves }) => rng.int(moves.length);

/**
 * 판들에서 통계를 뽑는다.
 * **30판으로 말할 수 있는 것만** 담는다. 지표를 늘리면 노이즈를 신호로 착각하게 된다.
 */
export function aggregate(results, { playerCount }) {
  const finished = results.filter((result) => result.finished);
  const seatWins = Array.from({ length: playerCount }, () => 0);
  const turnCounts = [];
  const moveUsage = new Map();
  let ties = 0;

  for (const result of finished) {
    if (result.tie) ties += 1;
    for (const winner of result.winners) seatWins[winner] += 1 / result.winners.length;
    turnCounts.push(result.turns);
    for (const entry of result.history) {
      const key = entry.move?.id ?? entry.move?.type ?? JSON.stringify(entry.move);
      moveUsage.set(key, (moveUsage.get(key) ?? 0) + 1);
    }
  }

  turnCounts.sort((a, b) => a - b);
  const median = turnCounts.length > 0 ? turnCounts[Math.floor(turnCounts.length / 2)] : null;

  return {
    games: results.length,
    finished: finished.length,
    unfinished: results.length - finished.length,
    unfinishedReasons: [...new Set(results.filter((r) => !r.finished).map((r) => r.reason))],
    seatWins: seatWins.map((wins) => Number(wins.toFixed(1))),
    seatWinRate: seatWins.map((wins) => (finished.length > 0 ? Number((wins / finished.length).toFixed(3)) : null)),
    ties,
    turns: { min: turnCounts[0] ?? null, median, max: turnCounts[turnCounts.length - 1] ?? null },
    moveUsage: [...moveUsage.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ move: key, count })),
  };
}
