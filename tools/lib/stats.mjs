/**
 * 밸런스 검토용 기초 통계. 의존성 없는 순수 함수만 둔다.
 *
 * 여기서 나오는 숫자는 밸런스를 결정하지 않는다. 설계할 때 감각을 뒷받침하는
 * 보조 자료다. 진짜 근거는 테이블에서 나온다.
 */

/** 오름차순 정렬된 배열에서 분위수. R의 type 7 (선형 보간) 방식. */
export function quantile(sorted, p) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (position - lower) * (sorted[upper] - sorted[lower]);
}

/**
 * 한 컬럼의 분포.
 * @param {number[]} values
 */
export function describe(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) {
    return { n: 0, min: null, max: null, mean: null, median: null, q1: null, q3: null, stdev: null };
  }

  const sorted = [...clean].sort((a, b) => a - b);
  const mean = clean.reduce((sum, value) => sum + value, 0) / clean.length;
  // 표본분산(n-1). 이 카드들은 가능한 모든 카드의 표본이지 모집단이 아니다.
  const variance =
    clean.length > 1
      ? clean.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (clean.length - 1)
      : 0;

  return {
    n: clean.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: round(mean),
    median: round(quantile(sorted, 0.5)),
    q1: round(quantile(sorted, 0.25)),
    q3: round(quantile(sorted, 0.75)),
    stdev: round(Math.sqrt(variance)),
  };
}

/**
 * IQR 기준 이상치. Q1 - k*IQR 아래, Q3 + k*IQR 위.
 * 값이 아니라 **인덱스**를 돌려준다. 어느 카드인지 알아야 쓸모가 있다.
 */
export function iqrOutliers(values, { k = 1.5 } = {}) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 4) return { low: [], high: [], lowerBound: null, upperBound: null };

  const sorted = [...clean].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lowerBound = q1 - k * iqr;
  const upperBound = q3 + k * iqr;

  const low = [];
  const high = [];
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) return;
    if (value < lowerBound) low.push(index);
    else if (value > upperBound) high.push(index);
  });

  return { low, high, lowerBound: round(lowerBound), upperBound: round(upperBound) };
}

/** 피어슨 상관계수. 한쪽이라도 상수면 정의되지 않으므로 null. */
export function pearson(xs, ys) {
  const pairs = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pairs.push([xs[i], ys[i]]);
  }
  if (pairs.length < 3) return null;

  const n = pairs.length;
  const meanX = pairs.reduce((sum, [x]) => sum + x, 0) / n;
  const meanY = pairs.reduce((sum, [, y]) => sum + y, 0) / n;

  let covariance = 0;
  let varX = 0;
  let varY = 0;
  for (const [x, y] of pairs) {
    const dx = x - meanX;
    const dy = y - meanY;
    covariance += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return null;
  return round(covariance / Math.sqrt(varX * varY));
}

/**
 * y = ax + b 최소제곱 적합과 잔차.
 *
 * 잔차가 큰 카드가 곧 "비용 대비 과한 카드" 후보다. 밸런스 감각을 수치로
 * 뒷받침하는 데 가장 빨리 듣는 지표라 이걸 따로 둔다.
 *
 * 잔차는 입력 인덱스를 유지한다. 어느 카드인지 되짚을 수 있어야 한다.
 */
export function linearFit(xs, ys) {
  const usable = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) usable.push(i);
  }
  if (usable.length < 3) return null;

  const n = usable.length;
  const meanX = usable.reduce((sum, i) => sum + xs[i], 0) / n;
  const meanY = usable.reduce((sum, i) => sum + ys[i], 0) / n;

  let sxy = 0;
  let sxx = 0;
  for (const i of usable) {
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
    sxx += (xs[i] - meanX) ** 2;
  }
  if (sxx === 0) return null; // x가 상수면 기울기가 정의되지 않는다

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  let ssTotal = 0;
  let ssResidual = 0;
  const residuals = [];
  for (const i of usable) {
    const predicted = slope * xs[i] + intercept;
    const residual = ys[i] - predicted;
    ssTotal += (ys[i] - meanY) ** 2;
    ssResidual += residual ** 2;
    residuals.push({ index: i, x: xs[i], y: ys[i], predicted: round(predicted), residual: round(residual) });
  }

  return {
    n,
    slope: round(slope),
    intercept: round(intercept),
    r2: ssTotal === 0 ? null : round(1 - ssResidual / ssTotal),
    residuals,
  };
}

/** 소수점 4자리에서 자른다. 표시용이라 이 이상은 노이즈다. */
function round(value) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(4));
}
