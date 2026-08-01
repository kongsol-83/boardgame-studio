#!/usr/bin/env node
/**
 * 컴포넌트 규격 검증과 해석.
 *
 *   node tools/spec.mjs validate <slug>
 *   node tools/spec.mjs resolve <slug>
 *   node tools/spec.mjs sheet <slug>
 *   node tools/spec.mjs presets [--type card]
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { parseCsvToArray, toNumber } from './lib/csv.mjs';
import { loadConfig } from './lib/config.mjs';
import { ROOT } from './lib/env.mjs';
import { printableArea, resolvePixels, sheetLayout, tilePlan, validateSpec } from './lib/spec.mjs';

const specPath = (slug) => path.join(ROOT, 'projects', slug, 'spec.json');
const componentPath = (slug, id) => path.join(ROOT, 'projects', slug, 'components', `${id}.csv`);

function bail(message, hint) {
  console.error(`\n${message}${hint ? `\n\n${hint}` : ''}\n`);
  process.exit(1);
}

function readSpec(slug) {
  const file = specPath(slug);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      bail(
        `${path.relative(ROOT, file)} 이 없습니다.`,
        '/bgs-components 로 컴포넌트 규격을 먼저 정의하세요.',
      );
    }
    bail(`${path.relative(ROOT, file)} 을 읽지 못했습니다: ${error.message}`, 'JSON 문법을 확인하세요.');
  }
}

/**
 * 컴포넌트별 실제 수량. qty 컬럼이 있으면 합계, 없으면 행 수.
 * 같은 카드를 여러 장 넣는 경우가 흔해서 qty 를 먼저 본다.
 */
function actualCounts(slug, spec) {
  const counts = {};
  for (const component of spec.components ?? []) {
    if (!component?.id) continue;
    let rows;
    try {
      rows = parseCsvToArray(readFileSync(componentPath(slug, component.id), 'utf8'));
    } catch {
      continue; // CSV가 아직 없는 건 정상이다. 규격을 먼저 잡고 데이터를 채운다
    }
    if (rows.length === 0) continue;

    const qtyColumn = Object.keys(rows[0]).find((name) => ['qty', 'quantity', 'count', '수량'].includes(name.toLowerCase()));
    counts[component.id] = qtyColumn
      ? rows.reduce((sum, row) => sum + (toNumber(row[qtyColumn]) ?? 0), 0)
      : rows.length;
  }
  return counts;
}

function output(command, payload) {
  process.stdout.write(`${JSON.stringify({ command, ...payload }, null, 2)}\n`);
}

function commandValidate(slug) {
  const spec = readSpec(slug);
  const rowCounts = actualCounts(slug, spec);
  const result = validateSpec(spec, { rowCounts });

  output('spec validate', {
    slug,
    ok: result.ok,
    problems: result.problems,
    componentCounts: rowCounts,
  });
  if (!result.ok) process.exit(1);
}

function commandResolve(slug) {
  const spec = readSpec(slug);
  const print = { ...loadConfig().print, ...(spec.print ?? {}) };

  const components = (spec.components ?? []).map((component) => {
    const [widthMm, heightMm] = component.size_mm ?? [];
    const pixels = resolvePixels(widthMm, heightMm, { dpi: print.dpi });

    const entry = {
      id: component.id,
      label: component.label ?? null,
      type: component.type ?? null,
      size_mm: component.size_mm,
      art: component.art ?? null,
      pixels: pixels.ok ? { width: pixels.width, height: pixels.height } : null,
      effectiveDpi: pixels.effectiveDpi,
      ok: pixels.ok,
    };

    if (!pixels.ok) {
      entry.reason = pixels.reason;
      entry.options = pixels.options;
    } else if (pixels.effectiveDpi < 250) {
      entry.warning = `유효 ${pixels.effectiveDpi}dpi 가 한계입니다. 얇은 선이나 잔글씨를 넣지 마세요.`;
    }
    return entry;
  });

  output('spec resolve', {
    slug,
    print,
    note: '픽셀은 mm에서 자동 산출됩니다. spec.json 에 직접 적지 마세요.',
    components,
  });
}

function commandSheet(slug) {
  const spec = readSpec(slug);
  const print = { ...loadConfig().print, ...(spec.print ?? {}) };
  const area = printableArea(print);

  let totalSheets = 0;
  const components = (spec.components ?? []).map((component) => {
    const [widthMm, heightMm] = component.size_mm ?? [];
    const layout = sheetLayout(widthMm, heightMm, { count: component.count ?? 1, print });

    if (layout.fitsOnSheet) {
      totalSheets += layout.sheets;
      return {
        id: component.id,
        size_mm: component.size_mm,
        count: component.count,
        perSheet: layout.perSheet,
        grid: `${layout.cols}x${layout.rows}`,
        rotated: layout.rotated,
        sheets: layout.sheets,
      };
    }

    // 시트보다 크면 조각으로 나눈다
    const plan = tilePlan(widthMm, heightMm, { print });
    totalSheets += plan.sheets * (component.count ?? 1);
    return {
      id: component.id,
      size_mm: component.size_mm,
      count: component.count,
      fitsOnSheet: false,
      tiled: {
        orientation: plan.orientation,
        grid: `${plan.cols}x${plan.rows}`,
        sheetsPerCopy: plan.sheets,
        alternative: plan.alternatives[0]
          ? `${plan.alternatives[0].orientation} 로 깔면 ${plan.alternatives[0].sheets}장`
          : null,
      },
      sheets: plan.sheets * (component.count ?? 1),
    };
  });

  output('spec sheet', {
    slug,
    printableArea: { sheet: area.sheet, width_mm: area.width, height_mm: area.height, margin_mm: area.margin },
    totalSheets,
    components,
  });
}

function commandPresets(values) {
  const file = path.join(ROOT, 'presets', 'components.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const presets = values.type
    ? data.presets.filter((preset) => preset.type === values.type)
    : data.presets;
  output('spec presets', { count: presets.length, sources: data.sources, presets });
}

const USAGE = `
컴포넌트 규격 도구

  validate <slug>   필수 필드, 크기, 수량 검증. spec.json 의 count 와
                    CSV 실제 수량이 다르면 잡는다
  resolve <slug>    mm 를 이미지 모델이 받는 픽셀로 산출하고 유효 DPI를 보고
  sheet <slug>      A4 몇 장이 필요한지. 시트보다 큰 건 조각으로 나눈다
  presets [--type card]  표준 규격 목록

픽셀은 손으로 적지 않는다. mm 만 선언하면 나머지는 산출된다.
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: { type: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
});

const [command, slug] = positionals;

if (values.help || !command) {
  console.error(USAGE);
  process.exit(command ? 0 : 1);
}

if (command === 'presets') {
  commandPresets(values);
} else if (!slug) {
  bail(`${command} 에는 프로젝트 슬러그가 필요합니다.`, USAGE);
} else if (command === 'validate') {
  commandValidate(slug);
} else if (command === 'resolve') {
  commandResolve(slug);
} else if (command === 'sheet') {
  commandSheet(slug);
} else {
  bail(`알 수 없는 커맨드: ${command}`, USAGE);
}
