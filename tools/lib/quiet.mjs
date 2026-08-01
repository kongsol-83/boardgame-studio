/**
 * node:sqlite 는 아직 실험 기능이라 임포트할 때마다 ExperimentalWarning 을 낸다.
 * 에이전트가 이 CLI 출력을 읽기 때문에 매번 섞여 나오면 신호 대비 잡음이 커진다.
 * 이 경고 하나만 지우고 나머지는 그대로 둔다.
 */

const original = process.emitWarning;

process.emitWarning = function filtered(warning, ...rest) {
  const text = typeof warning === 'string' ? warning : (warning?.message ?? '');
  if (text.includes('SQLite is an experimental feature')) return undefined;
  return original.call(process, warning, ...rest);
};
