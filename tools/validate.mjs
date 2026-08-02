#!/usr/bin/env node
/**
 * 스킬, 서브에이전트, 룰의 형식을 검증한다.
 *
 * 이게 없으면 형식이 어긋난 스킬을 Cursor가 조용히 로드하지 않아서
 * 왜 슬래시 메뉴에 안 뜨는지 아무도 모르게 된다. CI에서 매번 돌린다.
 *
 * 검사 자체는 tools/lib/validate.mjs 에 있다. 여기는 출력과 종료 코드만 맡는다.
 *
 *   node tools/validate.mjs
 */

import { ROOT } from './lib/env.mjs';
import { validateTree } from './lib/validate.mjs';

const { counts, problems, notes } = await validateTree(ROOT);

console.log(
  `검사 대상 — 스킬 ${counts.skills}, 에이전트 ${counts.agents}, 룰 ${counts.rules}, 스크립트 ${counts.scripts}`,
);

for (const { file, message } of notes) {
  console.log(`  참고  ${file}\n        ${message}`);
}

if (problems.length === 0) {
  console.log('통과');
  process.exit(0);
}

console.error(`\n${problems.length}건의 문제:`);
for (const { file, message } of problems) {
  console.error(`  오류  ${file}\n        ${message}`);
}
process.exit(1);
