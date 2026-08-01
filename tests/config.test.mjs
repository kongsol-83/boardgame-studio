import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { CONFIG_PATH, KNOWN_LANGUAGES, loadConfig, outputLanguage, stripJsonComments } from '../tools/lib/config.mjs';

test('저장소의 studio.config.json 이 주석을 걷어내면 유효한 JSON이다', () => {
  const raw = JSON.parse(stripJsonComments(readFileSync(CONFIG_PATH, 'utf8')));
  assert.equal(typeof raw.language, 'string');
  assert.equal(typeof raw.models.review, 'string', '리포트 작성 모델이 있어야 한다');
});

test('한 줄 주석과 블록 주석을 걷어낸다', () => {
  const source = `{
    // 한 줄 주석
    "a": 1, /* 블록 */
    /* 여러 줄
       블록 */
    "b": 2
  }`;
  assert.deepEqual(JSON.parse(stripJsonComments(source)), { a: 1, b: 2 });
});

test('문자열 안의 슬래시는 건드리지 않는다', () => {
  const source = '{ "url": "https://example.com/a//b", "path": "c:/x/*y*/z" }';
  const parsed = JSON.parse(stripJsonComments(source));
  assert.equal(parsed.url, 'https://example.com/a//b');
  assert.equal(parsed.path, 'c:/x/*y*/z');
});

test('이스케이프된 따옴표를 문자열 끝으로 보지 않는다', () => {
  const source = String.raw`{ "a": "그는 \"// 주석\" 이라 썼다", "b": 1 }`;
  const parsed = JSON.parse(stripJsonComments(source));
  assert.match(parsed.a, /\/\/ 주석/);
  assert.equal(parsed.b, 1);
});

test('주석을 지우다 생긴 후행 쉼표를 정리한다', () => {
  const source = `{
    "a": 1,
    "b": 2
    // 마지막 항목 뒤 주석
  }`;
  assert.deepEqual(JSON.parse(stripJsonComments(source)), { a: 1, b: 2 });
});

test('기본 언어는 한국어다', () => {
  delete process.env.BGS_LANGUAGE;
  const config = loadConfig({ reload: true });
  assert.equal(config.language, 'ko');
  assert.equal(config.languageLabel, '한국어');
  assert.deepEqual(config.warnings, []);
});

test('인쇄 기본값이 A4 여백 9mm 다', () => {
  delete process.env.BGS_LANGUAGE;
  const config = loadConfig({ reload: true });
  assert.equal(config.print.sheet, 'A4');
  // 포커 카드 63.5mm 3열이 190.5mm라 여백은 9.75mm 이하여야 한다
  assert.equal(config.print.margin_mm, 9);
  assert.equal(config.print.dpi, 300);
});

test('역할별 모델이 전부 설정에 있다', () => {
  const { models } = loadConfig({ reload: true });
  for (const role of ['sim', 'review', 'image']) {
    assert.equal(typeof models[role], 'string', `models.${role} 이 있어야 한다`);
    assert.ok(models[role].length > 0);
  }
});

test('BGG 와 아트 설정도 config 에 있다', () => {
  const config = loadConfig({ reload: true });
  assert.equal(typeof config.bgg.ranksMaxAgeDays, 'number');
  assert.equal(typeof config.bgg.hydrateTop, 'number');
  assert.equal(typeof config.bgg.requestsPerMinute, 'number');
  assert.equal(typeof config.art.imagesPerMinute, 'number');
  assert.equal(typeof config.art.quality, 'string');
});

test('시뮬레이션 기본값에서 토큰 예산은 무제한이다', () => {
  delete process.env.BGS_LANGUAGE;
  const { sim } = loadConfig({ reload: true });
  // null 이면 max_completion_tokens 를 아예 안 보낸다. 추론이 예산을 다 먹어
  // 빈 응답이 오는 일이 없어진다.
  assert.equal(sim.maxCompletionTokens, null);
  assert.equal(sim.reasoningEffort, 'low');
  assert.equal(sim.games, 30);
  assert.equal(sim.concurrency, 20);
  assert.equal(sim.minSampleForBias, 20);
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
