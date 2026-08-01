import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseFrontmatter } from '../tools/lib/frontmatter.mjs';

test('프론트매터가 없으면 본문을 그대로 돌려준다', () => {
  const { data, body, hasFrontmatter } = parseFrontmatter('# 제목\n내용');
  assert.equal(hasFrontmatter, false);
  assert.deepEqual(data, {});
  assert.equal(body, '# 제목\n내용');
});

test('닫는 구분자가 없으면 프론트매터로 보지 않는다', () => {
  const { hasFrontmatter } = parseFrontmatter('---\nname: bgs-concept\n본문만 있고 끝');
  assert.equal(hasFrontmatter, false);
});

test('기본 키와 값을 읽는다', () => {
  const { data, body } = parseFrontmatter(
    ['---', 'name: bgs-concept', 'description: 아이디어를 핵심 동사로 낮춘다', '---', '', '# 본문'].join('\n'),
  );
  assert.equal(data.name, 'bgs-concept');
  assert.equal(data.description, '아이디어를 핵심 동사로 낮춘다');
  assert.equal(body.trim(), '# 본문');
});

test('따옴표를 벗기고 불리언과 숫자를 변환한다', () => {
  const { data } = parseFrontmatter(
    ['---', 'name: "bgs-rules-critic"', "model: 'inherit'", 'readonly: true', 'order: 3', '---'].join('\n'),
  );
  assert.equal(data.name, 'bgs-rules-critic');
  assert.equal(data.model, 'inherit');
  assert.equal(data.readonly, true);
  assert.equal(data.order, 3);
});

test('접힌 블록 스칼라를 한 줄로 합친다', () => {
  const { data } = parseFrontmatter(
    ['---', 'description: >-', '  유사작을 찾고', '  메커니즘을 제안한다', 'name: bgs-reference', '---'].join('\n'),
  );
  assert.equal(data.description, '유사작을 찾고 메커니즘을 제안한다');
  assert.equal(data.name, 'bgs-reference');
});

test('유지 블록 스칼라는 줄바꿈을 보존한다', () => {
  const { data } = parseFrontmatter(['---', 'note: |', '  첫 줄', '  둘째 줄', '---'].join('\n'));
  assert.equal(data.note, '첫 줄\n둘째 줄');
});

test('블록 리스트와 인라인 리스트를 모두 읽는다', () => {
  const block = parseFrontmatter(
    ['---', 'paths:', '  - projects/**/*.csv', '  - presets/*.json', '---'].join('\n'),
  );
  assert.deepEqual(block.data.paths, ['projects/**/*.csv', 'presets/*.json']);

  const inline = parseFrontmatter(['---', 'sets: [character, scene]', 'empty: []', '---'].join('\n'));
  assert.deepEqual(inline.data.sets, ['character', 'scene']);
  assert.deepEqual(inline.data.empty, []);
});

test('주석과 빈 줄을 무시한다', () => {
  const { data } = parseFrontmatter(
    ['---', '# 주석', '', 'name: bgs-pnp', '---'].join('\n'),
  );
  assert.deepEqual(data, { name: 'bgs-pnp' });
});

test('BOM이 붙어 있어도 파싱한다', () => {
  const { data, hasFrontmatter } = parseFrontmatter('\uFEFF---\nname: bgs-art\n---\n');
  assert.equal(hasFrontmatter, true);
  assert.equal(data.name, 'bgs-art');
});

test('CRLF 줄바꿈을 처리한다', () => {
  const { data, hasFrontmatter } = parseFrontmatter('---\r\nname: bgs-sim\r\n---\r\n# 본문\r\n');
  assert.equal(hasFrontmatter, true);
  assert.equal(data.name, 'bgs-sim');
});

test('값에 콜론이 들어가도 첫 콜론에서만 자른다', () => {
  const { data } = parseFrontmatter(['---', 'description: 규격: mm로 선언한다', '---'].join('\n'));
  assert.equal(data.description, '규격: mm로 선언한다');
});
