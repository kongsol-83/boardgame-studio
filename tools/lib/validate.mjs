/**
 * 스킬, 서브에이전트, 룰의 형식 검증.
 *
 * `tools/validate.mjs` 에서 떼어냈다. **검사하는 코드가 검사되지 않고 있었다.**
 * 이게 조용히 검사를 그만두면 형식이 어긋난 스킬을 Cursor가 로드하지 않는데,
 * 왜 슬래시 메뉴에 안 뜨는지 아무도 모르게 된다. 검증기가 침묵하는 것이 검증기가
 * 없는 것보다 나쁘다.
 *
 * 결과를 돌려주기만 하고 출력하지 않는다. 그래야 임시 폴더를 만들어 테스트할 수 있다.
 */

import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { parseFrontmatter } from './frontmatter.mjs';

const execFileAsync = promisify(execFile);

export const PREFIX = 'bgs-';
export const MAX_DESCRIPTION = 1024;
const MIN_DESCRIPTION = 20;
/**
 * 검사하지 않는 폴더.
 *
 * `node_modules` 는 남의 코드고, `data` 와 `projects` 는 커밋되지 않는 작업물이다.
 * `scratch` 는 한 번 쓰고 버리는 검증 코드 자리라서, 반쯤 쓴 스크립트 때문에
 * `npm test` 가 깨지면 안 된다.
 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'data', 'projects', 'scratch']);

/** SKIP_DIRS 를 건너뛰며 재귀적으로 파일을 모은다. */
export async function walk(dir, filter) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const found = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      found.push(...(await walk(full, filter)));
    } else if (filter(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * 이름이 규칙을 지키는지. 스킬은 부모 폴더명, 에이전트는 파일명과 같아야 한다.
 * @returns {string[]} 문제 메시지들
 */
export function checkName({ name, expected, kind }) {
  const problems = [];

  if (!name) {
    problems.push(`${kind}에 name 필드가 없습니다`);
  } else if (name !== expected) {
    problems.push(`name이 "${name}"인데 "${expected}"여야 합니다. 다르면 Cursor가 로드하지 않습니다`);
  }

  const actual = typeof name === 'string' ? name : expected;
  if (!actual.startsWith(PREFIX)) {
    problems.push(`이름은 "${PREFIX}" 접두사로 시작해야 합니다. 없으면 기본 커맨드와 충돌합니다`);
  }
  if (!/^[a-z0-9-]+$/.test(actual)) {
    problems.push(`이름에 소문자, 숫자, 하이픈만 쓸 수 있습니다: "${actual}"`);
  }
  return problems;
}

/** @returns {{ problems: string[], notes: string[] }} */
export function checkDescription({ description, kind }) {
  if (typeof description !== 'string' || description.trim() === '') {
    return { problems: [`${kind}에 description이 없습니다. 이걸로 언제 쓸지 판단합니다`], notes: [] };
  }
  if (description.length > MAX_DESCRIPTION) {
    return {
      problems: [`description이 ${description.length}자입니다. ${MAX_DESCRIPTION}자 이하여야 합니다`],
      notes: [],
    };
  }
  if (description.length < MIN_DESCRIPTION) {
    return { problems: [], notes: ['description이 너무 짧습니다. 무엇을 하는지와 언제 쓰는지를 같이 쓰세요'] };
  }
  return { problems: [], notes: [] };
}

/**
 * 저장소 하나를 통째로 검사한다.
 *
 * @param {string} root 저장소 루트
 * @param {{ syntax?: boolean }} [options] syntax 를 끄면 node --check 를 건너뛴다
 * @returns {Promise<{ counts: object, problems: {file: string, message: string}[],
 *                     notes: {file: string, message: string}[] }>}
 */
export async function validateTree(root, { syntax = true } = {}) {
  const problems = [];
  const notes = [];

  const rel = (absolute) => path.relative(root, absolute).replaceAll(path.sep, '/');
  const fail = (file, message) => problems.push({ file: rel(file), message });
  const note = (file, message) => notes.push({ file: rel(file), message });
  const collect = (file, result) => {
    for (const message of result.problems) fail(file, message);
    for (const message of result.notes) note(file, message);
  };

  // --- 스킬 -----------------------------------------------------------------
  const skillFiles = await walk(path.join(root, '.cursor', 'skills'), (name) => name === 'SKILL.md');
  for (const file of skillFiles) {
    const { data, hasFrontmatter } = parseFrontmatter(await readFile(file, 'utf8'));
    if (!hasFrontmatter) {
      fail(file, 'YAML 프론트매터가 없습니다');
      continue;
    }
    // 스킬의 name 은 부모 폴더명과 같아야 한다. 다르면 조용히 로드되지 않는다
    for (const message of checkName({ name: data.name, expected: path.basename(path.dirname(file)), kind: '스킬' })) {
      fail(file, message);
    }
    collect(file, checkDescription({ description: data.description, kind: '스킬' }));
  }

  // --- 에이전트 -------------------------------------------------------------
  const agentFiles = await walk(path.join(root, '.cursor', 'agents'), (name) => name.endsWith('.md'));

  /*
   * Cursor는 에이전트를 파일명으로만 식별하고 경로는 무시한다. 티어 폴더로 나눠도
   * 이름이 겹치면 한쪽이 경고 없이 드롭되므로, 폴더가 다르다고 안심할 수 없다.
   */
  const byBasename = new Map();
  for (const file of agentFiles) {
    const key = path.basename(file, '.md');
    if (!byBasename.has(key)) byBasename.set(key, []);
    byBasename.get(key).push(file);
  }
  for (const [name, duplicates] of byBasename) {
    if (duplicates.length < 2) continue;
    const where = duplicates.map(rel).join(', ');
    fail(
      duplicates[0],
      `"${name}" 이름이 ${duplicates.length}곳에 있습니다: ${where}. Cursor는 경로를 무시하므로 하나만 로드됩니다`,
    );
  }

  for (const file of agentFiles) {
    const { data, hasFrontmatter } = parseFrontmatter(await readFile(file, 'utf8'));
    if (!hasFrontmatter) {
      /*
       * Cursor의 재귀 스캔은 `---` 한 쌍만 있으면 무엇이든 에이전트로 잡는다.
       * 참고 문서를 여기 두면 유령 에이전트가 되므로 .cursor/agents/ 바깥에 둔다.
       */
      fail(file, 'YAML 프론트매터가 없습니다. 에이전트가 아닌 문서는 .cursor/agents/ 밖에 두세요');
      continue;
    }
    for (const message of checkName({ name: data.name, expected: path.basename(file, '.md'), kind: '에이전트' })) {
      fail(file, message);
    }
    collect(file, checkDescription({ description: data.description, kind: '에이전트' }));

    if ('readonly' in data && typeof data.readonly !== 'boolean') {
      fail(file, `readonly는 true 또는 false여야 합니다: "${data.readonly}"`);
    }
  }

  // --- 룰 -------------------------------------------------------------------
  const ruleFiles = await walk(
    path.join(root, '.cursor', 'rules'),
    (name) => name.endsWith('.md') || name.endsWith('.mdc'),
  );
  let rules = 0;
  for (const file of ruleFiles) {
    if (file.endsWith('.md')) {
      fail(file, '룰은 .mdc 확장자여야 합니다. .cursor/rules/ 의 .md 는 무시됩니다');
      continue;
    }
    rules += 1;
    const { hasFrontmatter, data } = parseFrontmatter(await readFile(file, 'utf8'));
    if (!hasFrontmatter) {
      fail(file, 'YAML 프론트매터가 없습니다');
      continue;
    }
    if (!data.description && !data.globs && data.alwaysApply !== true) {
      fail(file, 'description, globs, alwaysApply 중 하나는 있어야 룰이 적용됩니다');
    }
  }

  // --- 스크립트 -------------------------------------------------------------
  const scriptFiles = await walk(root, (name) => name.endsWith('.mjs') || name.endsWith('.js'));
  if (syntax) {
    const results = await Promise.all(scriptFiles.map((file) => checkScript(file)));
    for (const result of results) {
      if (result) fail(result.file, result.message);
    }
  }

  return {
    counts: { skills: skillFiles.length, agents: agentFiles.length, rules, scripts: scriptFiles.length },
    problems,
    notes,
  };
}

/**
 * 스크립트 하나의 BOM과 문법을 본다.
 * @returns {Promise<{file: string, message: string}|null>}
 */
export async function checkScript(file) {
  /*
   * Windows 편집기가 UTF-8 BOM을 붙이면 shebang이 깨지면서
   * "Invalid or unexpected token" 이라는 알기 어려운 오류가 난다.
   */
  const head = await readFile(file);
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
    return { file, message: 'UTF-8 BOM이 붙어 있습니다. BOM 없이 저장하세요' };
  }

  try {
    await execFileAsync(process.execPath, ['--check', file]);
    return null;
  } catch (error) {
    const stderr = String(error.stderr || error.message).trim().split('\n');
    // node --check 는 파일:줄 / 소스 / 캐럿 / 실제 메시지 순으로 낸다.
    const detail = stderr.find((line) => /Error/.test(line)) ?? stderr[0];
    return { file, message: `${detail} (${stderr[0]})` };
  }
}
