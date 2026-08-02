/**
 * 산출물에 찍히는 날짜와 시각.
 *
 * `toISOString()` 은 UTC를 낸다. 한국에서 오전 9시에 리포트를 뽑으면 파일명이 전날
 * 날짜로 찍힌다. 자정 근처가 아니라 **오전 내내 하루 밀리는** 문제라 그냥 두면
 * 플레이테스트 기록과 룰셋 변경 이력의 날짜가 어긋난다.
 *
 * 시간대는 `studio.config.json` 의 `timezone` 을 따른다. 기본값 `"auto"` 는 이 기계의
 * 시간대를 쓴다. 기계가 알려주지 않으면 `language` 로 추정하고, 그것도 없으면 UTC다.
 */

import { loadConfig } from './config.mjs';

/**
 * 언어에서 시간대를 추정할 때 쓰는 표.
 *
 * **추정일 뿐이다.** 한국어를 쓰는 사람이 베를린에 있을 수 있다. 그래서 기계가 알려주는
 * 시간대를 먼저 쓰고, 이 표는 그게 실패했을 때만 본다. 정확히 고정하고 싶으면
 * `timezone` 에 IANA 이름을 직접 적는다.
 */
export const LANGUAGE_TIMEZONE = {
  ko: 'Asia/Seoul',
  ja: 'Asia/Tokyo',
  'zh-CN': 'Asia/Shanghai',
  de: 'Europe/Berlin',
  fr: 'Europe/Paris',
  es: 'Europe/Madrid',
  // 영어는 쓰는 지역이 너무 넓어 추정하지 않는다
  en: 'UTC',
};

/** 이 시간대 이름을 Intl 이 아는가. */
export function isValidTimezone(name) {
  if (typeof name !== 'string' || name === '') return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/**
 * 쓸 시간대를 정한다.
 *
 * @param {{ timezone?: string, language?: string }} [config] 생략하면 studio.config.json
 * @returns {{ timezone: string, source: 'config'|'system'|'language'|'fallback', warning: string|null }}
 */
export function resolveTimezone(config) {
  const { timezone = 'auto', language = 'ko' } = config ?? loadConfig();

  if (timezone && timezone !== 'auto') {
    if (isValidTimezone(timezone)) return { timezone, source: 'config', warning: null };
    return {
      timezone: 'UTC',
      source: 'fallback',
      warning: `timezone "${timezone}" 은 알 수 없는 이름입니다. UTC로 진행합니다. Asia/Seoul 같은 IANA 이름을 쓰세요`,
    };
  }

  const system = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (isValidTimezone(system)) return { timezone: system, source: 'system', warning: null };

  const guessed = LANGUAGE_TIMEZONE[language];
  if (isValidTimezone(guessed)) return { timezone: guessed, source: 'language', warning: null };

  return { timezone: 'UTC', source: 'fallback', warning: null };
}

/** 주어진 시간대에서의 날짜·시각 조각. */
function partsIn(timezone, date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    // h23 이 아니면 ICU 버전에 따라 자정이 24시로 나온다
    hourCycle: 'h23',
  });

  const parts = {};
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
  return parts;
}

/** UTC 기준 오프셋. `+09:00` 형태. */
function offsetIn(timezone, date) {
  const formatter = new Intl.DateTimeFormat('en', { timeZone: timezone, timeZoneName: 'longOffset' });
  const found = formatter.formatToParts(date).find((part) => part.type === 'timeZoneName');
  // UTC는 "GMT" 로만 나오고 오프셋이 안 붙는다
  const raw = found?.value ?? 'GMT';
  return raw === 'GMT' ? '+00:00' : raw.replace('GMT', '');
}

/**
 * `2026-08-02`. 문서 제목과 파일명에 쓴다.
 * @param {{ now?: Date, timezone?: string }} [options]
 */
export function localDate({ now = new Date(), timezone } = {}) {
  const zone = timezone ?? resolveTimezone().timezone;
  const { year, month, day } = partsIn(zone, now);
  return `${year}-${month}-${day}`;
}

/**
 * `2026-08-02T09-10-33`. 파일명에 쓰므로 콜론을 하이픈으로 바꾼 형태다.
 * @param {{ now?: Date, timezone?: string }} [options]
 */
export function fileStamp({ now = new Date(), timezone } = {}) {
  const zone = timezone ?? resolveTimezone().timezone;
  const { year, month, day, hour, minute, second } = partsIn(zone, now);
  return `${year}-${month}-${day}T${hour}-${minute}-${second}`;
}

/**
 * `2026-08-02T09:10:33+09:00`. 로그에 남길 때 쓴다.
 *
 * 오프셋을 붙인 형태라 `new Date()` 가 그대로 파싱하면서 사람이 읽어도 현지 시각이다.
 * UTC로 남기면 기계는 괜찮지만 로그를 눈으로 볼 때 매번 9시간을 더해야 한다.
 *
 * @param {{ now?: Date, timezone?: string }} [options]
 */
export function localIso({ now = new Date(), timezone } = {}) {
  const zone = timezone ?? resolveTimezone().timezone;
  const { year, month, day, hour, minute, second } = partsIn(zone, now);
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${offsetIn(zone, now)}`;
}
