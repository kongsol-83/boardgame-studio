/**
 * 조수 웅덩이 규칙 엔진 (예제).
 *
 * 엔진은 **순수해야 한다.** 파일을 읽지 않고 UI를 모른다. 그래야 헤드리스로 수만 판을
 * 돌릴 수 있고, 같은 모듈을 play.html 에서 그대로 import 할 수 있다.
 *
 * 카드 데이터는 components/action-card.csv 를 옮겨 적은 것이다. CSV가 바뀌면 여기도
 * 맞춰야 하고, 그 동기화는 사람(또는 bgs-sim-engineer)의 책임이다.
 */

// ruleset.md 의 버전과 같아야 한다. 다르면 러너가 실행 전에 멈춘다.
export const rulesetVersion = '0.1';

const CARDS = [
  { id: 'TP01', name: '물때 살피기', cost: 1, power: 2, vp: 0, qty: 3 },
  { id: 'TP02', name: '재빠른 손', cost: 2, power: 4, vp: 0, qty: 3 },
  { id: 'TP03', name: '돌 뒤집기', cost: 2, power: 3, vp: 1, qty: 3 },
  { id: 'TP04', name: '그물 펼치기', cost: 3, power: 6, vp: 1, qty: 2 },
  { id: 'TP05', name: '무리한 잠수', cost: 3, power: 12, vp: 0, qty: 2 },
  { id: 'TP06', name: '바구니 정리', cost: 4, power: 8, vp: 2, qty: 2 },
  { id: 'TP07', name: '미끼 뿌리기', cost: 4, power: 7, vp: 2, qty: 2 },
  { id: 'TP08', name: '정확한 포획', cost: 5, power: 10, vp: 3, qty: 1 },
  { id: 'TP09', name: '마지막 물때', cost: 5, power: 11, vp: 3, qty: 1 },
  { id: 'TP10', name: '잠시 쉬기', cost: 1, power: 1, vp: 1, qty: 4 },
  { id: 'TP11', name: '웅덩이 지키기', cost: 2, power: 4, vp: 1, qty: 3 },
  { id: 'TP12', name: '물길 돌리기', cost: 3, power: 5, vp: 2, qty: 2 },
];

const ROUNDS = 8;
const HAND_SIZE = 3;
const REST_RESOURCES = 2;
const ROUND_BONUS_VP = 2;

const buildDeck = () => CARDS.flatMap((card) => Array.from({ length: card.qty }, () => card));

export function setup(playerCount, rng) {
  const deck = rng.shuffle(buildDeck());
  const players = Array.from({ length: playerCount }, () => ({
    hand: deck.splice(0, HAND_SIZE),
    resources: 4,
    vp: 0,
    roundPower: 0,
  }));
  return { round: 1, current: 0, acted: 0, deck, players };
}

export const currentPlayer = (state) => state.current;

export function legalMoves(state) {
  const player = state.players[state.current];
  const moves = player.hand
    .map((card, index) => ({ type: 'play', index, id: card.id, name: card.name }))
    .filter((move) => player.hand[move.index].cost <= player.resources);
  // 낼 수 있는 게 없어도 게임이 멈추지 않도록 쉬기는 항상 가능하다
  moves.push({ type: 'rest', id: 'rest' });
  return moves;
}

export function applyMove(state, move) {
  const next = structuredClone(state);
  const player = next.players[next.current];

  if (move.type === 'play') {
    const [card] = player.hand.splice(move.index, 1);
    player.resources -= card.cost;
    player.vp += card.vp;
    player.roundPower += card.power;
  } else {
    player.resources += REST_RESOURCES;
  }

  next.current = (next.current + 1) % next.players.length;
  next.acted += 1;

  // 모두 한 번씩 행동하면 물때를 정산한다
  if (next.acted >= next.players.length) {
    const best = Math.max(...next.players.map((entry) => entry.roundPower));
    if (best > 0) {
      const leaders = next.players.filter((entry) => entry.roundPower === best);
      if (leaders.length === 1) leaders[0].vp += ROUND_BONUS_VP;
    }
    for (const entry of next.players) {
      entry.roundPower = 0;
      while (entry.hand.length < HAND_SIZE && next.deck.length > 0) entry.hand.push(next.deck.shift());
    }
    next.acted = 0;
    next.round += 1;
  }
  return next;
}

export const isTerminal = (state) => state.round > ROUNDS;

export const scores = (state) => state.players.map((player) => player.vp);

export const summarize = (state) => ({
  rounds: state.round - 1,
  scores: state.players.map((player) => player.vp),
  deckLeft: state.deck.length,
});

// --- LLM 플레이용 ------------------------------------------------------------

export function describe(state, player) {
  const me = state.players[player];

  // 물때 보너스는 누적 채집력 경쟁이므로 상대의 누적 채집력이 보여야 판단할 수 있다
  const others = state.players
    .map((entry, index) =>
      index === player ? null : `${index + 1}번: ${entry.vp}점, 자원 ${entry.resources}, 이번 물때 채집력 ${entry.roundPower}`,
    )
    .filter(Boolean)
    .join(' / ');

  const hand = me.hand
    .map((card, index) => `${index}: ${card.name} (비용 ${card.cost}, 채집력 ${card.power}, 점수 ${card.vp})`)
    .join('\n  ');

  return [
    `물때 ${state.round}/${ROUNDS} · 당신은 ${player + 1}번 플레이어`,
    `당신: ${me.vp}점, 자원 ${me.resources}, 이번 물때 채집력 ${me.roundPower}`,
    `상대: ${others}`,
    `남은 덱 ${state.deck.length}장`,
    '',
    '손패:',
    `  ${hand || '(없음)'}`,
  ].join('\n');
}

export const describeMove = (move) =>
  move.type === 'rest' ? `쉬기 (자원 +${REST_RESOURCES})` : `${move.name} 내기`;
