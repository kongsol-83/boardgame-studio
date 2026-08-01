import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bestPlayerCount,
  decodeEntities,
  extractLinks,
  extractRanks,
  normalizeSearchItem,
  normalizeThing,
  primaryName,
} from '../tools/bgg/normalize.mjs';

/** fast-xml-parser 가 실제 thing 응답에서 만들어내는 형태에 맞춘 픽스처. */
function sampleItem(overrides = {}) {
  return {
    type: 'boardgame',
    id: '224517',
    name: [
      { type: 'alternate', sortindex: '1', value: '工业革命：伯明翰' },
      { type: 'primary', sortindex: '1', value: 'Brass: Birmingham' },
    ],
    description: 'Brass: Birmingham is an economic strategy game&#10;&amp; a sequel.',
    yearpublished: { value: '2018' },
    minplayers: { value: '2' },
    maxplayers: { value: '4' },
    minplaytime: { value: '60' },
    maxplaytime: { value: '120' },
    playingtime: { value: '120' },
    minage: { value: '14' },
    poll: [
      {
        name: 'suggested_numplayers',
        totalvotes: '100',
        results: [
          { numplayers: '2', result: [{ value: 'Best', numvotes: '10' }, { value: 'Recommended', numvotes: '40' }] },
          { numplayers: '3', result: [{ value: 'Best', numvotes: '55' }, { value: 'Recommended', numvotes: '20' }] },
          { numplayers: '4', result: [{ value: 'Best', numvotes: '30' }] },
          { numplayers: '4+', result: [{ value: 'Best', numvotes: '99' }] },
        ],
      },
      { name: 'language_dependence', results: { result: [] } },
    ],
    link: [
      { type: 'boardgamecategory', id: '1021', value: 'Economic' },
      { type: 'boardgamecategory', id: '1088', value: 'Industry / Manufacturing' },
      { type: 'boardgamemechanic', id: '2040', value: 'Hand Management' },
      { type: 'boardgamemechanic', id: '2081', value: 'Network and Route Building' },
      { type: 'boardgamedesigner', id: '11901', value: 'Gavan Brown' },
      { type: 'boardgamepublisher', id: '30677', value: 'Roxley' },
    ],
    statistics: {
      ratings: {
        usersrated: { value: '59445' },
        average: { value: '8.56081' },
        bayesaverage: { value: '8.39073' },
        averageweight: { value: '3.9096' },
        ranks: {
          rank: [
            { type: 'subtype', id: '1', name: 'boardgame', value: '1' },
            { type: 'family', id: '5497', name: 'strategygames', value: '1' },
            { type: 'family', id: '5499', name: 'thematic', value: 'Not Ranked' },
          ],
        },
      },
    },
    ...overrides,
  };
}

test('primary 이름을 고른다', () => {
  assert.equal(primaryName(sampleItem()), 'Brass: Birmingham');
});

test('이름 노드가 하나뿐이면(배열이 아니면) 그것을 쓴다', () => {
  const item = sampleItem({ name: { type: 'primary', value: 'Hive' } });
  assert.equal(primaryName(item), 'Hive');
});

test('Best 표가 가장 많은 인원을 고르고 "4+" 같은 값은 무시한다', () => {
  // "4+"가 99표로 가장 많지만 정수가 아니므로 3인(55표)이 나와야 한다
  assert.equal(bestPlayerCount(sampleItem()), 3);
});

test('Best 표가 하나도 없으면 null', () => {
  const item = sampleItem({
    poll: [{ name: 'suggested_numplayers', results: [{ numplayers: '2', result: [{ value: 'Recommended', numvotes: '5' }] }] }],
  });
  assert.equal(bestPlayerCount(item), null);
});

test('투표 자체가 없어도 죽지 않는다', () => {
  assert.equal(bestPlayerCount(sampleItem({ poll: undefined })), null);
  assert.equal(bestPlayerCount({}), null);
});

test('Not Ranked 인 랭크는 버린다', () => {
  const ranks = extractRanks(sampleItem());
  assert.deepEqual(ranks, [
    { type: 'boardgame', value: 1 },
    { type: 'strategygames', value: 1 },
  ]);
});

test('링크를 종류별로 뽑는다', () => {
  assert.deepEqual(extractLinks(sampleItem(), 'boardgamemechanic'), [
    { id: 2040, name: 'Hand Management' },
    { id: 2081, name: 'Network and Route Building' },
  ]);
  assert.equal(extractLinks(sampleItem(), 'boardgamedesigner').length, 1);
  assert.equal(extractLinks(sampleItem(), 'boardgamefamily').length, 0);
});

test('item 하나를 게임 레코드로 만든다', () => {
  const game = normalizeThing(sampleItem());

  assert.equal(game.id, 224517);
  assert.equal(game.name, 'Brass: Birmingham');
  assert.equal(game.year, 2018);
  assert.equal(game.is_expansion, 0);
  assert.equal(game.min_players, 2);
  assert.equal(game.max_players, 4);
  assert.equal(game.best_players, 3);
  assert.equal(game.min_time, 60);
  assert.equal(game.max_time, 120);
  assert.equal(game.min_age, 14);
  assert.equal(game.weight, 3.9096);
  assert.equal(game.rating_bayes, 8.39073);
  assert.equal(game.rank_overall, 1);
  assert.equal(game.users_rated, 59445);
  assert.equal(game.mechanics.length, 2);
  assert.equal(game.categories.length, 2);
});

test('확장은 is_expansion 으로 표시한다', () => {
  const game = normalizeThing(sampleItem({ type: 'boardgameexpansion' }));
  assert.equal(game.is_expansion, 1);
});

test('minplaytime 이 없으면 playingtime 으로 대체한다', () => {
  const game = normalizeThing(sampleItem({ minplaytime: undefined, maxplaytime: undefined }));
  assert.equal(game.min_time, 120);
  assert.equal(game.max_time, 120);
});

test('통계가 없어도(stats=0 응답) 죽지 않는다', () => {
  const game = normalizeThing(sampleItem({ statistics: undefined }));
  assert.equal(game.weight, null);
  assert.equal(game.rank_overall, null);
  assert.deepEqual(game.ranks, []);
  assert.equal(game.name, 'Brass: Birmingham');
});

test('id 가 없으면 null 을 돌려준다', () => {
  assert.equal(normalizeThing({ name: 'x' }), null);
  assert.equal(normalizeThing({}), null);
});

test('숫자 엔티티와 HTML 엔티티를 푼다', () => {
  assert.equal(decodeEntities('a&#10;b'), 'a\nb');
  assert.equal(decodeEntities('&amp;'), '&');
  assert.equal(decodeEntities('&quot;따옴표&quot;'), '"따옴표"');
  assert.equal(decodeEntities(''), '');
  assert.equal(decodeEntities(undefined), '');
  assert.match(normalizeThing(sampleItem()).description, /strategy game\n& a sequel\.$/);
});

test('search 응답을 간단한 형태로 만든다', () => {
  const item = { type: 'boardgame', id: '224517', name: { type: 'primary', value: 'Brass: Birmingham' }, yearpublished: { value: '2018' } };
  assert.deepEqual(normalizeSearchItem(item), {
    id: 224517,
    name: 'Brass: Birmingham',
    year: 2018,
    type: 'boardgame',
  });
  assert.equal(normalizeSearchItem({ name: 'x' }), null);
});
