import assert from 'node:assert/strict';
import test from 'node:test';

import { outline, parseInline, parseMarkdown, spansToText } from '../tools/lib/markdown.mjs';

const first = (source) => parseMarkdown(source)[0];
const text = (source) => spansToText(first(source).spans);

// --- 인라인 -----------------------------------------------------------------

test('굵게와 기울임과 인라인 코드를 구분한다', () => {
  const spans = parseInline('보통 **굵게** *기울임* `코드`');
  assert.deepEqual(
    spans.map((span) => [span.text, span.bold, span.italic, span.code]),
    [
      ['보통 ', false, false, false],
      ['굵게', true, false, false],
      [' ', false, false, false],
      ['기울임', false, true, false],
      [' ', false, false, false],
      ['코드', false, false, true],
    ],
  );
});

test('강조 안의 강조는 플래그가 합쳐진다', () => {
  const spans = parseInline('**굵고 *기울인* 것**');
  const both = spans.find((span) => span.text === '기울인');
  assert.equal(both.bold, true);
  assert.equal(both.italic, true);
});

test('밑줄이 든 식별자는 기울어지지 않는다', () => {
  // `_` 를 이탤릭으로 보면 art_file 과 size_mm 사이가 기울어진다.
  // 룰북에서 이탤릭보다 식별자가 훨씬 자주 나온다.
  const spans = parseInline('art_file 과 size_mm 을 본다');
  assert.equal(spans.length, 1);
  assert.equal(spans[0].italic, false);
  assert.equal(spans[0].text, 'art_file 과 size_mm 을 본다');
});

test('인라인 코드 안의 별표는 글자다', () => {
  const spans = parseInline('`**굵지 않다**`');
  assert.equal(spans.length, 1);
  assert.equal(spans[0].code, true);
  assert.equal(spans[0].bold, false);
  assert.equal(spans[0].text, '**굵지 않다**');
});

test('이스케이프한 별표는 그대로 남는다', () => {
  assert.equal(spansToText(parseInline('\\*별표\\*')), '*별표*');
  assert.equal(parseInline('\\*별표\\*')[0].italic, false);
});

test('닫히지 않은 표시는 글자로 남긴다', () => {
  assert.equal(spansToText(parseInline('별표 하나 * 남았다')), '별표 하나 * 남았다');
  assert.equal(spansToText(parseInline('역따옴표 ` 하나')), '역따옴표 ` 하나');
});

test('링크는 주소를 들고 온다', () => {
  const spans = parseInline('[BGG](https://boardgamegeek.com) 를 본다');
  assert.equal(spans[0].text, 'BGG');
  assert.equal(spans[0].link, 'https://boardgamegeek.com');
  assert.equal(spans[1].link, null);
});

// --- 문단과 제목 ------------------------------------------------------------

test('제목의 단계와 내용을 읽는다', () => {
  const block = first('### 물때 정산');
  assert.equal(block.type, 'heading');
  assert.equal(block.level, 3);
  assert.equal(spansToText(block.spans), '물때 정산');
});

test('닫는 우물 표시는 제목에서 뺀다', () => {
  assert.equal(text('## 셋업 ##'), '셋업');
});

test('줄바꿈 하나는 공백이 된다', () => {
  // 원문이 공백 자리에서 줄을 넘기므로 공백 없이 이으면 「점수를얻은」이 된다
  const block = first('가장 많은 점수를\n얻은 사람이 이긴다.');
  assert.equal(block.type, 'paragraph');
  assert.equal(spansToText(block.spans), '가장 많은 점수를 얻은 사람이 이긴다.');
});

test('빈 줄이 문단을 나눈다', () => {
  const blocks = parseMarkdown('첫 문단\n\n두 번째 문단');
  assert.equal(blocks.length, 2);
  assert.equal(spansToText(blocks[1].spans), '두 번째 문단');
});

test('BOM과 CRLF를 처리한다', () => {
  const blocks = parseMarkdown('\uFEFF# 제목\r\n\r\n본문\r\n');
  assert.equal(blocks[0].type, 'heading');
  assert.equal(spansToText(blocks[0].spans), '제목');
  assert.equal(spansToText(blocks[1].spans), '본문');
});

// --- 목록 -------------------------------------------------------------------

test('중첩 목록의 단계를 들여쓰기로 잡는다', () => {
  const block = first('- 1단계\n  - 2단계\n    - 3단계\n- 다시 1단계');
  assert.equal(block.type, 'list');
  assert.equal(block.ordered, false);
  assert.deepEqual(block.items.map((item) => item.level), [0, 1, 2, 0]);
});

test('들여쓴 이어지는 줄은 앞 항목에 붙는다', () => {
  const block = first('- 첫 항목이고\n  이 줄은 이어진다\n- 둘째');
  assert.equal(block.items.length, 2);
  assert.equal(spansToText(block.items[0].spans), '첫 항목이고 이 줄은 이어진다');
});

test('순서 목록을 구분한다', () => {
  const block = first('1. 첫째\n2. 둘째\n3. 셋째');
  assert.equal(block.ordered, true);
  assert.equal(block.items.length, 3);
});

test('세 단계보다 깊은 들여쓰기는 세 단계로 묶는다', () => {
  const block = first('- 하나\n        - 아주 깊다');
  assert.equal(block.items[1].level, 2);
});

// --- 표 ---------------------------------------------------------------------

test('머리행과 정렬과 본문을 읽는다', () => {
  const block = first('| 항목 | 2인 | 3인 |\n| --- | --: | :-: |\n| 시작 자원 | 5 | 4 |');
  assert.equal(block.type, 'table');
  assert.deepEqual(block.head.map(spansToText), ['항목', '2인', '3인']);
  assert.deepEqual(block.align, ['left', 'right', 'center']);
  assert.deepEqual(block.rows[0].map(spansToText), ['시작 자원', '5', '4']);
});

test('양끝 파이프가 없어도 읽는다', () => {
  const block = first('항목 | 값\n--- | ---\n라운드 수 | 8');
  assert.deepEqual(block.head.map(spansToText), ['항목', '값']);
  assert.deepEqual(block.rows[0].map(spansToText), ['라운드 수', '8']);
});

test('열 수는 머리행이 정한다', () => {
  const block = first('| a | b | c |\n| --- | --- | --- |\n| 1 |\n| 1 | 2 | 3 | 4 |');
  assert.deepEqual(block.rows[0].map(spansToText), ['1', '', '']);
  assert.deepEqual(block.rows[1].map(spansToText), ['1', '2', '3']);
});

test('이스케이프한 파이프는 셀을 나누지 않는다', () => {
  const block = first('| 기호 | 뜻 |\n| --- | --- |\n| a \\| b | 또는 |');
  assert.equal(block.rows[0].length, 2);
  assert.equal(spansToText(block.rows[0][0]), 'a | b');
});

test('표 구분선을 수평선으로 오해하지 않는다', () => {
  // `| --- |` 는 수평선 정규식에도 걸릴 수 있다. 표 판정이 먼저여야 한다
  const blocks = parseMarkdown('| a |\n| --- |\n| 1 |');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'table');
});

test('표 안의 강조와 코드가 살아 있다', () => {
  const block = first('| 항목 | 값 |\n| --- | --- |\n| `id` | **필수** |');
  assert.equal(block.rows[0][0][0].code, true);
  assert.equal(block.rows[0][1][0].bold, true);
});

// --- 인용과 코드와 수평선 ---------------------------------------------------

test('인용 안의 목록과 표가 유지된다', () => {
  const block = first('> 인용 문단\n>\n> - 항목 하나\n>\n> | a | b |\n> | --- | --- |\n> | 1 | 2 |');
  assert.equal(block.type, 'quote');
  assert.deepEqual(block.blocks.map((inner) => inner.type), ['paragraph', 'list', 'table']);
});

test('인용 다음의 본문은 인용에 들어가지 않는다', () => {
  const blocks = parseMarkdown('> 인용\n\n본문');
  assert.equal(blocks[0].type, 'quote');
  assert.equal(blocks[1].type, 'paragraph');
  assert.equal(spansToText(blocks[1].spans), '본문');
});

test('코드 블록은 언어와 줄을 그대로 남긴다', () => {
  const block = first('```js\nconst a = 1;\n  const b = 2;\n```');
  assert.equal(block.type, 'code');
  assert.equal(block.lang, 'js');
  assert.equal(block.text, 'const a = 1;\n  const b = 2;');
});

test('코드 블록 안의 제목 표시는 제목이 아니다', () => {
  const blocks = parseMarkdown('```\n# 제목이 아니다\n```');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'code');
});

test('수평선을 읽는다', () => {
  assert.equal(first('---').type, 'rule');
  assert.equal(first('***').type, 'rule');
});

test('빈 입력에서 죽지 않는다', () => {
  assert.deepEqual(parseMarkdown(''), []);
  assert.deepEqual(parseMarkdown(null), []);
  assert.deepEqual(parseInline(undefined), []);
});

// --- 목차 -------------------------------------------------------------------

test('목차는 지정한 단계까지만 담는다', () => {
  const blocks = parseMarkdown('# 룰북\n## 셋업\n### 첫 물때\n#### 예외');
  assert.deepEqual(outline(blocks), [
    { level: 1, text: '룰북' },
    { level: 2, text: '셋업' },
    { level: 3, text: '첫 물때' },
  ]);
  assert.equal(outline(blocks, { maxLevel: 2 }).length, 2);
});

// --- 실제 룰셋 --------------------------------------------------------------

test('예제 룰셋을 통째로 읽는다', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(
    new URL('../projects/example-tidepool/ruleset.md', import.meta.url),
    'utf8',
  );
  const blocks = parseMarkdown(source);

  const kinds = new Set(blocks.map((block) => block.type));
  assert.ok(kinds.has('heading'));
  assert.ok(kinds.has('paragraph'));
  assert.ok(kinds.has('list'));
  assert.ok(kinds.has('quote'));
  assert.ok(kinds.has('table'));

  assert.equal(blocks[0].level, 1);
  assert.equal(spansToText(blocks[0].spans), '조수 웅덩이 룰북');

  // 수치표가 둘로 나뉘어 있다. 인원별과 공통이다
  const tables = blocks.filter((block) => block.type === 'table');
  assert.equal(tables.length, 2);
  assert.deepEqual(tables[0].head.map(spansToText), ['항목', '2인', '3인', '4인']);
  assert.deepEqual(tables[1].head.map(spansToText), ['항목', '값']);
});
