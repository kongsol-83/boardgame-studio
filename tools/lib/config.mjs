/**
 * 스튜디오 설정.
 *
 * **`.env` 는 키(시크릿)만 담는다.** 조정할 값은 전부 여기다. 그래야 설정이 한 군데
 * 모이고, 값을 바꾸려고 시크릿 파일을 열 일이 없어진다.
 *
 * `studio.config.json` 은 주석을 쓸 수 있다(JSONC). 어떤 값을 왜 그렇게 두는지는
 * 값 옆에 적혀 있어야 나중에 바꿀 때 판단할 수 있다.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { loadEnv, ROOT } from './env.mjs';

export const CONFIG_PATH = path.join(ROOT, 'studio.config.json');

/** 산출 문서 언어. 여기 없는 코드를 써도 막지 않고 경고만 한다. */
export const KNOWN_LANGUAGES = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  'zh-CN': '简体中文',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
};

/**
 * 내장 기본값. studio.config.json 이 없거나 일부만 적혀 있어도 동작한다.
 * 각 값이 왜 그런지는 studio.config.json 의 주석에 적혀 있다.
 */
const DEFAULTS = {
  language: 'ko',
  models: { sim: 'gpt-5.4-nano', review: 'gpt-5.4-mini', image: 'gpt-image-2' },
  print: { sheet: 'A4', margin_mm: 9, dpi: 300, cut_gap_mm: 0 },
  sim: { maxCompletionTokens: null, reasoningEffort: 'low', concurrency: 20, games: 30, minSampleForBias: 20 },
  art: { quality: 'low', imagesPerMinute: 5, anchorCount: 3 },
  bgg: { ranksMaxAgeDays: 90, hydrateTop: 20_000, requestsPerMinute: 55 },
};

/**
 * JSONC 에서 주석을 걷어낸다.
 *
 * 설정 파일은 사람이 고치는 것이라 값 옆에 이유가 적혀 있어야 한다. JSON은 주석을
 * 지원하지 않으므로 읽기 전에 벗겨낸다.
 *
 * 문자열 안의 `//` 는 지우면 안 된다. URL 같은 값이 들어갈 수 있으므로 따옴표와
 * 이스케이프를 따라가며 판단한다.
 */
export function stripJsonComments(source) {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];

    if (inLine) {
      if (char === '\n') { inLine = false; out += char; }
      continue;
    }
    if (inBlock) {
      if (char === '*' && next === '/') { inBlock = false; i += 1; }
      continue;
    }
    if (inString) {
      out += char;
      if (char === '\\') { out += next ?? ''; i += 1; }
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; out += char; continue; }
    if (char === '/' && next === '/') { inLine = true; i += 1; continue; }
    if (char === '/' && next === '*') { inBlock = true; i += 1; continue; }
    out += char;
  }
  // 주석을 지우다 남은 후행 쉼표를 정리한다
  return out.replace(/,(\s*[}\]])/g, '$1');
}

let cached = null;

function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return base;
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    result[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? deepMerge(base[key] ?? {}, value)
        : value;
  }
  return result;
}

/**
 * 설정을 읽는다. 파일이 없거나 깨져 있어도 기본값으로 동작한다.
 * @param {{ reload?: boolean }} [options]
 */
export function loadConfig({ reload = false } = {}) {
  if (cached && !reload) return cached;
  loadEnv();

  let fromFile = {};
  let warning = null;
  try {
    fromFile = JSON.parse(stripJsonComments(readFileSync(CONFIG_PATH, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      warning = `studio.config.json 을 읽지 못해 기본값으로 진행합니다: ${error.message}`;
    }
  }

  const merged = deepMerge(DEFAULTS, fromFile);

  /*
   * 환경변수는 언어만 받는다. CI에서 한 번 갈아끼우는 용도다.
   * 나머지 설정은 전부 studio.config.json 에 있다. .env 는 키만 담는다.
   */
  if (process.env.BGS_LANGUAGE) merged.language = process.env.BGS_LANGUAGE.trim();

  const warnings = [];
  if (warning) warnings.push(warning);
  if (!KNOWN_LANGUAGES[merged.language]) {
    warnings.push(
      `language "${merged.language}" 는 알려진 목록에 없습니다. 그대로 진행하지만 오타가 아닌지 확인하세요. ` +
        `알려진 값: ${Object.keys(KNOWN_LANGUAGES).join(', ')}`,
    );
  }

  cached = { ...merged, languageLabel: KNOWN_LANGUAGES[merged.language] ?? merged.language, warnings };
  return cached;
}

/** 산출 문서를 어느 언어로 쓸지. */
export function outputLanguage() {
  return loadConfig().language;
}
