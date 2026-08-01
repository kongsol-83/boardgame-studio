#!/usr/bin/env node
/**
 * 현재 스튜디오 설정을 JSON으로 낸다.
 *
 * 스킬과 에이전트가 "이 프로젝트는 어느 언어로 문서를 쓰는가"를 확인할 때 쓴다.
 *
 *   node tools/config.mjs
 */

import { CONFIG_PATH, KNOWN_LANGUAGES, loadConfig } from './lib/config.mjs';

const config = loadConfig();

for (const warning of config.warnings) console.error(`참고: ${warning}`);

process.stdout.write(
  `${JSON.stringify(
    {
      command: 'config',
      path: CONFIG_PATH,
      language: config.language,
      languageLabel: config.languageLabel,
      knownLanguages: KNOWN_LANGUAGES,
      defaults: config.defaults,
    },
    null,
    2,
  )}\n`,
);
