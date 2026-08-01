/**
 * BGG `thing` 응답의 item 노드를 이 저장소의 스키마로 바꾼다.
 *
 * 순수 함수만 둔다. 네트워크 없이 테스트할 수 있어야 하고, BGG가 XML 구조를
 * 바꿨을 때 어디가 깨졌는지 여기만 보면 되게 하려는 것이다.
 */

import { asArray } from './client.mjs';

const num = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** `<yearpublished value="2018"/>` 처럼 value 속성에 든 값을 꺼낸다. */
const attrValue = (node) => (node && typeof node === 'object' ? node.value : node);

/** 여러 name 노드 중 primary 를 고른다. 없으면 첫 번째. */
export function primaryName(item) {
  const names = asArray(item?.name);
  if (names.length === 0) return null;
  const primary = names.find((entry) => entry?.type === 'primary');
  return (primary ?? names[0])?.value ?? null;
}

/**
 * suggested_numplayers 투표에서 Best 표가 가장 많은 인원을 고른다.
 * "4+" 같은 값도 나오므로 정수로 파싱되는 것만 본다.
 */
export function bestPlayerCount(item) {
  const poll = asArray(item?.poll).find((entry) => entry?.name === 'suggested_numplayers');
  if (!poll) return null;

  let best = null;
  let bestVotes = 0;

  for (const group of asArray(poll.results)) {
    const players = num(group?.numplayers);
    if (players === null) continue;
    const votes = asArray(group.result).find((entry) => entry?.value === 'Best')?.numvotes;
    const count = num(votes) ?? 0;
    if (count > bestVotes) {
      bestVotes = count;
      best = players;
    }
  }
  return bestVotes > 0 ? best : null;
}

/** `<rank .../>` 목록을 {type, value} 로 바꾼다. "Not Ranked" 는 버린다. */
export function extractRanks(item) {
  const ranks = asArray(item?.statistics?.ratings?.ranks?.rank);
  const result = [];
  for (const rank of ranks) {
    const value = num(rank?.value);
    if (value === null) continue; // "Not Ranked"
    const name = rank?.name;
    if (!name) continue;
    result.push({ type: name, value });
  }
  return result;
}

/** link 노드에서 특정 종류만 뽑는다. */
export function extractLinks(item, linkType) {
  return asArray(item?.link)
    .filter((link) => link?.type === linkType)
    .map((link) => ({ id: num(link.id), name: link.value }))
    .filter((link) => link.id !== null && link.name);
}

/**
 * item 노드 하나를 게임 레코드로 만든다.
 * @param {object} item
 * @returns {object|null} id가 없으면 null
 */
export function normalizeThing(item) {
  const id = num(item?.id);
  if (id === null) return null;

  const ratings = item?.statistics?.ratings ?? {};
  const overall = extractRanks(item).find((rank) => rank.type === 'boardgame');

  return {
    id,
    name: primaryName(item),
    year: num(attrValue(item?.yearpublished)),
    is_expansion: item?.type === 'boardgameexpansion' ? 1 : 0,
    min_players: num(attrValue(item?.minplayers)),
    max_players: num(attrValue(item?.maxplayers)),
    best_players: bestPlayerCount(item),
    min_time: num(attrValue(item?.minplaytime)) ?? num(attrValue(item?.playingtime)),
    max_time: num(attrValue(item?.maxplaytime)) ?? num(attrValue(item?.playingtime)),
    min_age: num(attrValue(item?.minage)),
    weight: num(attrValue(ratings.averageweight)),
    rating_avg: num(attrValue(ratings.average)),
    rating_bayes: num(attrValue(ratings.bayesaverage)),
    rank_overall: overall?.value ?? null,
    users_rated: num(attrValue(ratings.usersrated)),
    description: decodeEntities(typeof item?.description === 'string' ? item.description : ''),
    ranks: extractRanks(item),
    mechanics: extractLinks(item, 'boardgamemechanic'),
    categories: extractLinks(item, 'boardgamecategory'),
    designers: extractLinks(item, 'boardgamedesigner'),
  };
}

/**
 * BGG description은 HTML 엔티티가 섞여 나온다. 파서가 표준 엔티티는 풀지만
 * `&#10;` 같은 숫자 엔티티가 그대로 남는 경우가 있어 한 번 더 정리한다.
 */
export function decodeEntities(text) {
  if (!text) return '';
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\r\n/g, '\n')
    .trim();
}

/** search 응답 item 노드를 간단한 형태로. */
export function normalizeSearchItem(item) {
  const id = num(item?.id);
  if (id === null) return null;
  return {
    id,
    name: attrValue(item?.name) ?? primaryName(item),
    year: num(attrValue(item?.yearpublished)),
    type: item?.type ?? null,
  };
}
