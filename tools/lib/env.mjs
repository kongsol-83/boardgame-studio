/** 저장소 루트의 .env 를 한 번만 읽는다. 없어도 조용히 넘어간다. */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let loaded = false;

export function loadEnv() {
  if (loaded) return;
  loaded = true;
  try {
    process.loadEnvFile(path.join(ROOT, '.env'));
  } catch {
    // .env 가 없는 건 정상이다. 키가 필요한 커맨드가 알아서 안내한다.
  }
}

/**
 * 환경변수를 읽되, 없으면 무엇을 어떻게 채워야 하는지 알려주고 멈춘다.
 * 빈 배열이나 스택 트레이스를 돌려주면 에이전트가 원인을 찾느라 헛돈다.
 */
export function requireEnv(name, hint) {
  loadEnv();
  const value = process.env[name];
  if (value && value.trim() !== '') return value.trim();

  const lines = [
    `${name} 이(가) 설정되지 않았습니다.`,
    '',
    `  1. cp .env.example .env`,
    `  2. .env 의 ${name}= 뒤에 값을 채웁니다`,
  ];
  if (hint) lines.push('', hint);
  throw new Error(lines.join('\n'));
}
