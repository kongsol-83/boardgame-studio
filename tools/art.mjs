#!/usr/bin/env node
/**
 * 아트 생성.
 *
 * 카드마다 따로 생성하면 60장이 60가지 화풍으로 나온다. 검증된 해법은 **스타일 앵커**다.
 * 아트 바이블로 앵커를 몇 장 뽑고, 디렉터가 하나를 승인하고, 이후 모든 에셋은 그 앵커를
 * 레퍼런스로 붙여 만든다.
 *
 * **승인 전에는 배치 생성으로 넘어가지 않는다.** 앵커가 틀린 채로 60장을 돌리면 돈과
 * 시간을 그대로 버린다.
 *
 *   node tools/art.mjs anchor <slug> --set character
 *   node tools/art.mjs approve <slug> --set character --pick 2
 *   node tools/art.mjs estimate <slug>
 *   node tools/art.mjs gen <slug> --component action-card
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { parseCsvToArray, toNumber } from './lib/csv.mjs';
import { loadConfig } from './lib/config.mjs';
import { localIso } from './lib/datetime.mjs';
import { loadEnv, requireEnv, ROOT } from './lib/env.mjs';
import { createImageClient, estimateImageCost } from './lib/image.mjs';
import { resolvePixels } from './lib/spec.mjs';

const projectDir = (slug) => path.join(ROOT, 'projects', slug);
const artDir = (slug) => path.join(projectDir(slug), 'art');
const anchorDir = (slug, set) => path.join(artDir(slug), 'anchors', set);
const APPROVED = 'approved.png';

const log = (...args) => console.error(...args);
const output = (payload) => process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

function bail(message, hint) {
  console.error(`\n${message}${hint ? `\n\n${hint}` : ''}\n`);
  process.exit(1);
}

function readSpec(slug) {
  const file = path.join(projectDir(slug), 'spec.json');
  if (!existsSync(file)) bail(`${path.relative(ROOT, file)} 이 없습니다.`, '/bgs-components 로 컴포넌트 규격을 먼저 정의하세요.');
  return JSON.parse(readFileSync(file, 'utf8'));
}

function readArtBible(slug) {
  const file = path.join(artDir(slug), 'art-style.md');
  if (!existsSync(file)) {
    bail(
      `${path.relative(ROOT, file)} 이 없습니다.`,
      [
        '아트 바이블이 모든 프롬프트의 공통 접두사가 됩니다. 이게 없으면 화풍이 안 맞습니다.',
        '/bgs-art 로 먼저 정의하세요. 매체와 기법, 팔레트, 조명, 구도, 선 굵기, 금지 요소를 적습니다.',
      ].join('\n'),
    );
  }
  return readFileSync(file, 'utf8').trim();
}

/**
 * A4 인쇄를 전제로 한 프레이밍 제약. 모든 프롬프트에 붙는다.
 * 손으로 자르면 1~2mm는 틀어지고, 가정용 프린터에서 어두운 배경은 종이가 운다.
 */
function framingRules({ effectiveDpi }) {
  const rules = [
    '가장자리에서 안쪽 3mm 안에는 얼굴, 아이콘, 글자처럼 잘리면 안 되는 요소를 두지 않는다. 손으로 자르면 1~2mm는 틀어진다.',
    '배경은 가장자리까지 채운다. 잘려도 흰 테두리가 남지 않아야 한다.',
    '이미지 안에 글자를 넣지 않는다. 텍스트는 인쇄 단계에서 얹는다.',
    '전체적으로 너무 어둡게 만들지 않는다. 가정용 프린터에서 잉크를 많이 먹고 종이가 운다.',
  ];
  if (effectiveDpi && effectiveDpi < 250) {
    rules.push(`인쇄 해상도가 ${effectiveDpi}dpi가 한계다. 얇은 선이나 잔무늬는 뭉개지므로 넣지 않는다.`);
  }
  return rules.map((rule) => `- ${rule}`).join('\n');
}

function buildPrompt({ bible, subject, effectiveDpi, withReference }) {
  return [
    '# 아트 스타일',
    bible,
    '',
    ...(withReference
      ? ['# 레퍼런스', 'Image 1은 스타일 레퍼런스다. 매체, 붓질, 팔레트, 명암, 선 굵기를 그대로 따른다. 소재만 아래로 바꾼다.', '']
      : []),
    '# 소재',
    subject,
    '',
    '# 프레이밍',
    framingRules({ effectiveDpi }),
  ].join('\n');
}

/** spec 의 컴포넌트에서 픽셀 크기를 산출한다. */
function resolveComponent(component, print) {
  const [widthMm, heightMm] = component.size_mm ?? [];
  const pixels = resolvePixels(widthMm, heightMm, { dpi: print.dpi });
  if (!pixels.ok) {
    bail(
      `${component.id}: ${pixels.reason}`,
      ['다음 중 하나를 고르세요:', ...pixels.options.map((option) => `  - ${option}`)].join('\n'),
    );
  }
  return pixels;
}

const componentRows = (slug, id) => {
  const file = path.join(projectDir(slug), 'components', `${id}.csv`);
  return existsSync(file) ? parseCsvToArray(readFileSync(file, 'utf8')) : [];
};

const pick = (columns, candidates) => columns.find((column) => candidates.includes(column.toLowerCase())) ?? null;

// ---------------------------------------------------------------------------
// anchor
// ---------------------------------------------------------------------------

async function commandAnchor(slug, values) {
  const apiKey = requireEnv('OPENAI_API_KEY', 'https://platform.openai.com/api-keys 에서 발급받습니다.');
  const config = loadConfig();
  const spec = readSpec(slug);
  const bible = readArtBible(slug);

  const set = values.set;
  if (!set) bail('--set 이 필요합니다.', `spec.json 의 anchor_sets: ${(spec.anchor_sets ?? []).join(', ') || '(비어 있음)'}`);
  if (spec.anchor_sets && !spec.anchor_sets.includes(set)) {
    bail(`"${set}" 은 spec.json 의 anchor_sets 에 없습니다.`, `있는 것: ${spec.anchor_sets.join(', ')}`);
  }

  const subject = values.subject
    ?? bail('--subject 가 필요합니다.', '앵커로 뽑을 대표 소재를 적으세요. 예: --subject "복엽기를 모는 조종사의 반신, 정면"');

  // 앵커는 이 세트를 쓰는 컴포넌트 중 첫 번째 크기로 뽑는다
  const target = (spec.components ?? []).find((component) => component.art === set);
  const print = { ...config.print, ...(spec.print ?? {}) };
  const pixels = target ? resolveComponent(target, print) : { width: 1024, height: 1536, effectiveDpi: 300 };

  const count = Number(values.n ?? config.art.anchorCount);
  const quality = values.quality ?? config.art.quality;

  const client = createImageClient({
    apiKey,
    model: config.models.image,
    imagesPerMinute: config.art.imagesPerMinute,
    onProgress: (message) => log(`  ${message}`),
  });

  log(`"${set}" 앵커 후보 ${count}장을 ${pixels.width}x${pixels.height} ${quality} 품질로 뽑습니다.`);

  const dir = anchorDir(slug, set);
  mkdirSync(dir, { recursive: true });
  const prompt = buildPrompt({ bible, subject, effectiveDpi: pixels.effectiveDpi, withReference: false });
  const saved = [];

  for (let i = 1; i <= count; i++) {
    const [image] = await client.generate({ prompt, size: `${pixels.width}x${pixels.height}`, quality, n: 1 });
    const file = path.join(dir, `candidate-${i}.png`);
    writeFileSync(file, image);
    saved.push(path.relative(ROOT, file));
    log(`  ${i}/${count}`);
  }

  writeFileSync(path.join(dir, 'prompt.txt'), prompt);

  output({
    command: 'art anchor',
    slug,
    set,
    quality,
    size: `${pixels.width}x${pixels.height}`,
    candidates: saved,
    costUsd: estimateImageCost({ images: count, quality, model: client.model }),
    next: `후보를 보고 하나를 고른 뒤: node tools/art.mjs approve ${slug} --set ${set} --pick 1`,
    note: '승인 전에는 gen 이 거부합니다. 앵커가 틀린 채로 배치 생성하면 돈과 시간을 그대로 버립니다.',
  });
}

// ---------------------------------------------------------------------------
// approve
// ---------------------------------------------------------------------------

function commandApprove(slug, values) {
  const set = values.set ?? bail('--set 이 필요합니다.');
  const dir = anchorDir(slug, set);
  const candidates = existsSync(dir) ? readdirSync(dir).filter((name) => /^candidate-\d+\.png$/.test(name)).sort() : [];

  if (candidates.length === 0) {
    bail(`"${set}" 앵커 후보가 없습니다.`, `node tools/art.mjs anchor ${slug} --set ${set} --subject "..." 를 먼저 실행하세요.`);
  }

  const index = Number(values.pick ?? 1);
  const chosen = candidates.find((name) => name === `candidate-${index}.png`);
  if (!chosen) bail(`candidate-${index}.png 이 없습니다.`, `있는 것: ${candidates.join(', ')}`);

  writeFileSync(path.join(dir, APPROVED), readFileSync(path.join(dir, chosen)));
  writeFileSync(path.join(dir, 'approved.txt'), `${chosen}\n승인 ${localIso()}\n`);

  output({
    command: 'art approve',
    slug,
    set,
    approved: chosen,
    path: path.relative(ROOT, path.join(dir, APPROVED)),
    note: '이제 이 앵커가 해당 세트의 모든 에셋에 레퍼런스로 붙습니다.',
  });
}

// ---------------------------------------------------------------------------
// 생성 대상 수집
// ---------------------------------------------------------------------------

function collectTargets(slug, spec, values) {
  const targets = [];
  for (const component of spec.components ?? []) {
    if (!component.art) continue;
    if (values.component && component.id !== values.component) continue;

    const rows = componentRows(slug, component.id);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    const idColumn = pick(columns, ['id', 'card_id', 'component_id', 'code']);
    const promptColumn = pick(columns, ['art_prompt', 'prompt', '아트프롬프트']);
    const nameColumn = pick(columns, ['name', 'title', '이름']);

    if (rows.length === 0) {
      // CSV 없는 컴포넌트(보드 등)는 한 장만 만든다
      targets.push({ component, key: component.id, subject: component.label ?? component.id });
      continue;
    }
    if (!promptColumn) {
      log(`  ${component.id}: art_prompt 컬럼이 없어 건너뜁니다`);
      continue;
    }

    for (const [index, row] of rows.entries()) {
      const subject = String(row[promptColumn] ?? '').trim();
      if (!subject) continue;
      const key = String(row[idColumn] ?? `row-${index + 1}`);
      targets.push({ component, key, subject, name: nameColumn ? row[nameColumn] : null });
    }
  }
  return targets;
}

// ---------------------------------------------------------------------------
// estimate
// ---------------------------------------------------------------------------

function commandEstimate(slug, values) {
  const config = loadConfig();
  const spec = readSpec(slug);
  const quality = values.quality ?? config.art.quality;
  const targets = collectTargets(slug, spec, values);

  const byComponent = {};
  for (const target of targets) {
    byComponent[target.component.id] = (byComponent[target.component.id] ?? 0) + 1;
  }

  const model = config.models.image;
  const existing = targets.filter((target) =>
    existsSync(path.join(artDir(slug), target.component.id, `${target.key}.png`)),
  ).length;

  output({
    command: 'art estimate',
    slug,
    model,
    quality,
    total: targets.length,
    alreadyDone: existing,
    toGenerate: targets.length - existing,
    byComponent,
    costUsd: estimateImageCost({ images: targets.length - existing, quality, model, referencesPerImage: 1 }),
    estimatedMinutes: Number(((targets.length - existing) / Math.max(config.art.imagesPerMinute, 1)).toFixed(1)),
    note: [
      '대략적인 추정입니다. 실제 과금은 토큰 단위이고 크기에 따라 달라집니다.',
      `품질은 low에서 high가 33배 차이입니다. 반복 중에는 low, 제출용은 medium을 권합니다.`,
    ].join(' '),
  });
}

// ---------------------------------------------------------------------------
// gen
// ---------------------------------------------------------------------------

async function commandGen(slug, values) {
  const apiKey = requireEnv('OPENAI_API_KEY', 'https://platform.openai.com/api-keys 에서 발급받습니다.');
  const config = loadConfig();
  const spec = readSpec(slug);
  const bible = readArtBible(slug);
  const print = { ...config.print, ...(spec.print ?? {}) };
  const quality = values.quality ?? config.art.quality;

  let targets = collectTargets(slug, spec, values);
  if (targets.length === 0) bail('생성할 대상이 없습니다.', 'CSV에 art_prompt 컬럼이 있는지, spec.json 의 art 필드가 채워져 있는지 확인하세요.');

  if (values.only) {
    const wanted = new Set(String(values.only).split(',').map((entry) => entry.trim()));
    targets = targets.filter((target) => wanted.has(target.key));
    if (targets.length === 0) bail(`--only 로 지정한 것을 찾지 못했습니다: ${[...wanted].join(', ')}`);
  }

  // 앵커 승인 게이트
  const sets = [...new Set(targets.map((target) => target.component.art))];
  const missing = sets.filter((set) => !existsSync(path.join(anchorDir(slug, set), APPROVED)));
  if (missing.length > 0) {
    bail(
      `승인된 앵커가 없습니다: ${missing.join(', ')}`,
      [
        '앵커가 틀린 채로 배치 생성하면 돈과 시간을 그대로 버립니다.',
        '',
        ...missing.map((set) => `  node tools/art.mjs anchor ${slug} --set ${set} --subject "..."`),
        `  node tools/art.mjs approve ${slug} --set <세트> --pick <번호>`,
      ].join('\n'),
    );
  }

  const anchors = Object.fromEntries(
    sets.map((set) => [set, readFileSync(path.join(anchorDir(slug, set), APPROVED))]),
  );

  const client = createImageClient({
    apiKey,
    model: config.models.image,
    imagesPerMinute: config.art.imagesPerMinute,
    onProgress: (message) => log(`  ${message}`),
  });

  const pending = targets.filter((target) => {
    const file = path.join(artDir(slug), target.component.id, `${target.key}.png`);
    return values.force || !existsSync(file);
  });

  log(`${pending.length}장을 ${quality} 품질로 생성합니다. (전체 ${targets.length}장 중 ${targets.length - pending.length}장은 이미 있음)`);
  log('중단해도 이미 받은 것은 건너뛰므로 다시 실행하면 이어집니다.');

  const made = [];
  for (const [index, target] of pending.entries()) {
    const pixels = resolveComponent(target.component, print);
    const prompt = buildPrompt({
      bible,
      subject: target.name ? `${target.name} — ${target.subject}` : target.subject,
      effectiveDpi: pixels.effectiveDpi,
      withReference: true,
    });

    const [image] = await client.edit({
      prompt,
      size: `${pixels.width}x${pixels.height}`,
      quality,
      references: [{ name: `${target.component.art}-anchor.png`, data: anchors[target.component.art] }],
    });

    const dir = path.join(artDir(slug), target.component.id);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${target.key}.png`);
    writeFileSync(file, image);
    made.push(path.relative(ROOT, file));
    log(`  ${index + 1}/${pending.length} ${target.key}`);
  }

  output({
    command: 'art gen',
    slug,
    model: client.model,
    quality,
    generated: made.length,
    skipped: targets.length - pending.length,
    files: made.slice(0, 20),
    usage: client.usage,
    costUsd: estimateImageCost({ images: made.length, quality, model: client.model, referencesPerImage: 1 }),
    next: `node tools/pnp.mjs ${slug}`,
    note: 'cards.csv 의 art_file 컬럼에 파일명을 채우면 PnP가 얹습니다.',
  });
}

// ---------------------------------------------------------------------------

const USAGE = `
아트 생성

  anchor <slug> --set <세트> --subject "..." [--n 3] [--quality low]
      아트 바이블로 스타일 앵커 후보를 뽑는다.

  approve <slug> --set <세트> --pick <번호>
      후보 하나를 승인한다. 이후 그 세트의 모든 에셋에 레퍼런스로 붙는다.

  estimate <slug> [--quality medium] [--component <id>]
      생성할 장수와 대략적인 비용.

  gen <slug> [--component <id>] [--only id,id] [--quality] [--force]
      배치 생성. 이미 있는 파일은 건너뛴다.

승인 전에는 gen 이 거부한다. 앵커가 틀린 채로 60장을 돌리면 돈과 시간을 그대로 버린다.
모델과 품질 기본값은 studio.config.json 의 models.image 와 art 에 있다.
`;

loadEnv();

const { values, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    set: { type: 'string' },
    subject: { type: 'string' },
    pick: { type: 'string' },
    n: { type: 'string' },
    quality: { type: 'string' },
    component: { type: 'string' },
    only: { type: 'string' },
    force: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const [command, slug] = positionals;
if (values.help || !command) {
  console.error(USAGE);
  process.exit(command ? 0 : 1);
}
if (!slug) bail(`${command} 에는 프로젝트 슬러그가 필요합니다.`, USAGE);

try {
  if (command === 'anchor') await commandAnchor(slug, values);
  else if (command === 'approve') commandApprove(slug, values);
  else if (command === 'estimate') commandEstimate(slug, values);
  else if (command === 'gen') await commandGen(slug, values);
  else bail(`알 수 없는 커맨드: ${command}`, USAGE);
} catch (error) {
  console.error(`\n${error.message}\n`);
  if (process.env.DEBUG) console.error(error);
  process.exitCode = 1;
}
