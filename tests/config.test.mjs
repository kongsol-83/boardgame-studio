import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { CONFIG_PATH, KNOWN_LANGUAGES, loadConfig, outputLanguage } from '../tools/lib/config.mjs';

test('저장소의 studio.config.json 이 유효한 JSON이다', () => {
  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  assert.equal(typeof raw.language, 'string');
});

test('기본 언어는 한국어다', () => {
  delete process.env.BGS_LANGUAGE;
  const config = loadConfig({ reload: true });
  assert.equal(config.language, 'ko');
  assert.equal(config.languageLabel, '한국어');
  assert.deepEqual(config.warnings, []);
});

test('인쇄 기본값이 A4 여백 10mm 다', () => {
  delete process.env.BGS_LANGUAGE;
  const { defaults } = loadConfig({ reload: true });
  assert.equal(defaults.print.sheet, 'A4');
  assert.equal(defaults.print.margin_mm, 10);
  assert.equal(defaults.print.dpi, 300);
});

test('환경변수가 파일보다 우선한다', () => {
  process.env.BGS_LANGUAGE = 'en';
  try {
    const config = loadConfig({ reload: true });
    assert.equal(config.language, 'en');
    assert.equal(config.languageLabel, 'English');
    assert.deepEqual(config.warnings, []);
  } finally {
    delete process.env.BGS_LANGUAGE;
    loadConfig({ reload: true });
  }
});

test('모르는 언어여도 막지 않고 경고만 한다', () => {
  process.env.BGS_LANGUAGE = 'kr'; // ko 의 흔한 오타
  try {
    const config = loadConfig({ reload: true });
    assert.equal(config.language, 'kr', '값은 그대로 쓴다');
    assert.equal(config.warnings.length, 1);
    assert.match(config.warnings[0], /알려진 목록에 없습니다/);
  } finally {
    delete process.env.BGS_LANGUAGE;
    loadConfig({ reload: true });
  }
});

test('알려진 언어 목록에 최소한 ko 와 en 이 있다', () => {
  assert.ok(KNOWN_LANGUAGES.ko);
  assert.ok(KNOWN_LANGUAGES.en);
});

test('outputLanguage 가 설정값을 돌려준다', () => {
  delete process.env.BGS_LANGUAGE;
  loadConfig({ reload: true });
  assert.equal(outputLanguage(), 'ko');
});

test('두 번째 호출은 캐시를 쓴다', () => {
  const first = loadConfig({ reload: true });
  assert.equal(loadConfig(), first);
});
