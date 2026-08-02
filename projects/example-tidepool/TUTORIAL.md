# 튜토리얼: 예제로 한 바퀴 돌아보기

**읽으면서 명령을 따라 치는 문서입니다.** 예제 프로젝트 `example-tidepool` 에는 도구가
무엇을 잡아내는지 보여주려고 일부러 심어둔 문제들이 있습니다. 목록으로 읽어서는 감이
안 오고, 직접 걸려봐야 압니다.

> *[English version below](#tutorial-a-full-pass-with-the-example-project).*

**준비물은 `npm install` 하나입니다. 일곱 단계 전부 API 키 없이 됩니다.** 키가 필요한 건
맨 끝의 「더 볼 것」 절뿐입니다. 전부 따라 하면 20분쯤 걸립니다.

심어둔 것은 넷입니다. **잘못 만든 카드 한 장, A4를 넘는 보드, 이미지 모델이 거부하는 비율,
답이 빠진 룰북.** 어느 도구가 각각을 어떻게 잡아내는지 보고 나면 자기 게임에서도 같은
신호가 눈에 들어옵니다.

실험하다 예제를 망가뜨려도 괜찮습니다. `example-*` 은 git이 추적하니 언제든 되돌립니다.

```bash
git checkout -- projects/example-tidepool
```

---

## 0단계. 환경 확인

```bash
npm run doctor
```

무엇이 준비됐고 무엇이 빠졌는지 나옵니다. **Node.js 항목만 초록불이면** 끝까지 갑니다.
BGG 토큰과 OpenAI 키는 비어 있어도 됩니다.

Windows에서 "이 셸" 항목에 주의가 뜨면 [README의 PowerShell 절](../../README.md#windows라면-powershell-7을-먼저-설치하세요)을
먼저 읽으세요. 그냥 넘어가면 인코딩 때문에 원인을 찾기 어려운 오류를 만납니다.

---

## 1단계. 규격이 무엇을 잡아내는가

**픽셀은 손으로 적지 않습니다.** mm로 선언하면 도구가 이미지 모델 제약에 맞춰 픽셀을
잡고, 그렇게 잡은 크기의 유효 DPI가 얼마인지 알려줍니다.

먼저 규격 자체가 온전한지 봅니다.

```bash
node tools/spec.mjs validate example-tidepool
```

```json
{ "ok": true, "problems": [], "componentCounts": { "action-card": 28 } }
```

`componentCounts` 에 `action-card` 만 있는 게 정상입니다. **CSV 데이터가 있는 컴포넌트만
수량을 대조**하기 때문입니다. 나머지 넷은 `spec.json` 에 규격만 선언돼 있습니다.

이제 픽셀을 산출합니다.

```bash
node tools/spec.mjs resolve example-tidepool
```

출력이 길지만 **볼 곳은 네 군데**입니다.

| 컴포넌트 | 선언 | 산출 | 무엇을 보여주는가 |
| --- | --- | --- | --- |
| `action-card` | 63.5×88mm | 752×1040px · 301dpi | 정상적인 카드. 기준선 |
| `resource-token` | 20×20mm | 832×832px · **1057dpi** | 너무 작아서 **키웠다**. 인쇄할 때 줄인다 |
| `main-board` | 420×297mm | 3360×2368px · **203dpi** | 너무 커서 **줄였다**. 경고가 붙는다 |
| `marker-strip` | 100×25mm | **없음** | 생성 자체가 불가능하다 |

`main-board` 의 경고를 그대로 읽어보세요.

```
"유효 203dpi 가 한계입니다. 얇은 선이나 잔글씨를 넣지 마세요."
```

**인쇄하고 나서 알면 늦습니다.** 잔글씨를 잔뜩 넣은 보드를 이미 뽑아버렸다면 고치는 방법은
다시 뽑는 것뿐입니다.

`marker-strip` 은 아예 멈춰섭니다.

```json
{
  "ok": false,
  "reason": "긴 변과 짧은 변의 비율이 4.00:1 입니다. 이미지 모델은 3:1 까지만 받습니다",
  "options": [
    "3:1 이내로 생성한 뒤 잘라 씁니다",
    "컴포넌트를 둘로 쪼갭니다",
    "이 컴포넌트는 아트를 포기하고 도형과 텍스트로 갑니다 (spec.json 에서 art: null)"
  ]
}
```

**여기서 도구가 멈춰서는 게 중요합니다.** 알아서 3:1로 잘라버리면 내 컴포넌트가 바뀐 줄도
모르고 넘어갑니다.

### 직접 해보기

`spec.json` 의 `marker-strip` 크기를 `[100, 25]` 에서 `[90, 30]` 으로 바꾸세요. 비율이 정확히
3:1이 되는 값입니다.

```bash
node tools/spec.mjs resolve example-tidepool
```

`ok: true` 로 바뀌고 `1424×480px · 402dpi` 가 나옵니다. 확인했으면 되돌리세요.

```bash
git checkout -- projects/example-tidepool/spec.json
```

---

## 2단계. A4 몇 장이 필요한가

```bash
node tools/spec.mjs sheet example-tidepool
```

```json
{ "printableArea": { "width_mm": 192, "height_mm": 279, "margin_mm": 9 }, "totalSheets": 12 }
```

컴포넌트별로 보면 `action-card` 는 **3×3으로 시트당 9장**, `resource-token` 은 9×13으로
117개입니다. `main-board` 는 다릅니다.

```json
{
  "fitsOnSheet": false,
  "tiled": { "orientation": "landscape", "grid": "2x2", "sheetsPerCopy": 4,
             "alternative": "portrait 로 깔면 6장" }
}
```

**한 장에 안 들어가면 쪼갭니다. 두 방향을 다 계산해서 적은 쪽을 고릅니다.** 가로로 깔면
4장, 세로면 6장이라 가로를 골랐다고 알려줍니다.

### 직접 해보기: 0.5mm가 한 열을 날린다

README에 "여백 9mm는 근거가 있다"고 적혀 있습니다. 직접 확인해보세요. `spec.json` 의
`print.margin_mm` 을 `9` 에서 `10` 으로 바꾸면 됩니다.

```bash
node tools/spec.mjs sheet example-tidepool
```

`action-card` 가 이렇게 바뀝니다.

```json
{ "perSheet": 8, "grid": "2x4", "rotated": true }
```

포커 카드의 실제 규격은 63.5mm입니다. 3열이면 **190.5mm**가 필요한데, 여백 9mm면 인쇄
영역이 192mm라 들어가고 10mm면 **190mm**라 0.5mm가 모자랍니다. 3열이 무너지자 도구가
카드를 눕혀 2×4로 8장을 건졌습니다. **9장이 8장이 됩니다.**

이 예제는 28장이라 어느 쪽이든 4시트여서 총 12시트 그대로입니다. 하지만 60장짜리
덱이라면 7시트가 8시트가 됩니다. 여백 1mm가 종이 한 장입니다.

되돌리세요.

```bash
git checkout -- projects/example-tidepool/spec.json
```

---

## 3단계. 수치가 무엇을 잡아내는가

```bash
node tools/balance.mjs example-tidepool --cost cost --value power
```

출력 맨 위의 문장을 먼저 읽으세요.

```
"이 수치는 밸런스를 결정하지 않습니다. 설계 감각을 뒷받침하는 보조 자료이며,
 진짜 근거는 플레이테스트에서 나옵니다."
```

**예제에는 잘못 만든 카드가 한 장 있습니다.** `TP05 무리한 잠수` 는 3코스트에 파워 12로,
5코스트 카드(10, 11)보다 강합니다. 그런데 이걸 어떻게 잡아내는지가 볼 만합니다.

먼저 `power` 컬럼의 분포를 보세요.

```json
"power": { "min": 1, "max": 12, "mean": 6.0833, "outliers": { "high": [], "low": [] } }
```

**이상치가 하나도 없다고 나옵니다.** 파워 12는 사분위수 기준(상한 15.625)으로는 전혀 튀지
않습니다. 12라는 값 자체가 이상한 게 아니니까요. 이상한 건 **3코스트에 12라는 조합**입니다.

그래서 회귀를 봅니다.

```json
"regression": {
  "formula": "power ≈ 2.2032 × cost + -0.3426",
  "r2": 0.7205,
  "note": "잔차가 양수면 코스트 대비 강한 쪽, 음수면 약한 쪽입니다.",
  "outliers": [
    { "label": "TP05 · 무리한 잠수", "cost": 3, "power": 12, "expected": 6.2669, "residual": 5.7331 },
    { "label": "TP07 · 미끼 뿌리기", "cost": 4, "power": 7,  "expected": 8.4701, "residual": -1.4701 }
  ]
}
```

`TP05` 의 잔차가 **+5.73**입니다. 2등이 -1.47이니 **자리가 다릅니다.** 3코스트면 기대값이
6.27쯤인데 12를 줬습니다.

**한 컬럼만 들여다보면 코스트 대비 문제는 안 잡힙니다.** 카드 밸런스는 거의 언제나
조합에서 생기니까요. 그래서 이 도구가 회귀 잔차를 같이 냅니다.

상관계수도 볼 만합니다.

```json
{ "a": "cost", "b": "qty", "r": -0.9408 }
```

비싼 카드는 장수가 적습니다. **의도한 설계라면 정상입니다.** 의도하지 않았는데 이 값이
나오면 모르는 사이에 스스로 규칙을 하나 만든 겁니다.

`TP05` 의 텍스트를 보면 `"채집력을 두 배로 한다. 물때 종료 시 자원을 전부 잃는다."` 입니다.
**수치만 보는 도구는 이 페널티를 모릅니다.** 그래서 잔차가 크다고 틀린 게 아니라, 사람이
볼 자리라는 표시입니다. `bgs-balance-designer` 가 근거를 정리해주고 고르는 건 직접 합니다.

---

## 4단계. 텍스트가 카드에 들어가는가

```bash
node tools/pnp.mjs example-tidepool --check
```

```json
{ "overflowing": 0, "note": "전부 들어갑니다.",
  "components": [ { "component": "action-card", "fontSizes": { "title": 13, "body": 9.5 } } ] }
```

폰트 크기는 컴포넌트 크기에서 산출됩니다. 63.5mm 카드는 본문 9.5pt, 50mm 타일은 7.5pt로
줄어듭니다.

### 직접 해보기: 넘치게 만들어보기

`components/action-card.csv` 의 `TP01` 행에서 `text` 를 늘리세요. 같은 문장을 여섯 번쯤
반복해 붙이면 됩니다.

```bash
node tools/pnp.mjs example-tidepool --check
```

```json
{ "overflowing": 1,
  "note": "카드에 안 들어가는 텍스트입니다. 문구를 줄이거나 카드를 키우세요. 인쇄한 뒤 발견하면 룰을 다시 써야 합니다.",
  "overflow": [ { "id": "TP01", "name": "물때 살피기", "neededMm": 69.8, "availableMm": 67.4 } ] }
```

**필요한 높이와 남은 높이를 mm로 알려주고 종료 코드가 1이 됩니다.** CI가 이 코드로 막습니다.
88mm 카드에서 본문에 쓸 수 있는 높이가 67.4mm라는 것도 여기서 알게 됩니다.

되돌린 다음 실제 PDF를 뽑아보세요.

```bash
git checkout -- projects/example-tidepool/components/action-card.csv
node tools/pnp.mjs example-tidepool
```

`pnp/example-tidepool-YYYY-MM-DD.pdf` 가 생깁니다. 열어서 재단선과 3×3 배치를 보세요.
아트가 없어서 도형과 텍스트만 나오는데, **그 상태로도 인쇄해서 플레이할 수 있습니다.**
그림은 맨 마지막에 얹습니다. 없어도 테이블에는 올라갑니다.

---

## 5단계. 엔진이 멀쩡한가

```bash
node tools/sim.mjs smoke example-tidepool
```

30초쯤 걸립니다. 랜덤 봇으로 **인원별 20,000판씩 총 6만 판**을 돌립니다.

```json
{ "ok": true, "elapsedSec": 33.3, "problems": [],
  "byPlayers": { "2": { "finished": 20000, "unfinished": 0,
    "seatWinRate": [0.5, 0.5], "turns": { "min": 16, "median": 16, "max": 16 } } },
  "note": "엔진이 멀쩡합니다. run 으로 넘어가도 됩니다." }
```

**이건 밸런스 검사가 아니라 엔진 검사입니다.** 교착에 빠지는가, 완주하는가, 예외가 나는가.
랜덤 봇이 6만 판을 다 끝냈으면 룰의 진행 구조에 구멍은 없다는 뜻입니다.

`turns` 가 최소·중앙·최대 모두 16으로 같은 게 눈에 걸릴 텐데, 이 게임은 8라운드 고정이라
2인이면 항상 16턴입니다. **자기 게임에서 이 값이 벌어지면** 어떤 판은 길고 어떤 판은
짧다는 말입니다. 그러면 플레이타임을 약속할 수 없습니다.

그리고 `moveUsage` 를 보세요. 스모크 테스트의 주 목적은 아니지만 눈에 들어옵니다.

```json
[ { "move": "rest", "count": 153244 }, { "move": "TP10", "count": 30152 } ]
```

**`rest` 가 5배 넘게 압도적입니다.** 랜덤 봇은 가능한 수 중에서 아무거나 고르는데, 자원이
모자라면 낼 카드가 없어서 `rest` 만 남습니다. **자원 경제가 빡빡하다는 신호가 여기 이미
보입니다.** 6단계의 플레이테스트 리포트에도 "자원이 부족할 때 쉬기만 반복하게 되는 진행이
단조롭다"가 그대로 나옵니다.

### 직접 플레이해보기

```bash
node tools/sim.mjs serve example-tidepool
```

브라우저가 열립니다. 한 판 해보세요. **다음 단계의 준비 운동입니다.** "이건 룰북에 안 적혀
있는데?" 싶은 순간을 기억해두시면 됩니다.

---

## 6단계. 룰북의 구멍을 직접 찾아보기

예제를 만든 이유가 이 단계에 있습니다. **먼저 스스로 해보고 나서 답을 보세요.** 순서를
바꾸면 배울 게 없습니다.

### 6-1. 혼자 읽기 (5분)

[`ruleset.md`](ruleset.md) 를 처음 보는 사람처럼 읽으세요. 한 페이지 남짓한 짧은 룰북입니다.
**"이대로 게임을 진행할 수 있는가"만** 보고 안 되는 자리를 메모하면 됩니다.

힌트를 하나 드리면, 「라운드 진행」의 첫 문장이 `1번 플레이어부터 시계 방향으로` 입니다.

### 6-2. 크리틱에게 물어보기

Cursor에서 크리틱을 부르세요.

```
/bgs-review
```

룰 구멍만 보려면 `bgs-rules-critic` 을 직접 부르면 됩니다. **이 에이전트에게는 설계 의도를
주지 않습니다.** 맥락을 모르고 읽어야 처음 읽는 사람과 같은 자리에서 막힙니다.

돌려보면 **19건** 정도가 나옵니다. 진행 불가 5건, 해석 갈림 6건, 용어 불일치 3건, 사소함
5건이었습니다. 직접 만든 목록과 비교해보세요.

### 6-3. 플레이한 결과와 비교하기

`sim run` 은 OpenAI 키가 필요하지만, **이미 돌려둔 리포트가 저장소에 들어 있습니다.**
30판에 0.34달러, 4분 걸린 결과입니다.

[`playtest/sim-2026-08-02.md`](playtest/sim-2026-08-02.md) 를 열어 「룰북에서 헷갈린 대목」
절을 보세요.

| 룰북의 구멍 | 크리틱의 심각도 | 플레이 중 걸린 횟수 |
| --- | --- | --- |
| 낸 카드를 어디에 두는가 | 해석 갈림 | **89** |
| 카드에 무슨 값이 적혀 있는가 | 진행 불가 | 30 |
| 시작 플레이어를 어떻게 정하는가 | 진행 불가 | 22 |
| 덱이 모자랄 때 보충 순서 | 진행 불가 | 20 |
| 타일과 보드의 용도 | 진행 불가 | 12 |
| 전원 채집력이 0인 라운드 | 해석 갈림 | **0** |

**순위가 뒤집힙니다.** 크리틱이 "해석이 갈리는 정도"로 본 카드 행선지가 실제로는 압도적
1위였습니다. 매 턴 걸리는 문제라서요. 반대로 크리틱이 잡아낸 "전원 채집력 0"은 30판 동안
한 번도 언급되지 않았습니다. 드문 상황이고, 플레이어는 막히면 그냥 그럴듯하게 정하고
넘어가기 때문입니다.

크리틱은 빈도와 무관하게 빠짐없이 찾고, 플레이테스터는 실제로 아픈 순서를 알려줍니다.
**목록은 크리틱으로 만들고 순서는 플레이테스터로 정합니다.** 한쪽만 쓰면 빠뜨린 것과 급한
것 중 하나를 놓칩니다.

> `sim report` 를 직접 돌려보려 해도 로그가 없습니다. `sim/logs/` 는 gitignore라
> 저장소에 들어 있지 않습니다. 키가 있으면 `sim run` 으로 만들면 됩니다.

---

## 7단계. 한 군데만 고치고 버전을 올린다

구멍이 여섯 개 넘게 나왔습니다. **여기서 전부 고치면 안 됩니다.**

가장 아픈 것 하나만 고르세요. 89회 걸린 "낸 카드를 어디에 두는가"입니다.
[`ruleset.md`](ruleset.md) 의 「카드 내기」에 한 줄 추가하면 됩니다.

```markdown
낸 카드는 자기 앞에 앞면이 보이도록 쌓아둔다. 게임이 끝날 때까지 그대로 둔다.
```

그리고 버전을 올리세요. 상단의 `버전 0.1` 을 `0.2` 로 바꾸고, 하단 변경 이력에 이 형식으로
한 줄 남기면 됩니다.

```markdown
### 0.2 — 2026-08-02
- 낸 카드의 행선지를 명시 / 왜: 플레이 중 89회 걸린 1순위 / 확인: 같은 지적이 사라지는가
```

**`무엇을 / 왜 / 무엇을 확인하려고` 셋을 다 적으세요.** 하나라도 빠지면 세 번째 개정쯤에
"왜 이렇게 됐는지" 아무도 모르는 룰셋이 됩니다.

한 번에 열 군데를 고치면 다음 판에서 **무엇이 효과가 있었는지 알 수 없습니다.** 이건
신중함이 아니라 인과를 지키는 문제입니다.

고쳤으면 남에게 읽힐 형태로 뽑습니다.

```bash
node tools/rulebook.mjs example-tidepool --check
node tools/rulebook.mjs example-tidepool --toc
```

```json
{ "pages": 3, "toc": { "pages": 1 }, "version": "버전 0.2 · 2026-08-02", "warnings": [] }
```

**꼬리말에 방금 올린 버전이 박힙니다.** 여러 번 뽑아놓고 어느 종이가 최신인지 헷갈리는
일이 실제로 생기고, 플레이테스트 기록의 「룰셋 v0.2」와 손에 든 종이를 잇는 게 그
한 줄입니다.

`--check` 는 PDF를 만들지 않고 페이지 수와 절 목록만 냅니다. 표의 열이 좁아지거나 코드
블록이 폭을 넘으면 여기서 경고와 함께 종료 코드 1이 나옵니다. 인쇄한 뒤에 알면 다시
뽑아야 합니다.

되돌리세요.

```bash
git checkout -- projects/example-tidepool
```

---

## 여기까지 하면

도구가 사실을 내고 에이전트가 해석하는 구조가 보일 겁니다. `spec` 은 203dpi라고만 말하고
"그러니 잔글씨를 빼라"고는 하지 않습니다. `balance` 는 잔차가 +5.73이라고만 말하고 `TP05` 를
고치라고 하지 않습니다. **에이전트가 제안하고 고르는 건 직접 합니다.**

### 더 볼 것

아트를 뽑기 전에 비용이 얼마인지는 키 없이도 나옵니다.

```bash
node tools/art.mjs estimate example-tidepool
```

이 예제는 아트가 필요한 컴포넌트가 14개입니다. `low` 품질로 0.35달러, 2.8분이 걸립니다.
`quality` 를 `high` 로 올리면 33배 차이가 난다는 경고도 함께 나옵니다.

키가 있으면 남은 둘을 볼 수 있습니다.

```bash
node tools/sim.mjs run example-tidepool --games 10    # OpenAI 키 · 몇 분
node tools/bgg/cli.mjs similar "worker placement"     # BGG 토큰 · 인덱스 필요
```

`sim run` 은 룰북을 프롬프트에 넣고 LLM이 수를 정하게 합니다. **룰북이 이해되지 않으면
플레이 자체가 안 되니, "룰북만 읽고 이해되는가"를 따로 검사할 필요가 없습니다.** 이 예제로
돌리면 위의 89회짜리 지적이 그대로 재현됩니다.

자기 게임은 `/bgs-concept` 부터 시작하세요. 예제는 지우지 말고 두는 편이 좋습니다. 도구
출력이 이상해 보일 때 정상 출력과 맞춰볼 기준이 됩니다.

---

# Tutorial: a full pass with the example project

This document is meant to be **read while typing the commands**. The example project
`example-tidepool` has problems planted in it on purpose to show what each tool catches,
and reading a list of them is not the same as running into them yourself.

**The only prerequisite is `npm install`, and all seven steps run without an API key.**
Only the closing *Going further* section needs one. The whole thing takes about 20 minutes.

Here is what the example contains: **one badly costed card, a board that does not fit on
A4, an aspect ratio the image model refuses, and a rulebook with missing answers.** Once
you have seen which tool catches which, you can recognise the same signals in your own game.

Feel free to break things. `example-*` is tracked by git, so you can always revert.

```bash
git checkout -- projects/example-tidepool
```

---

## Step 0. Check your environment

```bash
npm run doctor
```

This reports what is ready and what is missing. For this tutorial **only the Node.js row
needs to be green** — you can finish it with the BGG token and OpenAI key left empty.

On Windows, if the "this shell" row shows a warning, read
[the PowerShell section in the README](../../README.md#on-windows-install-powershell-7-first)
first. Otherwise you will hit encoding errors that are hard to trace.

---

## Step 1. What the spec resolver catches

**The point: you never write pixel dimensions by hand.** You declare millimetres, and the
tool derives pixels within the image model's constraints and reports the effective DPI.

Start by checking the spec itself.

```bash
node tools/spec.mjs validate example-tidepool
```

```json
{ "ok": true, "problems": [], "componentCounts": { "action-card": 28 } }
```

Only `action-card` appearing in `componentCounts` is correct — **counts are cross-checked
only for components that have CSV data.** The other four only declare sizes in `spec.json`.

Now derive the pixels.

```bash
node tools/spec.mjs resolve example-tidepool
```

The output is long, but there are **four places worth looking at**.

| Component | Declared | Derived | What it teaches |
| --- | --- | --- | --- |
| `action-card` | 63.5×88mm | 752×1040px · 301dpi | A normal card. Your baseline |
| `resource-token` | 20×20mm | 832×832px · **1057dpi** | Too small, so it was **scaled up**. Shrunk at print time |
| `main-board` | 420×297mm | 3360×2368px · **203dpi** | Too large, so it was **scaled down**, with a warning |
| `marker-strip` | 100×25mm | **none** | Cannot be generated at all |

Read the board's warning as written: *"203 effective dpi is the ceiling. Do not put thin
lines or fine print on this."*

**Knowing that before you print rather than after is the whole reason this tool exists.**

`marker-strip` stops outright:

```json
{
  "ok": false,
  "reason": "the long-to-short side ratio is 4.00:1; image models accept up to 3:1",
  "options": ["generate within 3:1 and crop", "split the component in two",
              "give up art for this one and use shapes and text (art: null)"]
}
```

**Offering options and stopping is the important part here.** If the tool silently cropped
to 3:1, you would never learn that your component changed.

### Try it yourself

In `spec.json`, change `marker-strip` from `[100, 25]` to `[90, 30]` — exactly 3:1.
Re-run `resolve` and it becomes `ok: true` at `1424×480px · 402dpi`. Then revert:

```bash
git checkout -- projects/example-tidepool/spec.json
```

---

## Step 2. How many A4 sheets

```bash
node tools/spec.mjs sheet example-tidepool
```

```json
{ "printableArea": { "width_mm": 192, "height_mm": 279, "margin_mm": 9 }, "totalSheets": 12 }
```

`action-card` gets **9 per sheet in a 3×3 grid**; `resource-token` gets 117 in a 9×13.
The board is different:

```json
{ "fitsOnSheet": false,
  "tiled": { "orientation": "landscape", "grid": "2x2", "sheetsPerCopy": 4,
             "alternative": "6 sheets in portrait" } }
```

**When something does not fit, it is tiled — and both orientations are computed so the
cheaper one wins.** Landscape takes 4 sheets, portrait 6, so landscape was chosen.

### Try it yourself: half a millimetre costs a column

The README claims the 9mm margin is not arbitrary. Verify it. Change `print.margin_mm` in
`spec.json` from `9` to `10`, then re-run `sheet`:

```json
{ "perSheet": 8, "grid": "2x4", "rotated": true }
```

A poker card is really 63.5mm, so three columns need **190.5mm**. A 9mm margin leaves
192mm of printable width, which fits; a 10mm margin leaves **190mm**, half a millimetre
short. With the third column gone, the tool rotated the card to salvage 8 in a 2×4.
**Nine per sheet becomes eight.**

With only 28 cards the total stays at 12 sheets. But a 60-card deck goes from 7 sheets to
8 — one millimetre of margin costs a sheet of paper. Revert:

```bash
git checkout -- projects/example-tidepool/spec.json
```

---

## Step 3. What the numbers catch

```bash
node tools/balance.mjs example-tidepool --cost cost --value power
```

Read the caveat at the top first: *"These numbers do not decide balance. They support
design intuition; the real evidence comes from playtesting."*

**One card in this example is deliberately wrong.** `TP05` costs 3 and has power 12 —
stronger than the 5-cost cards (10 and 11). How it gets caught is the interesting part.

Look at the `power` column distribution first:

```json
"power": { "min": 1, "max": 12, "mean": 6.0833, "outliers": { "high": [], "low": [] } }
```

**No outliers at all.** By the interquartile rule the upper bound is 15.625, so 12 does not
stand out. There is nothing wrong with the value 12 — what is wrong is **12 at a cost of 3**.

So look at the regression:

```json
{ "formula": "power ≈ 2.2032 × cost + -0.3426", "r2": 0.7205,
  "outliers": [
    { "label": "TP05", "cost": 3, "power": 12, "expected": 6.2669, "residual": 5.7331 },
    { "label": "TP07", "cost": 4, "power": 7,  "expected": 8.4701, "residual": -1.4701 } ] }
```

`TP05` has a residual of **+5.73** while the runner-up is -1.47. It is **in a different
league.** The lesson: **single-column outlier detection cannot catch a cost-efficiency
problem.** Card balance is almost always about the combination, which is why this tool
reports regression residuals too.

The correlations are worth a look as well — `cost` to `qty` is **-0.94**, meaning expensive
cards are rarer. If that is intentional, fine. If it is not, you have a rule you wrote
without noticing.

Note that `TP05`'s text reads *"double your gathering power; lose all resources at the end
of the tide."* **A numbers-only tool knows nothing about that penalty.** So a large residual
does not mean "wrong" — it means "a human should look here." `bgs-balance-designer` and you
make the call.

---

## Step 4. Does the text fit on the card

```bash
node tools/pnp.mjs example-tidepool --check
```

```json
{ "overflowing": 0, "note": "everything fits",
  "components": [ { "component": "action-card", "fontSizes": { "title": 13, "body": 9.5 } } ] }
```

Font sizes are derived from component size: a 63.5mm card gets 9.5pt body text, a 50mm tile
drops to 7.5pt.

### Try it yourself: make it overflow

In `components/action-card.csv`, pad the `text` field of row `TP01` — repeating the same
sentence about six times is enough. Re-run the check:

```json
{ "overflowing": 1,
  "overflow": [ { "id": "TP01", "neededMm": 69.8, "availableMm": 67.4 } ] }
```

**It reports required and available height in millimetres and exits with code 1**, which is
what CI uses to block. You also learn that an 88mm card has 67.4mm of usable body height.

Revert and render the real PDF:

```bash
git checkout -- projects/example-tidepool/components/action-card.csv
node tools/pnp.mjs example-tidepool
```

Open `pnp/example-tidepool-YYYY-MM-DD.pdf` and look at the cut lines and the 3×3 layout.
There is no art, just shapes and text — and **that is the point: you can print and play
without art.** Illustration goes on last, and the prototype reaches the table without it.

---

## Step 5. Is the engine sound

```bash
node tools/sim.mjs smoke example-tidepool
```

This takes about 30 seconds and runs **20,000 games per player count, 60,000 in total**,
with random bots.

```json
{ "ok": true, "elapsedSec": 33.3, "problems": [],
  "byPlayers": { "2": { "finished": 20000, "unfinished": 0,
    "seatWinRate": [0.5, 0.5], "turns": { "min": 16, "median": 16, "max": 16 } } },
  "note": "the engine is sound; go ahead and run" }
```

**This is an engine check, not a balance check:** does it deadlock, does it terminate, does
it throw. If random bots finished 60,000 games, the rules have no structural hole in their
flow.

`turns` being 16 for min, median, and max stands out — this game is a fixed 8 rounds, so a
2-player game is always 16 turns. **If that spread is wide in your game**, some games run
long and some short, which means playtime is unpredictable.

Now look at `moveUsage`, which is not the point of a smoke test but is hard to miss:

```json
[ { "move": "rest", "count": 153244 }, { "move": "TP10", "count": 30152 } ]
```

**`rest` dominates by more than 5x.** A random bot picks any legal move, and when resources
run out the only legal move left is `rest`. So **a tight resource economy is already
visible here** — and sure enough, the playtest report in step 6 says "repeatedly resting
when short on resources feels monotonous."

### Play it yourself

```bash
node tools/sim.mjs serve example-tidepool
```

A browser opens and you can play. **This sets up the next step.** As you play a round, note
every moment you think "wait, the rulebook doesn't say."

---

## Step 6. Find the rulebook's gaps yourself

This step is the heart of the example. **Do it yourself before looking at the answers** —
reversing the order removes the lesson.

### 6-1. Read it cold (5 minutes)

Read [`ruleset.md`](ruleset.md) as a first-time reader. It is a short rulebook. Ask only
**"can I actually run a game from this?"** and note where you cannot.

One hint: the first sentence of *Round flow* says `starting with player 1, clockwise`.

### 6-2. Ask the critic

In Cursor, run `/bgs-review`, or invoke `bgs-rules-critic` directly for rule gaps only.
**By rule this agent is never given the design intent** — reading without context is its
entire job.

It finds about **19 issues**: 5 blocking, 6 ambiguous, 3 terminology, 5 minor. Compare
against your own list.

### 6-3. Compare against actual play

`sim run` needs an OpenAI key, but **a report from a previous run ships with the repo** —
30 games, 4 minutes, $0.34. Open
[`playtest/sim-2026-08-02.md`](playtest/sim-2026-08-02.md) and read the *confusing points*
section.

| Gap in the rulebook | Critic severity | Times hit in play |
| --- | --- | --- |
| Where does a played card go | ambiguous | **89** |
| What values are printed on a card | blocking | 30 |
| How is the starting player decided | blocking | 22 |
| Refill order when the deck runs low | blocking | 20 |
| What the tiles and board are for | blocking | 12 |
| A round where everyone has zero power | ambiguous | **0** |

**The ranking inverts.** What the critic rated merely "ambiguous" was by far the most
frequent problem in play, because it comes up every single turn. Conversely the edge case
the critic caught never came up once in 30 games — it is rare, and players who get stuck
just decide something plausible and move on.

**This is the conclusion the example exists to deliver.** The critic finds everything
regardless of frequency; the playtester tells you what actually hurts. **Build the list
with the critic, order it with the playtester.** Use only one and you lose half the picture.

> Running `sim report` yourself will fail: there is no log. `sim/logs/` is gitignored and
> not shipped. With a key, `sim run` creates one.

---

## Step 7. Fix one thing and bump the version

You now have six or more gaps. **Not fixing them all is the principle here.**

Pick the one that hurts most — the played-card destination, hit 89 times. Add one line to
*Playing a card* in [`ruleset.md`](ruleset.md), then bump `version 0.1` to `0.2` at the top
and add one line to the change log at the bottom in this shape:

```markdown
### 0.2 — 2026-08-02
- Specified where played cards go / why: top hit in play, 89 times / check: does the same complaint disappear
```

**All three fields are required: what, why, and what you are checking.** Without them, by
the third revision nobody knows why the ruleset looks the way it does.

Change ten things at once and you cannot tell **which one helped** in the next session.
That is not caution; it is preserving causality.

With that fixed, produce something someone else can read:

```bash
node tools/rulebook.mjs example-tidepool --check
node tools/rulebook.mjs example-tidepool --toc
```

```json
{ "pages": 3, "toc": { "pages": 1 }, "version": "버전 0.2 · 2026-08-02", "warnings": [] }
```

**The version you just bumped is stamped into the footer.** Print a rulebook a few times
and you will lose track of which sheet is current; that one line is what connects
"ruleset v0.2" in a playtest record to the paper in your hand.

`--check` renders nothing and reports the page count and section list. If a table column
gets too narrow or a code block runs past the text width, it warns and exits 1. Finding
that out after printing means printing again.

Then revert:

```bash
git checkout -- projects/example-tidepool
```

---

## Having finished

The structure should be visible now: **tools report facts, agents interpret them.** `spec`
says 203dpi and never tells you to drop the fine print. `balance` says the residual is
+5.73 and never tells you to nerf `TP05`. **Agents propose; you decide.**

### Going further

Estimating art cost needs no key:

```bash
node tools/art.mjs estimate example-tidepool
```

This example has 14 components needing art: $0.35 and 2.8 minutes at `low` quality. The
output also notes that going from `low` to `high` is a 33x difference.

With keys, you can see the remaining two:

```bash
node tools/sim.mjs run example-tidepool --games 10    # OpenAI key, a few minutes
node tools/bgg/cli.mjs similar "worker placement"     # BGG token, needs the index
```

`sim run` puts the rulebook in the prompt and lets an LLM decide moves. **If the rulebook
is not understandable, play does not happen — so "is the rulebook understandable?" gets
tested automatically.** Run it on this example and the 89-hit complaint above reproduces.

To start your own game, begin with `/bgs-concept`. Keep the example around: when a tool's
output looks strange, it gives you a known-good baseline to compare against.
