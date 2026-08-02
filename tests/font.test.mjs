import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { boldCandidates, needsUnicodeFont, resolveFont } from '../tools/lib/font.mjs';

// --- 굵은 짝 찾기 -----------------------------------------------------------

test('플랫폼마다 다른 파일명 관례를 모두 후보로 낸다', () => {
  const windows = boldCandidates('C:/Windows/Fonts/malgun.ttf');
  assert.ok(windows.some((file) => path.basename(file) === 'malgunbd.ttf'));

  const nanum = boldCandidates('/usr/share/fonts/truetype/nanum/NanumGothic.ttf');
  assert.ok(nanum.some((file) => path.basename(file) === 'NanumGothic-Bold.ttf'));
  assert.ok(nanum.some((file) => path.basename(file) === 'NanumGothicBold.ttf'));

  const dejavu = boldCandidates('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
  assert.ok(dejavu.some((file) => path.basename(file) === 'DejaVuSans-Bold.ttf'));
});

test('Regular 이 이름에 있으면 Bold 로 바꾼 것을 먼저 본다', () => {
  const candidates = boldCandidates('/usr/share/fonts/opentype/noto/NotoSansCJKkr-Regular.otf');
  assert.equal(path.basename(candidates[0]), 'NotoSansCJKkr-Bold.otf');
});

test('확장자와 폴더를 유지한다', () => {
  for (const file of boldCandidates('/opt/fonts/Custom.otf')) {
    assert.equal(path.extname(file), '.otf');
    assert.equal(path.dirname(file).replaceAll('\\', '/'), '/opt/fonts');
  }
});

test('이미 굵은 폰트면 후보가 없다', () => {
  assert.deepEqual(boldCandidates('C:/Windows/Fonts/malgunbd.ttf'), []);
  assert.deepEqual(boldCandidates('/opt/fonts/NanumGothicBold.ttf'), []);
  assert.deepEqual(boldCandidates('/opt/fonts/Noto-Bold.otf'), []);
});

test('같은 후보를 두 번 내지 않는다', () => {
  const candidates = boldCandidates('/opt/fonts/Sans.ttf');
  assert.equal(new Set(candidates).size, candidates.length);
});

// --- 유니코드 판정 ----------------------------------------------------------

test('ASCII만 있으면 유니코드 폰트가 필요 없다', () => {
  assert.equal(needsUnicodeFont('Tidepool v0.1'), false);
  assert.equal(needsUnicodeFont(''), false);
  assert.equal(needsUnicodeFont(null), false);
  assert.equal(needsUnicodeFont(undefined), false);
});

test('한글이나 특수 기호가 있으면 필요하다', () => {
  assert.equal(needsUnicodeFont('조수 웅덩이'), true);
  // 가운뎃점은 이 저장소가 제목에서 흔히 쓴다. pdfkit 내장 폰트로는 못 그린다
  assert.equal(needsUnicodeFont('버전 0.1 · 2026-08-02'), true);
  assert.equal(needsUnicodeFont('em dash — 하나'), true);
});

// --- 지정한 폰트 ------------------------------------------------------------

test('지정한 폰트가 없으면 어디를 고칠지 알려준다', () => {
  assert.throws(
    () => resolveFont({ configured: 'C:/없는/폴더/없는폰트.ttf' }),
    (error) => {
      assert.match(error.message, /찾을 수 없습니다/);
      assert.match(error.message, /print\.font/);
      assert.match(error.message, /BGS_PDF_FONT/);
      return true;
    },
  );
});

test('지정한 폰트가 있으면 그것을 쓴다', () => {
  // 폰트 파일인지까지는 보지 않는다. 실제 파싱은 pdfkit이 한다
  const resolved = resolveFont({ configured: 'package.json' });
  assert.equal(resolved.source, 'configured');
  assert.equal(resolved.label, 'package.json');
  assert.equal(path.isAbsolute(resolved.path), true);
});

test('환경변수보다 spec.json 의 설정이 앞선다', () => {
  const original = process.env.BGS_PDF_FONT;
  process.env.BGS_PDF_FONT = 'README.md';
  try {
    assert.equal(resolveFont({ configured: 'package.json' }).label, 'package.json');
    assert.equal(resolveFont({}).label, 'README.md');
  } finally {
    if (original === undefined) delete process.env.BGS_PDF_FONT;
    else process.env.BGS_PDF_FONT = original;
  }
});
