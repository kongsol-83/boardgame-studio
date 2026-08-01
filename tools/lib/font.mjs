/**
 * PDF에 임베드할 폰트를 찾는다.
 *
 * pdfkit 내장 폰트(Helvetica 등)는 한글을 못 그린다. 이 저장소는 한국어가 기본이고
 * 산출물 언어도 바꿀 수 있으므로, 시스템에서 유니코드 폰트를 찾아 임베드한다.
 * pdfkit이 쓰인 글리프만 서브셋하므로 12MB 폰트를 써도 PDF는 작다.
 *
 * 폰트를 저장소에 담지 않는 이유는 라이선스와 용량 때문이다. 대신 못 찾으면
 * 무엇을 어떻게 하라고 명확히 알려준다.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { ROOT } from './env.mjs';

/**
 * 플랫폼별 후보. CJK를 그릴 수 있는 것을 앞에 둔다.
 * .ttc(폰트 컬렉션)는 pdfkit에서 패밀리 이름을 따로 줘야 해서 뒤로 미룬다.
 */
const CANDIDATES = {
  win32: [
    { path: 'C:/Windows/Fonts/malgun.ttf', label: '맑은 고딕', cjk: true },
    { path: 'C:/Windows/Fonts/NanumGothic.ttf', label: '나눔고딕', cjk: true },
    { path: 'C:/Windows/Fonts/arial.ttf', label: 'Arial', cjk: false },
  ],
  darwin: [
    { path: '/System/Library/Fonts/Supplemental/AppleGothic.ttf', label: 'AppleGothic', cjk: true },
    { path: '/Library/Fonts/NanumGothic.ttf', label: '나눔고딕', cjk: true },
    { path: '/System/Library/Fonts/Supplemental/Arial Unicode.ttf', label: 'Arial Unicode', cjk: true },
    { path: '/Library/Fonts/Arial.ttf', label: 'Arial', cjk: false },
  ],
  linux: [
    { path: '/usr/share/fonts/truetype/nanum/NanumGothic.ttf', label: '나눔고딕', cjk: true },
    { path: '/usr/share/fonts/opentype/noto/NotoSansCJKkr-Regular.otf', label: 'Noto Sans CJK KR', cjk: true },
    { path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', label: 'Noto Sans CJK', cjk: true },
    { path: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', label: 'DejaVu Sans', cjk: false },
  ],
};

/** ASCII 밖의 문자가 있는지. 있으면 CJK 지원 폰트가 필요하다고 본다. */
export function needsUnicodeFont(text) {
  // eslint-disable-next-line no-control-regex
  return /[^\u0000-\u007F]/.test(String(text ?? ''));
}

/**
 * 쓸 폰트를 고른다.
 *
 * @param {{ configured?: string, requireCjk?: boolean }} [options]
 *        configured 는 spec.json 의 print.font 나 BGS_PDF_FONT
 * @returns {{ path: string, label: string, cjk: boolean, source: string }|null}
 */
export function resolveFont({ configured, requireCjk = false } = {}) {
  const explicit = configured ?? process.env.BGS_PDF_FONT;
  if (explicit) {
    const resolved = path.isAbsolute(explicit) ? explicit : path.join(ROOT, explicit);
    if (!existsSync(resolved)) {
      throw new Error(
        [
          `지정한 폰트를 찾을 수 없습니다: ${resolved}`,
          '',
          'spec.json 의 print.font 또는 환경변수 BGS_PDF_FONT 를 확인하세요.',
        ].join('\n'),
      );
    }
    return { path: resolved, label: path.basename(resolved), cjk: true, source: 'configured' };
  }

  const candidates = CANDIDATES[process.platform] ?? CANDIDATES.linux;
  const usable = candidates.filter((candidate) => existsSync(candidate.path));

  const preferred = requireCjk ? usable.filter((candidate) => candidate.cjk) : usable;
  if (preferred.length > 0) return { ...preferred[0], source: 'system' };

  return null;
}

/** 폰트를 못 찾았을 때 사람이 읽을 안내. */
export function fontHelp(requireCjk) {
  const install = {
    win32: '맑은 고딕은 Windows에 기본 포함입니다. 없다면 나눔고딕을 설치하세요.',
    darwin: 'brew install --cask font-nanum-gothic 으로 설치할 수 있습니다.',
    linux: 'sudo apt install fonts-nanum 또는 fonts-noto-cjk 로 설치하세요.',
  }[process.platform] ?? 'CJK를 지원하는 TTF 또는 OTF 폰트를 설치하세요.';

  return [
    requireCjk
      ? 'PDF에 넣을 한글 폰트를 찾지 못했습니다. pdfkit 내장 폰트는 한글을 그리지 못합니다.'
      : 'PDF에 넣을 폰트를 찾지 못했습니다.',
    '',
    install,
    '',
    '또는 spec.json 에 경로를 직접 지정하세요:',
    '  "print": { "font": "C:/Windows/Fonts/malgun.ttf" }',
    '',
    '환경변수 BGS_PDF_FONT 로도 지정할 수 있습니다.',
  ].join('\n');
}
