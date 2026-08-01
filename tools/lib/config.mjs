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
    /*
     * 출력은 A4 고정. 여백 9mm에는 근거가 있다.
     *
     * 포커 카드의 실제 규격은 63.5mm이고 3열이면 190.5mm다. A4에서 3열을
     * 지키려면 여백이 9.75mm 이하여야 한다. 10mm로 두면 0.5mm 차이로 3열이
     * 무너져서 장당 9장이 8장이 된다. 가장 흔한 규격에서 한 장을 잃는 셈이다.
     *
     * 8mm까지 내리면 몇몇 규격에서 조금 더 얻지만, 가정용 프린터의 인쇄 가능
     * 영역 여유가 얇아진다. 9mm가 포커 3x3을 지키면서 여유도 남는 지점이다.
     */
    print: { sheet: 'A4', margin_mm: 9, dpi: 300, cut_gap_mm: 0 },

    /*
     * 시뮬레이션. 사람마다 쓰는 모델과 예산이 다르므로 여기서 정한다.
     *
     * maxCompletionTokens 가 null 이면 파라미터를 아예 안 보낸다. 모델 자체 상한까지
     * 쓰게 되어 빈 응답이 나올 일이 없는 대신, 추론 모델에서 출력 토큰이 늘 수 있다.
     * 숫자로 두면 그 안에서 추론과 본문을 다 써야 하므로, 룰북이 길면 예산을 넉넉히
     * 잡아야 한다.
     */
    sim: {
      maxCompletionTokens: null,
      reasoningEffort: 'low',
      concurrency: 20,
      games: 30,
    },
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
  if (process.env.OPENAI_REASONING_EFFORT) merged.defaults.sim.reasoningEffort = process.env.OPENAI_REASONING_EFFORT.trim();
  if (process.env.OPENAI_MAX_COMPLETION_TOKENS) {
    const raw = process.env.OPENAI_MAX_COMPLETION_TOKENS.trim();
    merged.defaults.sim.maxCompletionTokens = raw === '' || raw === 'null' ? null : Number(raw);
  }

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
