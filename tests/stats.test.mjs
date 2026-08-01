import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describe as summarize, iqrOutliers, linearFit, pearson, quantile } from '../tools/lib/stats.mjs';

test('분위수는 선형 보간을 쓴다', () => {
  const sorted = [1, 2, 3, 4];
  assert.equal(quantile(sorted, 0), 1);
  assert.equal(quantile(sorted, 0.5), 2.5);
  assert.equal(quantile(sorted, 1), 4);
  assert.equal(quantile([5], 0.5), 5);
  assert.equal(quantile([], 0.5), null);
});

test('분포를 요약한다', () => {
  const stats = summarize([1, 2, 3, 4, 5]);
  assert.equal(stats.n, 5);
  assert.equal(stats.min, 1);
  assert.equal(stats.max, 5);
  assert.equal(stats.mean, 3);
  assert.equal(stats.median, 3);
  assert.equal(stats.q1, 2);
  assert.equal(stats.q3, 4);
  assert.equal(stats.stdev, 1.5811); // 표본표준편차(n-1)
});

test('숫자가 아닌 값을 걸러낸다', () => {
  const stats = summarize([1, NaN, 2, null, 3, undefined]);
  assert.equal(stats.n, 3);
  assert.equal(stats.mean, 2);
});

test('빈 입력에서 죽지 않는다', () => {
  const stats = summarize([]);
  assert.equal(stats.n, 0);
  assert.equal(stats.mean, null);
});

test('값이 하나면 표준편차는 0이다', () => {
  assert.equal(summarize([7]).stdev, 0);
});

test('IQR 이상치를 값이 아니라 인덱스로 돌려준다', () => {
  //                0  1  2  3  4  5  6  7   8
  const values = [10, 11, 12, 13, 14, 15, 16, 17, 100];
  const { high, low } = iqrOutliers(values);
  assert.deepEqual(high, [8], '어느 카드인지 알아야 하므로 인덱스여야 한다');
  assert.deepEqual(low, []);
});

test('표본이 4개 미만이면 이상치를 판정하지 않는다', () => {
  const result = iqrOutliers([1, 2, 100]);
  assert.deepEqual(result.high, []);
  assert.equal(result.upperBound, null);
});

test('이상치가 없으면 빈 배열', () => {
  const { low, high } = iqrOutliers([10, 11, 12, 13, 14]);
  assert.deepEqual([...low, ...high], []);
});

test('완전한 양의 상관은 1이다', () => {
  assert.equal(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1);
  assert.equal(pearson([1, 2, 3, 4], [8, 6, 4, 2]), -1);
});

test('한쪽이 상수면 상관계수는 정의되지 않는다', () => {
  assert.equal(pearson([1, 1, 1, 1], [1, 2, 3, 4]), null);
});

test('짝이 3개 미만이면 상관계수를 내지 않는다', () => {
  assert.equal(pearson([1, 2], [2, 4]), null);
  assert.equal(pearson([1, NaN, 3], [2, 4, NaN]), null);
});

test('선형 적합이 기울기와 절편을 찾는다', () => {
  // y = 2x + 1 정확히
  const fit = linearFit([1, 2, 3, 4], [3, 5, 7, 9]);
  assert.equal(fit.slope, 2);
  assert.equal(fit.intercept, 1);
  assert.equal(fit.r2, 1);
  assert.equal(fit.n, 4);
  assert.ok(fit.residuals.every((r) => Math.abs(r.residual) < 1e-9));
});

test('잔차가 비용 대비 과한 카드를 가리킨다', () => {
  // 코스트 1~5, 파워는 2배인데 인덱스 2번 카드만 혼자 세다
  const cost = [1, 2, 3, 4, 5];
  const power = [2, 4, 12, 8, 10];
  const fit = linearFit(cost, power);

  const worst = [...fit.residuals].sort((a, b) => b.residual - a.residual)[0];
  assert.equal(worst.index, 2, '3코스트 12파워 카드가 가장 튀어야 한다');
  assert.ok(worst.residual > 0);
});

test('잔차가 입력 인덱스를 유지한다', () => {
  // 1번 인덱스는 결측이라 적합에서 빠지지만 나머지 인덱스는 그대로여야 한다
  const fit = linearFit([1, NaN, 3, 4], [3, 5, 7, 9]);
  assert.deepEqual(fit.residuals.map((r) => r.index), [0, 2, 3]);
});

test('x가 상수면 적합할 수 없다', () => {
  assert.equal(linearFit([2, 2, 2, 2], [1, 2, 3, 4]), null);
});

test('점이 3개 미만이면 적합하지 않는다', () => {
  assert.equal(linearFit([1, 2], [2, 4]), null);
});
