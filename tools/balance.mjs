#!/usr/bin/env node
/**
 * 컴포넌트 CSV 수치 분석.
 *
 * 밸런스를 결정하는 도구가 아니다. 설계할 때 감각을 뒷받침하는 보조 자료다.
 * 여기서 나온 잔차 하나로 카드 수치를 고치면 오버피팅이다. 진짜 근거는 테이블에서 나온다.
 *
 *   node tools/balance.mjs <slug>
 *   node tools/balance.mjs <slug> --component action-card
 *   node tools/balance.mjs <slug> --component action-card --cost cost --value power
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { parseCsvToArray, toNumber } from './lib/csv.mjs';
import { ROOT } from './lib/env.mjs';
import { describe as summarize, iqrOutliers, linearFit, pearson } from './lib/stats.mjs';

/** 숫자로 읽히는 값이 이 비율 이상이면 수치 컬럼으로 본다. */
const NUMERIC_THRESHOLD = 0.8;

/** 컬럼 이름에서 카드 식별자를 찾을 때 볼 후보. */
const ID_COLUMNS = ['id', 'card_id', 'component_id', 'code', 'key'];
const NAME_COLUMNS = ['name', 'title', '이름', '제목'];

function bail(message, hint) {
  console.error(`\n${message}${hint ? `\n\n${hint}` : ''}\n`);
  process.exit(1);
}

function componentsDir(slug) {
  return path.join(ROOT, 'projects', slug, 'components');
}

function listComponents(slug) {
  try {
    return readdirSync(componentsDir(slug))
      .filter((name) => name.endsWith('.csv'))
      .map((name) => path.basename(name, '.csv'));
  } catch {
    return [];
  }
}

/** 값의 80% 이상이 숫자로 읽히는 컬럼만 고른다. */
function numericColumns(rows) {
  if (rows.length === 0) return [];
  const columns = Object.keys(rows[0]);
  const numeric = [];

  for (const column of columns) {
    const filled = rows.map((row) => row[column]).filter((value) => String(value).trim() !== '');
    if (filled.length === 0) continue;
    const parsed = filled.filter((value) => toNumber(value) !== null);
    if (parsed.length / filled.length >= NUMERIC_THRESHOLD) numeric.push(column);
  }
  return numeric;
}

function pickLabelColumn(rows, candidates) {
  if (rows.length === 0) return null;
  const columns = Object.keys(rows[0]);
  return candidates.find((candidate) => columns.some((column) => column.toLowerCase() === candidate)) ?? null;
}

function labelFor(row, idColumn, nameColumn, index) {
  const parts = [];
  if (idColumn && row[idColumn]) parts.push(row[idColumn]);
  if (nameColumn && row[nameColumn]) parts.push(row[nameColumn]);
  return parts.length > 0 ? parts.join(' · ') : `행 ${index + 1}`;
}

function analyzeComponent(slug, component, { cost, value }) {
  const file = path.join(componentsDir(slug), `${component}.csv`);
  let rows;
  try {
    rows = parseCsvToArray(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      const available = listComponents(slug);
      bail(
        `${path.relative(ROOT, file)} 이 없습니다.`,
        available.length > 0
          ? `있는 컴포넌트: ${available.join(', ')}`
          : `projects/${slug}/components/ 가 비어 있습니다. /bgs-components 로 먼저 만드세요.`,
      );
    }
    throw error;
  }

  if (rows.length === 0) return { component, rows: 0, note: 'CSV에 데이터 행이 없습니다.' };

  const idColumn = pickLabelColumn(rows, ID_COLUMNS);
  const nameColumn = pickLabelColumn(rows, NAME_COLUMNS);
  const numeric = numericColumns(rows).filter((column) => column !== idColumn);

  if (numeric.length === 0) {
    return { component, rows: rows.length, note: '수치 컬럼이 없어 분석할 게 없습니다.' };
  }

  const series = Object.fromEntries(numeric.map((column) => [column, rows.map((row) => toNumber(row[column]))]));

  // 컬럼별 분포와 이상치
  const columns = {};
  for (const column of numeric) {
    const values = series[column];
    const outliers = iqrOutliers(values);
    columns[column] = {
      ...summarize(values),
      outliers: {
        bounds: [outliers.lowerBound, outliers.upperBound],
        high: outliers.high.map((index) => ({ label: labelFor(rows[index], idColumn, nameColumn, index), value: values[index] })),
        low: outliers.low.map((index) => ({ label: labelFor(rows[index], idColumn, nameColumn, index), value: values[index] })),
      },
    };
  }

  // 컬럼 쌍 상관
  const correlations = [];
  for (let i = 0; i < numeric.length; i++) {
    for (let j = i + 1; j < numeric.length; j++) {
      const r = pearson(series[numeric[i]], series[numeric[j]]);
      if (r !== null) correlations.push({ a: numeric[i], b: numeric[j], r });
    }
  }
  correlations.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));

  // 코스트 대비 값 회귀. 지정 안 하면 가장 강한 상관 쌍을 제안만 한다.
  let regression = null;
  let suggestion = null;

  if (cost && value) {
    if (!numeric.includes(cost)) bail(`"${cost}" 는 수치 컬럼이 아닙니다.`, `수치 컬럼: ${numeric.join(', ')}`);
    if (!numeric.includes(value)) bail(`"${value}" 는 수치 컬럼이 아닙니다.`, `수치 컬럼: ${numeric.join(', ')}`);

    const fit = linearFit(series[cost], series[value]);
    if (fit) {
      const sorted = [...fit.residuals].sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual));
      regression = {
        cost,
        value,
        n: fit.n,
        formula: `${value} ≈ ${fit.slope} × ${cost} + ${fit.intercept}`,
        r2: fit.r2,
        note:
          fit.r2 !== null && fit.r2 < 0.3
            ? '적합도가 낮습니다. 이 두 컬럼이 선형 관계가 아니거나, 코스트가 값을 설명하지 못한다는 뜻입니다. 잔차를 근거로 쓰지 마세요.'
            : '잔차가 양수면 코스트 대비 강한 쪽, 음수면 약한 쪽입니다.',
        outliers: sorted.slice(0, 10).map((entry) => ({
          label: labelFor(rows[entry.index], idColumn, nameColumn, entry.index),
          [cost]: entry.x,
          [value]: entry.y,
          expected: entry.predicted,
          residual: entry.residual,
        })),
      };
    }
  } else if (correlations.length > 0) {
    const top = correlations[0];
    suggestion = `--cost ${top.a} --value ${top.b} 로 회귀 잔차를 볼 수 있습니다 (상관 ${top.r}).`;
  }

  return { component, rows: rows.length, numericColumns: numeric, columns, correlations, regression, suggestion };
}

const USAGE = `
컴포넌트 수치 분석

  node tools/balance.mjs <slug> [--component <id>] [--cost <컬럼>] [--value <컬럼>]

  --component   특정 컴포넌트만. 없으면 전부
  --cost/--value  둘 다 주면 선형회귀 잔차를 낸다. 잔차가 큰 항목이
                  "비용 대비 과한 카드" 후보다

이 도구가 내는 숫자는 밸런스를 결정하지 않는다. 설계 감각을 뒷받침하는 보조 자료다.
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    component: { type: 'string' },
    cost: { type: 'string' },
    value: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

const slug = positionals[0];
if (values.help || !slug) {
  console.error(USAGE);
  process.exit(slug ? 0 : 1);
}

const targets = values.component ? [values.component] : listComponents(slug);
if (targets.length === 0) {
  bail(
    `projects/${slug}/components/ 에 CSV가 없습니다.`,
    '/bgs-components 로 컴포넌트를 먼저 정의하세요.',
  );
}

const results = targets.map((component) => analyzeComponent(slug, component, values));

process.stdout.write(
  `${JSON.stringify(
    {
      command: 'balance',
      slug,
      caveat:
        '이 수치는 밸런스를 결정하지 않습니다. 설계 감각을 뒷받침하는 보조 자료이며, 진짜 근거는 플레이테스트에서 나옵니다.',
      components: results,
    },
    null,
    2,
  )}\n`,
);
