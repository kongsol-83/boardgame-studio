#!/usr/bin/env node
/**
 * 개발 환경 점검.
 *
 *   npm run doctor
 *
 * 처음 클론했을 때 무엇이 준비됐고 무엇이 빠졌는지 한 번에 보여준다.
 * 특히 Windows PowerShell 5.1은 인코딩 기본값 때문에 조용히 시간을 잡아먹으므로
 * 여기서 짚고 넘어간다.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { loadConfig } from './lib/config.mjs';
import { loadEnv, ROOT } from './lib/env.mjs';
import { dateFromDumpName } from './bgg/freshness.mjs';

loadEnv();

const checks = [];
const ok = (name, detail) => checks.push({ level: 'ok', name, detail });
const warn = (name, detail, fix) => checks.push({ level: 'warn', name, detail, fix });
const fail = (name, detail, fix) => checks.push({ level: 'fail', name, detail, fix });

function has(command, args = ['--version']) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

// --- Node -------------------------------------------------------------------
const major = Number(process.versions.node.split('.')[0]);
if (major >= 24) ok('Node.js', process.version);
else fail('Node.js', `${process.version} — node:sqlite 때문에 24 이상이 필요합니다`, 'https://nodejs.org 에서 24 LTS 이상을 설치하세요');

// --- 셸 (Windows) -----------------------------------------------------------
if (process.platform === 'win32') {
  const pwsh = has('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']);
  if (pwsh) {
    ok('PowerShell 7', `v${pwsh} — 리다이렉션과 파일 쓰기가 UTF-8 기본입니다`);
  } else {
    warn(
      'PowerShell 7',
      '미설치. Windows PowerShell 5.1은 > 리다이렉션이 UTF-16으로, Set-Content -Encoding UTF8 이 BOM을 붙여 씁니다. 한글도 콘솔에서 깨집니다',
      'winget install --id Microsoft.PowerShell --source winget 후 에디터 터미널 기본 프로필을 pwsh 로 바꾸세요',
    );
  }
}

// --- git --------------------------------------------------------------------
const git = has('git');
if (!git) {
  fail('git', '미설치', 'https://git-scm.com');
} else {
  const email = has('git', ['config', 'user.email']);
  if (email) ok('git', `${git.replace('git version ', 'v')} · ${email}`);
  else warn('git', `${git} · user.email 미설정`, 'git config --global user.email "you@example.com"');
}

// --- 설정 -------------------------------------------------------------------
const config = loadConfig();
ok('산출물 언어', `${config.language} (${config.languageLabel}) · studio.config.json`);
ok('인쇄 기본값', `${config.print.sheet} 여백 ${config.print.margin_mm}mm ${config.print.dpi}dpi`);
ok('모델', `플레이 ${config.models.sim} · 리포트 ${config.models.review} · 아트 ${config.models.image}`);
for (const warning of config.warnings) warn('설정', warning);

// --- 시크릿 -----------------------------------------------------------------
if (!existsSync(path.join(ROOT, '.env'))) {
  warn('.env', '없음 — 키가 필요한 기능은 막힙니다', 'cp .env.example .env 로 복사한 뒤 값을 채우세요 (이름 변경이 아니라 복사)');
} else {
  const filled = (name) => Boolean(process.env[name]?.trim());
  const bgg = filled('BGG_API_TOKEN');
  const openai = filled('OPENAI_API_KEY');

  if (bgg) ok('BGG 토큰', '설정됨 — 레퍼런스 조사 가능');
  else warn('BGG 토큰', '비어 있음 — /bgs-reference 가 막힙니다', 'https://boardgamegeek.com/applications 에서 발급');

  if (openai) ok('OpenAI 키', '설정됨 — 시뮬레이션과 아트 생성 가능');
  else warn('OpenAI 키', '비어 있음 — /bgs-sim 과 /bgs-art 가 막힙니다', 'https://platform.openai.com/api-keys');
}

// --- BGG 인덱스 -------------------------------------------------------------
const ranksDir = path.join(ROOT, 'data', 'ranks');
const dumps = existsSync(ranksDir) ? readdirSync(ranksDir).filter((name) => /\.(zip|csv)$/.test(name)) : [];

if (dumps.length === 0) {
  warn(
    '랭킹 덤프',
    'data/ranks/ 에 없음',
    'https://boardgamegeek.com/data_dumps/bg_ranks 에서 받아 data/ranks/ 에 넣거나, node tools/bgg/cli.mjs seed --crawl',
  );
} else {
  const newest = dumps.map((name) => ({ name, when: dateFromDumpName(name)?.getTime() ?? 0 })).sort((a, b) => b.when - a.when)[0];
  const days = newest.when ? Math.floor((Date.now() - newest.when) / 86_400_000) : null;
  const limit = config.bgg.ranksMaxAgeDays;
  const detail = `${newest.name}${days === null ? '' : ` · ${days}일 전`}`;
  if (days !== null && days > limit) warn('랭킹 덤프', `${detail} — ${limit}일이 지났습니다`, '새로 받아 data/ranks/ 에 넣고 seed 를 다시 실행하세요');
  else ok('랭킹 덤프', detail);
}

if (existsSync(path.join(ROOT, 'data', 'bgg.sqlite'))) ok('BGG 인덱스', 'data/bgg.sqlite 있음 · 상태는 npm run bgg -- stats');
else warn('BGG 인덱스', '없음', 'node tools/bgg/cli.mjs seed 후 hydrate');

// --- 키가 실제로 통하는지 (--online) -----------------------------------------
if (process.argv.includes('--online')) {
  const probe = async (name, url, headers) => {
    try {
      const response = await fetch(url, { headers });
      if (response.ok) return { ok: true };
      const body = await response.text();
      return { ok: false, status: response.status, body: body.slice(0, 200).replace(/\s+/g, ' ') };
    } catch (error) {
      return { ok: false, status: 0, body: error.message };
    }
  };

  if (process.env.BGG_API_TOKEN?.trim()) {
    // www 를 붙이면 인증이 깨지므로 붙이지 않는다
    const result = await probe('BGG', 'https://boardgamegeek.com/xmlapi2/thing?id=1', {
      Authorization: `Bearer ${process.env.BGG_API_TOKEN.trim()}`,
    });
    if (result.ok) ok('BGG 토큰 (온라인)', '실제 호출 성공');
    else fail('BGG 토큰 (온라인)', `${result.status} ${result.body}`, 'https://boardgamegeek.com/applications 에서 토큰을 다시 확인하세요');
  }

  if (process.env.OPENAI_API_KEY?.trim()) {
    const result = await probe('OpenAI', 'https://api.openai.com/v1/models', {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY.trim()}`,
    });
    if (result.ok) ok('OpenAI 키 (온라인)', '실제 호출 성공');
    else fail('OpenAI 키 (온라인)', `${result.status} ${result.body}`, 'https://platform.openai.com/api-keys 에서 키를 다시 확인하거나 새로 발급하세요');
  }
}

// --- 출력 -------------------------------------------------------------------
const ICON = { ok: '  OK  ', warn: ' 주의 ', fail: ' 실패 ' };

console.log('');
for (const check of checks) {
  console.log(`[${ICON[check.level]}] ${check.name}`);
  console.log(`         ${check.detail}`);
  if (check.fix) console.log(`         -> ${check.fix}`);
}

const failed = checks.filter((check) => check.level === 'fail').length;
const warned = checks.filter((check) => check.level === 'warn').length;

console.log('');
console.log(failed > 0 ? `실패 ${failed}건, 주의 ${warned}건` : warned > 0 ? `주의 ${warned}건. 해당 기능만 막히고 나머지는 동작합니다.` : '전부 정상입니다.');
console.log('');

process.exit(failed > 0 ? 1 : 0);
