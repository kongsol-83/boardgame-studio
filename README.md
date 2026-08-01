# 보드게임 스튜디오

Cursor를 보드게임 제작 스튜디오로 만드는 프로젝트입니다. 아이디어 한 줄을 던지면 BGG에서
유사작을 찾고, 메커니즘을 제안하고, 룰셋을 쓰고, 컴포넌트 규격을 잡고, 자동 플레이로 검증하고,
A4 프린트 앤 플레이 PDF까지 뽑는 것을 목표로 합니다.

> *Documentation is Korean-first. [English version below](#boardgame-studio-english).*

## 무엇을 위한 물건인가

보드게임 제작은 하나의 작업이 아닙니다. 레퍼런스 조사, 시스템 설계, 룰 작성, 컴포넌트 사양,
밸런스 검토, 아트 디렉션이 전부 다른 종류의 판단을 요구합니다. 이 저장소는 Cursor 세션에
그 구조를 입힙니다. 파이프라인을 도는 스킬들과, 각 판단을 하나씩 맡는 서브에이전트들입니다.

목표 산출물은 **공모전 제출 수준의 프로토타입**입니다. 남이 읽고 이해되는 룰북, A4에 뽑아서
가위로 자를 수 있는 컴포넌트, 그리고 플레이테스터를 한 테이블 모아놓고 명백한 결함으로
그 자리를 날리지 않을 정도의 검증입니다.

디지털 보드게임 엔진이 아니고, 그걸 목표로 하지도 않습니다.

## 파이프라인

```
/bgs-concept      아이디어 한 줄  ->  핵심 동사, 인원, 플레이타임, 무게
/bgs-reference    BGG 유사작 조사와 메커니즘 후보 제안
/bgs-ruleset      룰북 형태로 쓰는 룰셋. 모든 수치는 표 하나에
/bgs-review       크리틱 3명 병렬 검토 — 메커니즘, 밸런스, 룰
/bgs-components   mm 단위 컴포넌트 규격과 종류별 CSV 데이터
/bgs-sim          규칙 엔진 구현과 LLM 자동 플레이로 명백한 사고 거르기
/bgs-art          아트 바이블, 스타일 앵커, 배치 일러스트 생성
/bgs-pnp          재단선 포함 A4 프린트 앤 플레이 PDF
```

한 번에 끝나지 않는 걸 전제로 합니다. 검토 결과는 룰셋으로 돌아가고, 시뮬레이션 결과는 검토로
돌아갑니다. 룰셋에는 버전을 붙여서 어느 변경이 효과가 있었는지 추적할 수 있게 합니다.

## 설계에서 정한 것들

만들면서 내린 판단 중 나중에 헷갈릴 만한 것들을 적어둡니다.

**규격은 코드에 박지 않습니다.** 게임마다 카드 크기가 다르고, 한 게임 안에서도 카드와 타일과
토큰과 보드가 전부 다릅니다. `spec.json` 에 mm로 선언하면 픽셀 크기는 자동으로 산출됩니다.
20x20mm 토큰처럼 작은 건 이미지 모델의 최소 해상도를 넘기려고 키운 뒤 인쇄 시점에 줄이고,
420x297mm 보드처럼 큰 건 줄이면서 **유효 DPI를 보고**합니다. 보드가 203dpi가 한계라는 걸
모르고 잔글씨를 넣으면 인쇄하고 나서 알게 됩니다.

**출력은 A4 고정, 여백 9mm입니다.** 이 값에는 근거가 있습니다. 포커 카드의 실제 규격은
63.5mm라서 3열이면 190.5mm인데, 여백을 10mm로 두면 인쇄 영역이 190mm라 **0.5mm가 모자라
3열이 무너집니다.** 장당 9장이 8장이 되는데 가장 흔한 규격에서 한 장을 잃는 셈입니다.
8mm까지 내리면 몇몇 규격에서 조금 더 얻지만 프린터 인쇄 가능 영역의 여유가 얇아집니다.
9mm가 3x3을 지키면서 여유도 남는 지점입니다.

**시뮬레이션의 목적은 밸런싱이 아닙니다.** 보드게임 밸런스는 소수점을 다투는 영역이 아니고,
그 정밀도는 시뮬로 얻을 것도 아닙니다. 시뮬은 **테이블에 들고 가기 전에 명백한 사고를 거르는
필터**입니다. 게임이 끝나기는 하는가, 시간이 맞는가, 3라운드 만에 필승법이 드러나지는 않는가.
기본 30판이면 충분하고, 그 이상은 오버피팅입니다.

**플레이어는 LLM입니다.** 보드게임은 턴제라 실시간 제약이 없고, 게임마다 휴리스틱 봇을 짜는 건
진짜 비용인 데다 나쁜 봇은 잘못된 결론을 줍니다. 게다가 LLM은 학습 데이터에 없는 새 게임을
룰북만 보고 플레이하므로 **"룰북만 읽고 이해되는가"가 자동으로 테스트됩니다.** 30판 승률보다
이쪽이 값집니다. 랜덤 봇은 남겨두지만 밸런스용이 아니라 엔진이 교착에 빠지지 않는지 보는
스모크 테스트용입니다.

**에이전트는 사용자 결정을 대신하지 않습니다.** 게임 디자인은 취향이 개입하는 영역입니다.
"이 메커니즘이 낫다"의 상당 부분은 만드는 사람이 무엇을 재미있다고 느끼는지에 달려 있고,
그건 에이전트가 알 수 없습니다. 모든 에이전트는 먼저 묻고, 선택지를 장단점과 함께 제시하고,
사용자가 고른 뒤에 움직입니다.

## 준비물

- **Node.js 24 이상** — `node:sqlite`, `fetch`, `node:test` 를 내장으로 쓰기 때문에 네이티브
  빌드가 없습니다. 런타임 의존성은 두 개뿐입니다.
- **Cursor** — 스킬과 서브에이전트가 `.cursor/` 아래에 있습니다.
- **BGG 액세스 토큰** *(선택)* — 레퍼런스 조사에만 필요합니다.
  [boardgamegeek.com/applications](https://boardgamegeek.com/applications) 에서 발급받습니다.
- **OpenAI API 키** *(선택)* — 플레이 시뮬레이션과 아트 생성에만 필요합니다.

## 시작하기

```bash
git clone https://github.com/kongsol-83/boardgame-studio.git
cd boardgame-studio
npm install
cp .env.example .env      # 가지고 있는 키만 채우면 됩니다
npm run doctor            # 무엇이 준비됐고 무엇이 빠졌는지 확인
```

Cursor에서 폴더를 열고 `/bgs` 를 입력하면 사용 가능한 스킬이 뜹니다.

### Windows라면 PowerShell 7을 먼저 설치하세요

**이건 취향 문제가 아닙니다.** Windows에 기본 탑재된 PowerShell 5.1은 UTF-8을 제대로
다루지 못해서, 이 저장소에서 작업하면 원인을 찾기 어려운 오류를 만나게 됩니다.

같은 UTF-8 스크립트를 두 셸에서 돌려본 결과입니다.

```
                        PowerShell 5.1        PowerShell 7
콘솔 출력 인코딩        ks_c_5601-1987        utf-8
> 리다이렉션            UTF-16LE              UTF-8
Set-Content -Encoding UTF8   BOM 붙음         BOM 없음
BOM 없는 UTF-8 스크립트 읽기  실패             정상
```

마지막 항목이 특히 문제입니다. 5.1은 BOM 없는 UTF-8 파일을 cp949로 읽어서 한글이 전부
깨지고 파서가 죽습니다. 반대로 5.1이 만든 BOM 붙은 `.mjs` 는 shebang이 깨져서
`SyntaxError: Invalid or unexpected token` 이 나는데, 파일을 봐서는 멀쩡해 보이기 때문에
원인을 찾는 데 시간이 걸립니다.

```powershell
winget install --id Microsoft.PowerShell --source winget
```

설치 후 에디터의 터미널 기본 프로필을 `pwsh` 로 바꿉니다. `npm run doctor` 가 확인해줍니다.

AI 에이전트로 작업한다면 [.cursor/rules/shell.mdc](.cursor/rules/shell.mdc) 를 함께 보세요.
PowerShell 7으로도 안 고쳐지는 것들(인라인 스크립트 파싱, stderr가 빨간 에러로 보이는 것,
유닉스 명령 부재)을 규칙으로 막아둡니다. 전부 실제로 시간을 날린 사례에서 나왔습니다.

### 설정

**조정할 값은 전부 `studio.config.json` 에 있습니다. `.env` 에는 키만 둡니다.**
설정 파일은 주석을 쓸 수 있어서(JSONC), 각 값이 왜 그런지가 값 옆에 적혀 있습니다.

```jsonc
{
  "language": "ko",              // 생성되는 설계 문서의 언어
  "models": {
    "sim": "gpt-5.6-luna",       // 시뮬레이션에서 수를 두는 플레이어
    "review": "gpt-5.6-terra",   // 리포트를 쓸 때 피드백을 묶는 모델
    "image": "gpt-image-2"       // 아트 생성
  },
  "print": { "sheet": "A4", "margin_mm": 9, "dpi": 300 },
  "sim":   { "maxCompletionTokens": null, "games": 30, "concurrency": 20 },
  "art":   { "quality": "low", "imagesPerMinute": 5 },
  "bgg":   { "ranksMaxAgeDays": 90, "hydrateTop": 20000 }
}
```

이 저장소는 한국어로 만들어졌지만 쓰는 분의 나라는 다를 수 있습니다. `language` 는
생성되는 설계 문서(컨셉, 룰셋, 검토 리포트 등)에 적용되고, 저장소 자체의 문서는
이 설정과 무관하게 한국어를 유지합니다. `ko`, `en`, `ja`, `zh-CN`, `de`, `fr`, `es` 를
알며 다른 값도 막지 않고 경고만 합니다.

```bash
node tools/config.mjs      # 지금 설정 확인
```

### 키 없이 되는 것

파이프라인의 상당 부분은 오프라인으로 돌아갑니다. 클론하고 `npm install` 만 하면
[예제 프로젝트](projects/example-tidepool/)로 아래가 바로 동작합니다.

```bash
node tools/spec.mjs resolve example-tidepool    # mm -> 픽셀, 유효 DPI
node tools/spec.mjs sheet example-tidepool      # A4 몇 장이 필요한가
node tools/balance.mjs example-tidepool --cost cost --value power
node tools/pnp.mjs example-tidepool             # PDF 렌더
node tools/sim.mjs smoke example-tidepool       # 랜덤 봇 엔진 검사
node tools/sim.mjs serve example-tidepool       # 브라우저에서 직접 플레이
```

예제에는 도구가 무엇을 잡아내는지 보여주려고 **일부러 심어둔 것들**이 있습니다.
코스트 대비 튀는 카드, A4를 넘는 보드, 이미지 모델이 생성 못 하는 4:1 비율 컴포넌트,
너무 작아서 키워야 하는 토큰, 그리고 답이 빠진 룰북. 자세한 건
[예제 README](projects/example-tidepool/README.md)에 있습니다.

키가 필요한 건 셋뿐입니다. BGG 조사(BGG 토큰), LLM 플레이테스트와 아트 생성(OpenAI 키).

### BGG 인덱스 구축

레퍼런스 조사를 쓰려면 로컬 인덱스가 필요합니다. 두 경로가 있습니다.

빠른 길은 브라우저로 [BGG 랭킹 덤프](https://boardgamegeek.com/data_dumps/bg_ranks)를 받아
`data/ranks/` 에 그대로 넣는 것입니다. 파일명의 날짜가 곧 버전이라 이름은 건드리지 않습니다.

```bash
node tools/bgg/cli.mjs seed          # data/ranks/ 에서 최신 덤프 자동 선택
node tools/bgg/cli.mjs hydrate       # 상위 20000개 상세 조회, 약 17분
```

덤프를 받기 귀찮으면 `seed --crawl` 로 갑니다. 로그인이 전혀 필요 없는 대신 첫 수집이
6시간 걸립니다. `--resume` 이 있으니 백그라운드로 돌려두면 됩니다.

덤프가 90일보다 오래되면 조사할 때 알림이 뜨고 다운로드 페이지가 열립니다.

## 저장소 구조

```
.cursor/agents/
  directors/        방향을 정한다 — 크리에이티브 디렉터, 아트 디렉터
  leads/            실행을 관리한다 — 아트 리드, 컴포넌트 매니저
  specialists/      하나를 깊게 본다 — 조사, 크리틱 3명, 플레이테스터,
                    시뮬레이션 엔지니어, 일러스트레이터 2명, 그래픽 디자이너
.cursor/skills/     /bgs-* 워크플로우 스킬
tools/              Node CLI — bgg, spec, balance, sim, art, pnp
presets/            표준 컴포넌트 규격 모음
projects/           작업 중인 게임들. example-* 외에는 gitignore
data/               로컬 BGG 인덱스와 랭킹 덤프. gitignore
```

에이전트 폴더는 사람이 보기 위한 구분입니다. Cursor는 파일명으로 식별하고 경로는 무시하므로
`/bgs-*` 로 부를 때는 폴더가 보이지 않습니다.

## 커밋하면 안 되는 것

되돌릴 수 없는 두 가지입니다. CI가 막지만 알고는 계셔야 합니다.

**본인 게임 프로젝트.** 공모전 출품작이 공개 저장소에 올라가면 출품 자격까지 걸릴 수 있습니다.
`projects/` 는 통째로 gitignore이고 `projects/example-*/` 만 추적됩니다.

**BGG 데이터.** XML API 이용약관상 받아온 데이터를 재배포할 수 없습니다. `data/` 도 통째로
제외되며, 토큰은 각자 발급받아 씁니다.

## 상태

초기 개발 중입니다. 무엇이 들어왔는지는 [CHANGELOG.md](CHANGELOG.md) 를 보세요.

## 기여

환영합니다. 이 프로젝트는 코드보다 프롬프트와 지식 기여가 더 중요할 수 있습니다.
[CONTRIBUTING.md](CONTRIBUTING.md) 를 봐주세요.

## 라이선스

[Apache-2.0](LICENSE). 저작자 표기와 BGG 데이터 조건은 [NOTICE](NOTICE) 에 있습니다.

보드게임 데이터는 [BoardGameGeek](https://boardgamegeek.com) 의 BGG XML API2에서 가져옵니다.
BGG 데이터를 이 저장소에 담아 배포하지 않으며, 사용자가 자기 토큰을 발급받아 씁니다.

---

# Boardgame Studio (English)

An AI board game design studio for [Cursor](https://cursor.com). Turn a one-line idea into
BGG reference research, mechanism proposals, a ruleset, LLM playtest simulation, and
print-and-play PDFs.

> This project is Korean-first. Skills, subagent prompts, and generated design documents
> are written in Korean by default. You can change the language of generated documents —
> see [Choosing the output language](#choosing-the-output-language) below.

## What it is

Board game design is not a single task. It is research, systems design, rules writing,
component specification, balance checking, and art direction — each needing a different
kind of judgement. This repository gives a Cursor session that structure: a set of skills
that run the pipeline, and subagents that each own one of those judgements.

The target output is a **contest-submission prototype**: a ruleset someone else can read,
components you can print on A4 and cut with scissors, and enough verification that you do
not waste a table full of playtesters on an obvious defect.

It is not a digital board game engine, and it is not trying to be one.

## Pipeline

```
/bgs-concept      one-line idea  ->  core verb, player count, playtime, weight
/bgs-reference    similar games from BoardGameGeek, mechanism candidates
/bgs-ruleset      a ruleset written as a rulebook, with all numbers in one table
/bgs-review       three critics in parallel: mechanism, balance, rules
/bgs-components   component spec in mm, per-component CSV data
/bgs-sim          rules engine + LLM self-play, to catch obvious defects early
/bgs-art          art bible, style anchors, batch illustration
/bgs-pnp          A4 print-and-play PDF with cut lines
```

Rounds are expected. Review feeds back into the ruleset, simulation feeds back into
review, and the ruleset carries a version number so you can tell which change helped.

## Decisions worth knowing

**Component sizes are never hardcoded.** Every game uses different card sizes, and a single
game mixes cards, tiles, tokens, and boards. You declare sizes in millimetres in
`spec.json` and pixel dimensions are derived. Small components like a 20x20mm token are
scaled *up* to clear the image model's minimum resolution and scaled back down at print
time; large ones like a 420x297mm board are scaled *down*, and the resolver **reports the
effective DPI** so you learn that the board tops out at 203dpi before you print fine text
on it, not after.

**Output is always A4 with 9mm margins.** That number is not arbitrary. A poker card is
actually 63.5mm wide, so three columns need 190.5mm — and a 10mm margin leaves only 190mm
of printable width. **Half a millimetre costs you an entire column**, dropping the most
common card size from 9 per sheet to 8. Going down to 8mm gains a little on a few sizes
but leaves less room for printer hardware margins. 9mm keeps the 3x3 layout with slack to
spare.

**Simulation is not for balancing.** Board game balance is not a decimal-point discipline,
and that precision is not something a simulation can give you anyway. Simulation is a
filter that catches obvious defects *before* you bring the game to a table: does it end,
does it fit the target playtime, is there a dominant line by round three. Thirty games is
enough; more is overfitting.

**The player is an LLM.** Board games are turn-based, so there is no realtime constraint,
and writing a heuristic bot per game is real work — with the added risk that a bad bot
produces confident but wrong conclusions. An LLM also plays a brand-new game by reading
the rulebook, which means **"is the rulebook understandable?" gets tested for free.** That
is worth more than a win-rate table from thirty games. A random bot is kept, but as an
engine smoke test for deadlocks, not for balance.

**Agents do not decide for you.** Game design involves taste. Much of "this mechanism is
better" depends on what *you* find fun, and an agent cannot know that. Every agent asks
first, presents options with trade-offs, and waits for you to choose.

## Requirements

- **Node.js 24+** — the tooling uses the built-in `node:sqlite`, `fetch`, and `node:test`,
  so there is no native build step. Only two runtime dependencies.
- **Cursor** — skills and subagents live under `.cursor/`.
- **A BoardGameGeek access token** *(optional)* — needed only for reference research.
  Register at [boardgamegeek.com/applications](https://boardgamegeek.com/applications).
- **An OpenAI API key** *(optional)* — needed only for playtest simulation and art
  generation.

## Quick start

```bash
git clone https://github.com/kongsol-83/boardgame-studio.git
cd boardgame-studio
npm install
cp .env.example .env      # then fill in the keys you have
npm run doctor            # reports what is ready and what is missing
```

Open the folder in Cursor and type `/bgs` to see the available skills.

### On Windows, install PowerShell 7 first

**This is not a preference.** The PowerShell 5.1 that ships with Windows does not handle
UTF-8 properly, and working in this repository with it produces errors that are hard to
trace back to their cause.

Here is the same UTF-8 script run under both shells:

```
                              PowerShell 5.1     PowerShell 7
console output encoding       ks_c_5601-1987     utf-8
> redirection                 UTF-16LE           UTF-8
Set-Content -Encoding UTF8    adds a BOM         no BOM
reading a BOM-less UTF-8 script   fails          works
```

That last row is the worst one. 5.1 reads BOM-less UTF-8 as the local ANSI codepage, which
mangles every non-ASCII character and kills the parser. In the other direction, a `.mjs`
file written by 5.1 carries a BOM that breaks the shebang and yields
`SyntaxError: Invalid or unexpected token` — and the file looks perfectly fine when you
open it, so the cause is not obvious.

```powershell
winget install --id Microsoft.PowerShell --source winget
```

Then switch your editor's default terminal profile to `pwsh`. `npm run doctor` verifies it.

If you work with an AI agent, also read [.cursor/rules/shell.mdc](.cursor/rules/shell.mdc).
It covers the problems PowerShell 7 does *not* fix — inline script parsing, native stderr
being rendered as a red error block, and missing Unix commands. Every rule in it came from
an actual incident.

### Configuration

**Everything tunable lives in `studio.config.json`. `.env` holds keys only.** The config
file accepts comments (JSONC), so the reasoning behind each value sits next to it.

```jsonc
{
  "language": "en",              // language of generated design documents
  "models": {
    "sim": "gpt-5.6-luna",       // plays moves during simulation
    "review": "gpt-5.6-terra",   // clusters feedback when writing the report
    "image": "gpt-image-2"       // art generation
  },
  "print": { "sheet": "A4", "margin_mm": 9, "dpi": 300 },
  "sim":   { "maxCompletionTokens": null, "games": 30, "concurrency": 20 },
  "art":   { "quality": "low", "imagesPerMinute": 5 },
  "bgg":   { "ranksMaxAgeDays": 90, "hydrateTop": 20000 }
}
```

This repository was built in Korean, but you may not be. `language` applies to generated
design documents; known values are `ko`, `en`, `ja`, `zh-CN`, `de`, `fr`, `es`, and
anything else is accepted with a warning rather than rejected. It does **not** change the
repository's own documentation — `README.md`, `CONTRIBUTING.md`, and the skill prompts stay
Korean-first.

```bash
node tools/config.mjs      # show the resolved config
```

### What works without any API key

Most of the pipeline runs offline. Clone, `npm install`, and these work immediately
against the [bundled example project](projects/example-tidepool/):

```bash
node tools/spec.mjs resolve example-tidepool    # mm -> pixels, effective DPI
node tools/spec.mjs sheet example-tidepool      # how many A4 sheets
node tools/balance.mjs example-tidepool --cost cost --value power
node tools/pnp.mjs example-tidepool             # render the PDF
node tools/sim.mjs smoke example-tidepool       # random-bot engine check
node tools/sim.mjs serve example-tidepool       # play it in a browser
```

The example deliberately contains problems so you can see what the tools catch: a card
that is overpowered for its cost, a board that does not fit on A4, a 4:1 component the
image model cannot generate, a token too small to meet the minimum resolution, and a
rulebook with gaps. See the [example README](projects/example-tidepool/README.md).

Only three things need a key: BGG research (BGG token), LLM playtesting, and art
generation (OpenAI key).

### Building the BGG index

Reference research needs a local index. There are two paths.

The fast one is to download the [BGG ranking dump](https://boardgamegeek.com/data_dumps/bg_ranks)
in a browser and drop it into `data/ranks/` unchanged — the date in the filename is the
version, so do not rename it.

```bash
node tools/bgg/cli.mjs seed          # picks the newest dump in data/ranks/
node tools/bgg/cli.mjs hydrate       # fetches details for the top 20000, ~17 minutes
```

If you would rather not deal with the download, `seed --crawl` needs no login at all, but
the first pass takes about six hours. It supports `--resume`, so run it in the background.

Once the dump is older than 90 days, research commands warn you and open the download page.

## Repository layout

```
.cursor/agents/
  directors/        set direction — creative director, art director
  leads/            manage execution — art lead, component manager
  specialists/      look at one thing deeply — research, three critics,
                    playtester, sim engineer, two illustrators, graphic designer
.cursor/skills/     the /bgs-* workflow skills
tools/              Node CLIs — bgg, spec, balance, sim, art, pnp
presets/            standard component sizes
projects/           your games. gitignored except example-*
data/               local BGG index and ranking dumps. gitignored
```

The agent folders are for humans reading the tree. Cursor identifies agents by filename and
ignores the path, so the tiers are invisible when you invoke `/bgs-*`.

## What must never be committed

Two things you cannot undo. CI blocks both, but it is worth knowing why.

**Your own game projects.** Publishing a contest entry can disqualify it. `projects/` is
gitignored entirely; only `projects/example-*/` is tracked.

**BoardGameGeek data.** The XML API Terms of Use do not allow redistributing fetched data.
`data/` is excluded entirely, and every user brings their own token.

## Status

Early development. See [CHANGELOG.md](CHANGELOG.md) for what has landed.

## Contributing

Contributions are welcome, and prompt and knowledge contributions matter here as much as
code. See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and pull requests in English are
fine.

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for attribution and the BoardGameGeek data
terms.

Board game data comes from [BoardGameGeek](https://boardgamegeek.com) via the BGG XML
API2. No BGG data is redistributed here; you bring your own token.
