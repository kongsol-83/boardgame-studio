import assert from 'node:assert/strict';
import test from 'node:test';

import { aggregate, loadEngine, makeRng, playGame, randomChooser } from '../tools/lib/sim.mjs';

/**
 * 검사용 엔진. 매 턴 고른 수만큼 점수를 얻고 정해진 턴 수에 끝난다.
 * 게임 내용은 중요하지 않고 루프가 계약대로 도는지만 본다.
 */
function makeEngine({ turns = 4, moves = [1, 2] } = {}) {
  return {
    setup: (playerCount) => ({ playerCount, current: 0, turn: 0, points: Array(playerCount).fill(0) }),
    legalMoves: () => moves.map((gain) => ({ id: `+${gain}`, gain })),
    applyMove: (state, move) => ({
      ...state,
      points: state.points.map((point, index) => (index === state.current ? point + move.gain : point)),
      current: (state.current + 1) % state.playerCount,
      turn: state.turn + 1,
    }),
    isTerminal: (state) => state.turn >= turns,
    scores: (state) => state.points,
  };
}

// --- 난수 -------------------------------------------------------------------

test('같은 시드는 같은 수열을 낸다', () => {
  const a = makeRng(42);
  const b = makeRng(42);
  const left = [a(), a(), a()];
  const right = [b(), b(), b()];
  assert.deepEqual(left, right);
  assert.ok(left.every((value) => value >= 0 && value < 1));
});

test('시드가 다르면 수열이 다르다', () => {
  assert.notEqual(makeRng(1)(), makeRng(2)());
});

test('shuffle 은 원본을 바꾸지 않고 같은 시드에서 같은 결과를 낸다', () => {
  const source = [1, 2, 3, 4, 5, 6, 7, 8];
  const first = makeRng(7).shuffle(source);
  const second = makeRng(7).shuffle(source);

  assert.deepEqual(source, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(first, second);
  assert.deepEqual([...first].sort((a, b) => a - b), source);
});

test('int 는 범위 안에 있고 pick 은 배열에서 고른다', () => {
  const rng = makeRng(3);
  for (let i = 0; i < 50; i++) {
    const value = rng.int(5);
    assert.ok(Number.isInteger(value) && value >= 0 && value < 5);
  }
  assert.ok(['a', 'b', 'c'].includes(rng.pick(['a', 'b', 'c'])));
});

// --- 한 판 진행 -------------------------------------------------------------

test('끝까지 진행하고 승자를 찾는다', async () => {
  // 0번은 항상 +2, 나머지는 +1을 고르게 해서 승자를 정해둔다
  const result = await playGame(makeEngine({ turns: 4 }), {
    playerCount: 2,
    rng: makeRng(1),
    chooser: ({ player }) => (player === 0 ? 1 : 0),
  });

  assert.equal(result.finished, true);
  assert.equal(result.turns, 4);
  assert.deepEqual(result.scores, [4, 2]);
  assert.deepEqual(result.winners, [0]);
  assert.equal(result.tie, false);
});

test('동점이면 승자가 둘이고 tie 로 표시한다', async () => {
  const result = await playGame(makeEngine({ turns: 4 }), {
    playerCount: 2,
    rng: makeRng(1),
    chooser: () => 0,
  });

  assert.deepEqual(result.scores, [2, 2]);
  assert.deepEqual(result.winners, [0, 1]);
  assert.equal(result.tie, true);
});

test('history 에 고른 인덱스가 남아 리플레이가 된다', async () => {
  const engine = makeEngine({ turns: 6 });
  const options = { playerCount: 3, chooser: randomChooser(makeRng(99)) };

  const first = await playGame(engine, { ...options, rng: makeRng(5), chooser: randomChooser(makeRng(99)) });
  const second = await playGame(engine, { ...options, rng: makeRng(5), chooser: randomChooser(makeRng(99)) });

  assert.deepEqual(
    first.history.map((entry) => [entry.turn, entry.player, entry.index]),
    second.history.map((entry) => [entry.turn, entry.player, entry.index]),
  );
  assert.equal(first.history[0].options, 2);
});

test('끝나지 않으면 maxTurns 로 잘라내고 이유를 남긴다', async () => {
  const endless = { ...makeEngine(), isTerminal: () => false };
  const result = await playGame(endless, {
    playerCount: 2,
    rng: makeRng(1),
    chooser: () => 0,
    maxTurns: 10,
  });

  assert.equal(result.finished, false);
  assert.equal(result.reason, 'maxTurns');
  assert.equal(result.turns, 10);
});

test('낼 수 있는 수가 없으면 교착으로 본다', async () => {
  const stuck = { ...makeEngine(), legalMoves: () => [] };
  const result = await playGame(stuck, { playerCount: 2, rng: makeRng(1), chooser: () => 0 });

  assert.equal(result.finished, false);
  assert.equal(result.reason, 'noLegalMoves');
});

test('범위 밖을 고르면 멈춘다', async () => {
  const result = await playGame(makeEngine(), {
    playerCount: 2,
    rng: makeRng(1),
    chooser: () => 99,
  });

  assert.equal(result.finished, false);
  assert.equal(result.reason, 'illegalChoice');
});

test('currentPlayer 를 내보내면 그것을 쓴다', async () => {
  const engine = makeEngine({ turns: 3 });
  const seen = [];
  await playGame(
    { ...engine, currentPlayer: () => 1 },
    {
      playerCount: 2,
      rng: makeRng(1),
      chooser: ({ player }) => {
        seen.push(player);
        return 0;
      },
    },
  );
  assert.deepEqual(seen, [1, 1, 1]);
});

// --- 집계 -------------------------------------------------------------------

test('공동 승리는 승수를 나눠 갖는다', () => {
  const stats = aggregate(
    [
      { finished: true, tie: false, winners: [0], turns: 10, history: [] },
      { finished: true, tie: true, winners: [0, 1], turns: 12, history: [] },
    ],
    { playerCount: 2 },
  );

  assert.deepEqual(stats.seatWins, [1.5, 0.5]);
  assert.equal(stats.ties, 1);
  assert.deepEqual(stats.seatWinRate, [0.75, 0.25]);
});

test('미종료 판은 세고 이유를 모아준다', () => {
  const stats = aggregate(
    [
      { finished: true, tie: false, winners: [0], turns: 8, history: [] },
      { finished: false, reason: 'maxTurns' },
      { finished: false, reason: 'maxTurns' },
      { finished: false, reason: 'noLegalMoves' },
    ],
    { playerCount: 2 },
  );

  assert.equal(stats.games, 4);
  assert.equal(stats.finished, 1);
  assert.equal(stats.unfinished, 3);
  assert.deepEqual(stats.unfinishedReasons, ['maxTurns', 'noLegalMoves']);
});

test('턴 수는 최소와 중앙과 최대를 낸다', () => {
  const stats = aggregate(
    [16, 24, 20].map((turns) => ({ finished: true, tie: false, winners: [0], turns, history: [] })),
    { playerCount: 1 },
  );
  assert.deepEqual(stats.turns, { min: 16, median: 20, max: 24 });
});

test('수 사용 빈도를 많이 쓴 것부터 낸다', () => {
  const history = (ids) => ids.map((id) => ({ move: { id } }));
  const stats = aggregate(
    [
      { finished: true, tie: false, winners: [0], turns: 3, history: history(['쉬기', '쉬기', '내기']) },
      { finished: true, tie: false, winners: [0], turns: 1, history: history(['쉬기']) },
    ],
    { playerCount: 1 },
  );

  assert.deepEqual(stats.moveUsage, [
    { move: '쉬기', count: 3 },
    { move: '내기', count: 1 },
  ]);
});

test('판이 하나도 없어도 죽지 않는다', () => {
  const stats = aggregate([], { playerCount: 3 });
  assert.equal(stats.finished, 0);
  assert.deepEqual(stats.seatWins, [0, 0, 0]);
  assert.deepEqual(stats.seatWinRate, [null, null, null]);
  assert.deepEqual(stats.turns, { min: null, median: null, max: null });
});

// --- 엔진 불러오기 ----------------------------------------------------------

test('예제 엔진을 불러오고 계약을 확인한다', async () => {
  const engine = await loadEngine('example-tidepool');
  for (const name of ['setup', 'legalMoves', 'applyMove', 'isTerminal', 'scores']) {
    assert.equal(typeof engine[name], 'function', `${name} 이 없다`);
  }
  assert.equal(engine.rulesetVersion, '0.1');
});

test('룰셋 버전이 어긋나면 멈춘다', async () => {
  // 엔진이 룰셋보다 뒤처진 채로 돌리면 검증한 것이 룰북과 다른 게임이 된다
  await assert.rejects(
    () => loadEngine('example-tidepool', { rulesetVersion: '0.4' }),
    (error) => {
      assert.match(error.message, /버전이 다릅니다/);
      assert.match(error.message, /룰셋: 0\.4/);
      assert.match(error.message, /엔진: 0\.1/);
      return true;
    },
  );
});

test('버전이 같으면 통과한다', async () => {
  const engine = await loadEngine('example-tidepool', { rulesetVersion: '0.1' });
  assert.equal(typeof engine.setup, 'function');
});

test('엔진이 없으면 무엇을 하라고 알려준다', async () => {
  await assert.rejects(
    () => loadEngine('없는-프로젝트'),
    (error) => {
      assert.match(error.message, /engine\.mjs 이 없습니다/);
      assert.match(error.message, /bgs-sim/);
      return true;
    },
  );
});

test('LLM 플레이에 필요한 것이 빠지면 무엇이 없는지 말해준다', async () => {
  // 예제 엔진은 describe 를 내보내므로 통과한다
  const engine = await loadEngine('example-tidepool', { requireLlm: true });
  assert.equal(typeof engine.describe, 'function');
  assert.equal(typeof engine.describeMove, 'function');
});

test('예제 엔진으로 랜덤 봇 한 판이 끝난다', async () => {
  const engine = await loadEngine('example-tidepool');
  const result = await playGame(engine, {
    playerCount: 3,
    rng: makeRng(1234),
    chooser: randomChooser(makeRng(1234)),
  });

  assert.equal(result.finished, true);
  // 8라운드 × 3인이라 턴 수가 고정이다
  assert.equal(result.turns, 24);
  assert.equal(result.scores.length, 3);
});
