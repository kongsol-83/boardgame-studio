/**
 * 랭킹 덤프 신선도 검사.
 *
 * Cursor 훅이 아니라 CLI 안에 둔다. sessionStart 훅은 보드게임과 무관한 세션에도
 * 뜨고, beforeShellExecution 훅은 CLI가 이미 아는 사실을 밖에서 한 번 더 판단하는
 * 셈이다. 알림이 필요한 시점이 곧 CLI가 도는 순간이라 여기 두면 어떤 경로로
 * 부르든 걸린다.
 */

import { spawn } from 'node:child_process';

import { loadConfig } from '../lib/config.mjs';
import { getMeta, setMeta } from './db.mjs';

export const DUMP_URL = 'https://boardgamegeek.com/data_dumps/bg_ranks';

const DAY = 24 * 60 * 60 * 1000;

/** 파일명 `boardgames_ranks_2026-08-01.zip` 에서 날짜를 뽑는다. */
export function dateFromDumpName(filename) {
  const match = /(\d{4})-(\d{2})-(\d{2})/.exec(filename ?? '');
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 덤프가 오래됐는지 본다.
 * @returns {{ days: number, source: string|null, date: string|null, action: string }|null}
 */
export function checkFreshness(db, { now = Date.now(), maxAgeDays } = {}) {
  const limit = Number(maxAgeDays ?? loadConfig().bgg.ranksMaxAgeDays);
  const iso = getMeta(db, 'ranks_source_date');
  if (!iso) return null;

  const stamp = Date.parse(iso);
  if (Number.isNaN(stamp)) return null;

  const days = Math.floor((now - stamp) / DAY);
  if (days <= limit) return null;

  return {
    days,
    date: iso.slice(0, 10),
    source: getMeta(db, 'ranks_source_file'),
    action: `${DUMP_URL} 에서 새 덤프를 받아 data/ranks/ 에 그대로 넣고 "npm run bgg -- seed" 를 다시 실행하세요.`,
  };
}

/** 기본 브라우저로 URL을 연다. 실패해도 조용히 넘어간다. */
export function openInBrowser(url) {
  try {
    const [command, args] =
      process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : process.platform === 'darwin'
          ? ['open', [url]]
          : ['xdg-open', [url]];
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * 오래됐으면 알리고 하루 한 번만 브라우저를 연다.
 * 한 세션에서 유사작 검색을 열 번 하면 탭이 열 개 열리는 걸 막는다.
 */
export function nudgeIfStale(db, { open = true, now = Date.now() } = {}) {
  const stale = checkFreshness(db, { now });
  if (!stale) return null;

  const last = Number(getMeta(db, 'last_nudge_at', 0));
  if (open && now - last > DAY) {
    if (openInBrowser(DUMP_URL)) setMeta(db, 'last_nudge_at', now);
  }
  return stale;
}
