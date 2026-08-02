import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkDescription, checkName, validateTree } from '../tools/lib/validate.mjs';

/** 임시 저장소를 만든다. 키는 루트 기준 상대 경로다. */
async function makeTree(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bgs-validate-'));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return root;
}

const frontmatter = (fields) =>
  `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('\n')}\n---\n\n본문\n`;

const goodDescription = '무엇을 하는지 적고 언제 쓰는지도 같이 적는다';

const SKILL = frontmatter({ name: 'bgs-thing', description: goodDescription });
const AGENT = frontmatter({ name: 'bgs-helper', description: goodDescription });
const RULE = '---\nalwaysApply: true\n---\n\n규칙 본문\n';

/** 문제 메시지를 한 줄로 합친다. 어느 파일에서 났는지까지 본다. */
const joined = (result) => result.problems.map((entry) => `${entry.file}: ${entry.message}`).join('\n');

// --- 이름 규칙 (순수 함수) --------------------------------------------------

test('이름이 기대값과 같으면 문제가 없다', () => {
  assert.deepEqual(checkName({ name: 'bgs-thing', expected: 'bgs-thing', kind: '스킬' }), []);
});

test('이름이 없으면 무엇이 빠졌는지 말한다', () => {
  const problems = checkName({ name: undefined, expected: 'bgs-thing', kind: '스킬' });
  assert.match(problems[0], /name 필드가 없습니다/);
});

test('이름이 기대값과 다르면 Cursor가 로드하지 않는다고 알려준다', () => {
  const problems = checkName({ name: 'bgs-other', expected: 'bgs-thing', kind: '스킬' });
  assert.match(problems[0], /"bgs-other"인데 "bgs-thing"/);
  assert.match(problems[0], /로드하지 않습니다/);
});

test('접두사가 없으면 기본 커맨드와 충돌한다고 알려준다', () => {
  const problems = checkName({ name: 'thing', expected: 'thing', kind: '스킬' });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /bgs-/);
});

test('대문자나 밑줄이 든 이름을 잡는다', () => {
  assert.ok(checkName({ name: 'bgs-Thing', expected: 'bgs-Thing', kind: '스킬' }).some((m) => /소문자/.test(m)));
  assert.ok(checkName({ name: 'bgs_thing', expected: 'bgs_thing', kind: '스킬' }).some((m) => /소문자/.test(m)));
});

// --- description (순수 함수) ------------------------------------------------

test('description 이 비면 문제로 본다', () => {
  for (const value of [undefined, '', '   ', 42]) {
    const { problems } = checkDescription({ description: value, kind: '스킬' });
    assert.equal(problems.length, 1, `${JSON.stringify(value)} 에서 안 잡혔다`);
  }
});

test('짧은 description 은 문제가 아니라 참고다', () => {
  const { problems, notes } = checkDescription({ description: '짧다', kind: '스킬' });
  assert.deepEqual(problems, []);
  assert.equal(notes.length, 1);
});

test('1024자를 넘으면 문제로 본다', () => {
  const { problems } = checkDescription({ description: 'a'.repeat(1025), kind: '스킬' });
  assert.match(problems[0], /1025자입니다/);
});

// --- 저장소 전체 ------------------------------------------------------------

test('정상 저장소는 통과하고 개수를 센다', async (t) => {
  const root = await makeTree({
    '.cursor/skills/bgs-thing/SKILL.md': SKILL,
    '.cursor/agents/leads/bgs-helper.md': AGENT,
    '.cursor/rules/shell.mdc': RULE,
    'tools/ok.mjs': 'export const a = 1;\n',
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await validateTree(root);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.counts, { skills: 1, agents: 1, rules: 1, scripts: 1 });
});

test('스킬 name 이 폴더명과 다르면 잡는다', async (t) => {
  // 이게 이 검증기가 있는 첫 이유다. 다르면 Cursor가 조용히 로드하지 않는다
  const root = await makeTree({
    '.cursor/skills/bgs-thing/SKILL.md': frontmatter({ name: 'bgs-other', description: goodDescription }),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await validateTree(root, { syntax: false });
  assert.match(joined(result), /bgs-thing\/SKILL\.md/);
  assert.match(joined(result), /"bgs-other"인데 "bgs-thing"/);
});

test('프론트매터가 없는 스킬을 잡는다', async (t) => {
  const root = await makeTree({ '.cursor/skills/bgs-thing/SKILL.md': '# 제목만 있다\n' });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await validateTree(root, { syntax: false });
  assert.match(joined(result), /YAML 프론트매터가 없습니다/);
});

test('에이전트 name 이 파일명과 다르면 잡는다', async (t) => {
  const root = await makeTree({
    '.cursor/agents/specialists/bgs-helper.md': frontmatter({ name: 'bgs-assistant', description: goodDescription }),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await validateTree(root, { syntax: false });
  assert.match(joined(result), /"bgs-assistant"인데 "bgs-helper"/);
});

test('같은 파일명이 두 폴더에 있으면 잡는다', async (t) => {
  /*
   * Cursor는 에이전트를 파일명으로 식별하고 경로를 무시한다. 티어 폴더로 나눠도
   * 이름이 겹치면 한쪽이 경고 없이 드롭되므로 폴더가 다르다고 안심할 수 없다.
   */
  const root = await makeTree({
    '.cursor/agents/leads/bgs-helper.md': AGENT,
    '.cursor/agents/specialists/bgs-helper.md': AGENT,
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await validateTree(root, { syntax: false });
  const message = joined(result);
  assert.match(message, /"bgs-helper" 이름이 2곳에 있습니다/);
  assert.match(message, /leads\/bgs-helper\.md/);
  assert.match(message, /specialists\/bgs-helper\.md/);
});

test('에이전트 폴더에 둔 참고 문서를 유령 에이전트로 잡는다', async (t) => {
  // Cursor의 스캔은 --- 한 쌍만 있으면 무엇이든 에이전트로 잡는다
  const root = await makeTree({
    '.cursor/agents/bgs-helper.md': AGENT,
    '.cursor/agents/README.md': '# 이 폴더의 규칙\n\n설명만 있는 문서다.\n',
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await validateTree(root, { syntax: false });
  assert.match(joined(result), /README\.md.*밖에 두세요/s);
});

test('readonly 가 불리언이 아니면 잡는다', async (t) => {
  const root = await makeTree({
    '.cursor/agents/bgs-helper.md': frontmatter({
      name: 'bgs-helper',
      description: goodDescription,
      readonly: 'yes',
    }),
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await validateTree(root, { syntax: false });
  assert.match(joined(result), /readonly는 true 또는 false/);
});

test('룰이 .md 면 무시된다고 알려주고 개수에서도 뺀다', async (t) => {
  const root = await makeTree({ '.cursor/rules/writing.md': RULE });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await validateTree(root, { syntax: false });
  assert.match(joined(result), /\.mdc 확장자여야 합니다/);
  assert.equal(result.counts.rules, 0);
});

test('적용 조건이 하나도 없는 룰을 잡는다', async (t) => {
  const root = await makeTree({ '.cursor/rules/thing.mdc': '---\ntitle: 제목\n---\n\n본문\n' });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await validateTree(root, { syntax: false });
  assert.match(joined(result), /alwaysApply 중 하나는 있어야/);
});

test('globs 만 있어도 룰로 인정한다', async (t) => {
  const root = await makeTree({ '.cursor/rules/thing.mdc': '---\nglobs: "*.mjs"\n---\n\n본문\n' });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await validateTree(root, { syntax: false });
  assert.deepEqual(result.problems, []);
  assert.equal(result.counts.rules, 1);
});

// --- 스크립트 ---------------------------------------------------------------

test('UTF-8 BOM 이 붙은 스크립트를 잡는다', async (t) => {
  // BOM이 붙으면 shebang이 깨져서 Invalid or unexpected token 이 난다.
  // 파일을 봐서는 멀쩡해 보이기 때문에 원인을 찾는 데 시간이 걸린다
  const root = await makeTree({ 'tools/bom.mjs': '\uFEFF#!/usr/bin/env node\nexport const a = 1;\n' });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await validateTree(root);
  assert.match(joined(result), /UTF-8 BOM이 붙어 있습니다/);
});

test('문법 오류를 잡는다', async (t) => {
  const root = await makeTree({ 'tools/broken.mjs': 'export const a = (((;\n' });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await validateTree(root);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0].file, /broken\.mjs/);
  assert.match(result.problems[0].message, /Error/);
});

test('건너뛰는 폴더는 검사하지 않는다', async (t) => {
  /*
   * node_modules 를 검사하면 남의 코드에서 문제가 쏟아진다. projects 와 data 는
   * 커밋되지 않는 작업물이고, scratch 는 한 번 쓰고 버리는 검증 코드 자리다.
   * 반쯤 쓴 스크립트를 남겨뒀다고 npm test 가 깨지면 안 된다.
   */
  const root = await makeTree({
    'node_modules/pkg/broken.mjs': 'const a = (((;\n',
    'projects/my-game/broken.mjs': 'const a = (((;\n',
    'data/broken.mjs': 'const a = (((;\n',
    'scratch/probe.mjs': 'const a = (((;\n',
    'tools/ok.mjs': 'export const a = 1;\n',
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await validateTree(root);
  assert.deepEqual(result.problems, []);
  assert.equal(result.counts.scripts, 1);
});

test('.cursor 가 없어도 죽지 않는다', async (t) => {
  const root = await makeTree({ 'README.md': '# 빈 저장소\n' });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await validateTree(root);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.counts, { skills: 0, agents: 0, rules: 0, scripts: 0 });
});

// --- 실제 저장소 ------------------------------------------------------------

test('이 저장소가 스스로의 검사를 통과한다', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const result = await validateTree(root, { syntax: false });

  assert.deepEqual(result.problems, [], joined(result));
  assert.ok(result.counts.skills >= 8);
  assert.ok(result.counts.agents >= 17);
  assert.ok(result.counts.rules >= 2);
});
