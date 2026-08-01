/**
 * 스튜디오 설정.
 *
 * 이 저장소는 한국어로 만들어졌지만 쓰는 사람의 나라가 다를 수 있다.
 * 산출 문서(컨셉, 룰셋, 검토 리포트 등)의 언어를 여기서 정한다.
 * 스킬과 에이전트는 이 값을 읽어 그 언어로 문서를 쓴다.
 *
 * 우선순위: 환경변수 > studio.config.json > 내장 기본값
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

const DEFAULTS = {
  language: 'ko',
  defaults: {
    // 출력은 A4 고정이다. 여백 10mm가 포커 카드 3x3을 지키면서 거의 모든
    // 가정용 프린터의 인쇄 가능 영역 안에 들어오는 지점이다.
    print: { sheet: 'A4', margin_mm: 10, dpi: 300, cut_gap_mm: 0 },
  },
};

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
    fromFile = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      warning = `studio.config.json 을 읽지 못해 기본값으로 진행합니다: ${error.message}`;
    }
  }

  const merged = deepMerge(DEFAULTS, fromFile);

  // 환경변수가 파일보다 우선한다. CI나 일회성 실행에서 갈아끼우기 위함이다.
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
