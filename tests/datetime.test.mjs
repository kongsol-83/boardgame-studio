import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fileStamp, isValidTimezone, LANGUAGE_TIMEZONE, localDate, localIso, resolveTimezone } from '../tools/lib/datetime.mjs';

// 한국 시각 2026-08-02 새벽 3시 10분. UTC로는 아직 8월 1일 18시다.
// 예제 시뮬레이션 리포트가 실제로 하루 전 날짜로 찍혔던 시각이라 그대로 고정해둔다.
const EARLY_KST = new Date('2026-08-02T03:10:33+09:00');

test('한국 새벽에 UTC를 쓰면 날짜가 하루 밀린다', () => {
  // 문제를 못 박아두는 테스트다. 이게 깨지면 전제가 바뀐 것이다
  assert.equal(EARLY_KST.toISOString().slice(0, 10), '2026-08-01');
  assert.equal(localDate({ now: EARLY_KST, timezone: 'Asia/Seoul' }), '2026-08-02');
});

test('시간대에 따라 같은 순간이 다른 날짜가 된다', () => {
  assert.equal(localDate({ now: EARLY_KST, timezone: 'Asia/Seoul' }), '2026-08-02');
  assert.equal(localDate({ now: EARLY_KST, timezone: 'UTC' }), '2026-08-01');
  assert.equal(localDate({ now: EARLY_KST, timezone: 'America/New_York' }), '2026-08-01');
});

test('파일명 스탬프는 콜론을 쓰지 않는다', () => {
  const stamp = fileStamp({ now: EARLY_KST, timezone: 'Asia/Seoul' });
  assert.equal(stamp, '2026-08-02T03-10-33');
  assert.ok(!stamp.includes(':'), 'Windows 파일명에 콜론을 쓸 수 없다');
});

test('로그용 ISO에는 오프셋이 붙는다', () => {
  assert.equal(localIso({ now: EARLY_KST, timezone: 'Asia/Seoul' }), '2026-08-02T03:10:33+09:00');
  assert.equal(localIso({ now: EARLY_KST, timezone: 'UTC' }), '2026-08-01T18:10:33+00:00');
});

test('로그용 ISO를 Date가 다시 파싱하면 같은 순간이다', () => {
  const round = new Date(localIso({ now: EARLY_KST, timezone: 'Asia/Seoul' }));
  assert.equal(round.getTime(), EARLY_KST.getTime());
});

test('자정은 24시가 아니라 00시다', () => {
  const midnight = new Date('2026-08-01T15:00:00Z'); // KST 2026-08-02 00:00
  assert.equal(fileStamp({ now: midnight, timezone: 'Asia/Seoul' }), '2026-08-02T00-00-00');
  assert.equal(localDate({ now: midnight, timezone: 'Asia/Seoul' }), '2026-08-02');
});

test('서머타임이 있는 시간대의 오프셋이 계절에 따라 바뀐다', () => {
  const summer = new Date('2026-07-01T12:00:00Z');
  const winter = new Date('2026-01-01T12:00:00Z');
  assert.equal(localIso({ now: summer, timezone: 'America/New_York' }).slice(-6), '-04:00');
  assert.equal(localIso({ now: winter, timezone: 'America/New_York' }).slice(-6), '-05:00');
});

test('알 수 없는 시간대를 걸러낸다', () => {
  assert.equal(isValidTimezone('Asia/Seoul'), true);
  assert.equal(isValidTimezone('UTC'), true);
  assert.equal(isValidTimezone('Asia/Seoul '), false);
  assert.equal(isValidTimezone('Mars/Olympus'), false);
  assert.equal(isValidTimezone(''), false);
  assert.equal(isValidTimezone(undefined), false);
});

test('설정에 적은 시간대를 그대로 쓴다', () => {
  const resolved = resolveTimezone({ timezone: 'Europe/Berlin', language: 'ko' });
  assert.equal(resolved.timezone, 'Europe/Berlin');
  assert.equal(resolved.source, 'config');
  assert.equal(resolved.warning, null);
});

test('오타 난 시간대는 UTC로 넘기되 알려준다', () => {
  const resolved = resolveTimezone({ timezone: 'Asia/Soul', language: 'ko' });
  assert.equal(resolved.timezone, 'UTC');
  assert.equal(resolved.source, 'fallback');
  assert.match(resolved.warning, /Asia\/Soul/);
});

test('auto 는 기계의 시간대를 쓴다', () => {
  const resolved = resolveTimezone({ timezone: 'auto', language: 'ko' });
  assert.equal(resolved.source, 'system');
  assert.equal(resolved.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone);
});

test('언어 추정표의 값이 전부 유효한 시간대다', () => {
  for (const [language, timezone] of Object.entries(LANGUAGE_TIMEZONE)) {
    assert.ok(isValidTimezone(timezone), `${language} 의 ${timezone} 이 유효하지 않다`);
  }
});
