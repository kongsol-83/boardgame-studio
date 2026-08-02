#!/usr/bin/env node
/**
 * 현재 스튜디오 설정을 JSON으로 낸다.
 *
 * 스킬과 에이전트가 "이 프로젝트는 어느 언어로 문서를 쓰는가"를 확인할 때 쓴다.
 * 산출물 날짜가 이상할 때 시간대가 어떻게 잡혔는지 보는 자리이기도 하다.
 *
 *   node tools/config.mjs
 */

import { CONFIG_PATH, KNOWN_LANGUAGES, loadConfig } from './lib/config.mjs';
import { localDate, resolveTimezone } from './lib/datetime.mjs';

const config = loadConfig();
const zone = resolveTimezone(config);

for (const warning of [...config.warnings, zone.warning].filter(Boolean)) {
  console.error(`참고: ${warning}`);
}

process.stdout.write(
  `${JSON.stringify(
    {
      command: 'config',
      path: CONFIG_PATH,
      language: config.language,
      languageLabel: config.languageLabel,
      knownLanguages: KNOWN_LANGUAGES,
      timezone: {
        resolved: zone.timezone,
        // config = 직접 지정, system = 이 기계, language = 언어로 추정, fallback = UTC
        source: zone.source,
        today: localDate({ timezone: zone.timezone }),
      },
      print: config.print,
      models: config.models,
    },
    null,
    2,
  )}\n`,
);
