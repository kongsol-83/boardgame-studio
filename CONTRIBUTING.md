# 기여 가이드

*[English version below](#contributing-english).*

먼저 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) 를 읽어주세요.

## 절대 커밋하면 안 되는 것

되돌릴 수 없는 두 가지입니다. CI가 막지만 로컬에서도 조심해주세요.

**BoardGameGeek 데이터.** XML API 이용약관상 받아온 데이터는 재배포할 수 없습니다.
`data/` 는 통째로 gitignore이며 SQLite 인덱스와 랭킹 덤프가 모두 여기 들어갑니다.
토큰은 각자 [boardgamegeek.com/applications](https://boardgamegeek.com/applications) 에서
발급받아 씁니다. **프로젝트 공용 토큰은 만들지 않습니다.**

**본인 게임 프로젝트.** 공모전 출품작이 공개 저장소에 올라가면 출품 자격까지 걸릴 수 있습니다.
`projects/` 는 통째로 gitignore이고 `projects/example-*/` 만 추적됩니다. 예제를 고칠 일이
아니라면 `projects/` 아래 파일을 커밋에 넣지 마세요.

## 서비스로 감싸지 마세요

BGG XML API 이용약관은 제3자 서비스가 다른 애플리케이션에 데이터를 중계하는 것을 금지합니다.
이 도구를 웹 서비스로 만들어 배포하면 여기에 걸립니다. **로컬에서 각자 자기 토큰으로 돌리는
도구**로 남는다는 전제 위에 설계돼 있으니, 이 전제를 깨는 방향의 PR은 받기 어렵습니다.

## 언어

**이 저장소의 문서와 프롬프트는 한국어가 기본입니다.** `README.md` 처럼 공개 저장소의
입구가 되는 문서는 한국어 본문 아래에 영어 버전을 함께 둡니다.

생성되는 설계 문서의 언어는 다릅니다. 그건 `studio.config.json` 의 `language` 로
사용자가 정하며, 쓰는 분의 나라가 다를 수 있으니 열어둔 것입니다. 스킬과 에이전트는
이 값을 읽어 그 언어로 문서를 씁니다.

영어 문서를 늘리는 기여는 환영하지만 **한국어 원본을 영어로 대체하는 방향은 받지 않습니다.**
나란히 두는 방향으로 부탁드립니다. Issue와 PR은 한국어와 영어 모두 괜찮습니다.

## 기여 유형

코드만 기여가 아닙니다. 오히려 아래쪽이 더 필요합니다.

### 컴포넌트 규격 프리셋

`presets/components.json` 에 표준 규격을 추가하는 기여입니다. 타로, 유로 미니, 브리지,
정사각 타일처럼 실제로 쓰이는 규격이면 무엇이든 좋습니다. 진입장벽이 가장 낮으면서 모두에게
바로 쓸모 있습니다. 출처(제작사 스펙 시트 등)를 같이 적어주세요.

### 스킬과 에이전트 프롬프트

`.cursor/skills/` 와 `.cursor/agents/` 의 프롬프트를 고치거나 새로 만드는 기여입니다.
"이 크리틱이 이런 걸 놓치더라" 같은 구체적인 사례와 함께 오면 가장 좋습니다.

작성 규칙이 몇 개 있습니다.

- 이름은 **`bgs-` 접두사**로 시작합니다. Cursor는 스킬과 서브에이전트를 모두 슬래시 메뉴에
  올리기 때문에 접두사가 없으면 기본 커맨드와 충돌합니다.
- 스킬의 `name` 은 **부모 폴더명과 정확히 같아야** 합니다. 다르면 Cursor가 조용히 로드하지
  않아서 왜 안 뜨는지 아무도 모르게 됩니다. `npm run validate` 가 이걸 검사합니다.
- 에이전트의 `name` 은 **파일명과 정확히 같아야** 합니다. 아래 티어 폴더명은 이름에 넣지
  않습니다.
- `description` 은 필수이며 1024자 이내입니다. 무엇을 하는지와 **언제 쓰는지**를 같이 씁니다.
- 룰 파일은 `.mdc` 확장자여야 합니다. `.cursor/rules/` 의 `.md` 는 무시됩니다.
- 에이전트가 사용자 결정을 대신하게 만들지 마세요. 먼저 묻고, 선택지를 제시하고,
  사용자가 고르는 흐름을 유지합니다.

에이전트는 `directors/`, `leads/`, `specialists/` 세 폴더로 나뉘어 있습니다. 새로 만들 때는
그 에이전트가 **방향을 정하는지, 실행을 관리하는지, 하나를 깊게 보는지**로 고르면 됩니다.

이름은 한국 게임 업계 직군명을 따릅니다. **`-designer` 는 기획 직군, `-artist` 는 아트
직군**입니다. 그림 그리는 역할에 `-designer` 를 붙이지 마세요. 업계에서 일러스트레이터는
홍보용 그림을 그리는 사람이라 이 저장소에서는 쓰지 않습니다.

#### 에이전트가 전부 안 보인다면

Cursor는 에이전트를 파일명으로 식별하고 경로는 무시합니다. 하위 폴더를 훑는 동작은 지금
정상 작동하지만, [Cursor 측은 이걸 고쳐야 할 버그로 보고 있습니다](https://forum.cursor.com/t/nested-markdown-files-inside-cursor-agents-are-incorrectly-detected-as-subagents/166296).
언젠가 로더가 바뀌면 **13개가 한꺼번에 슬래시 메뉴에서 사라질 수 있습니다.**

그렇게 되면 폴더를 없애고 평평하게 되돌리면 됩니다. 이름은 경로와 무관하므로 다른 파일은
하나도 고칠 필요가 없습니다.

```bash
git mv .cursor/agents/*/*.md .cursor/agents/
rmdir .cursor/agents/directors .cursor/agents/leads .cursor/agents/specialists
npm run validate
```

같은 이유로 **`.cursor/agents/` 안에 에이전트가 아닌 문서를 두지 마세요.** Cursor의 스캔은
`---` 한 쌍만 있으면 무엇이든 에이전트로 잡아서, README를 하나 넣으면 슬래시 메뉴에 유령
항목이 생깁니다. `npm run validate` 가 이것과 이름 충돌을 함께 검사합니다.

### BGG 메커니즘 한글 설명

`.cursor/skills/bgs-reference/references/bgg-mechanisms.md` 의 설명과 대표작을 보강하는
기여입니다. 실제로 그 메커니즘을 쓰는 게임을 해본 사람의 한 줄이 훨씬 정확합니다.

### 번역

산출 문서 언어를 늘리려면 `tools/lib/config.mjs` 의 `KNOWN_LANGUAGES` 에 코드를 추가하고,
스킬 프롬프트가 그 언어로 잘 쓰는지 확인해주세요.

### 실제 사용 사례

이걸로 만든 게임 이야기, 잘 안 된 지점, 워크플로우가 어디서 막혔는지. Issue나 Discussion으로
남겨주시면 가장 도움이 됩니다.

### 코드

`tools/` 아래 CLI들입니다. 아래 제약을 지켜주세요.

- **런타임 의존성을 늘리지 않습니다.** 현재 `fast-xml-parser` 와 `pdfkit` 둘뿐이고, 나머지는
  Node 24 내장(`node:sqlite`, `fetch`, `zlib`, `node:test`)으로 해결합니다. 네이티브 빌드가
  필요한 패키지는 받지 않습니다. 새 의존성이 꼭 필요하면 Issue에서 먼저 논의해주세요.
- **Windows 경로를 가정하지 않습니다.** 개발은 Windows에서 하지만 `node:path` 를 쓰고
  하드코딩된 구분자를 넣지 않습니다.
- **API 키가 필요한 코드는 CI에서 못 돕니다.** 순수 로직을 분리해서 테스트 가능하게 해주세요.
- **파일은 UTF-8 BOM 없이 저장합니다.** BOM이 붙으면 shebang이 깨지면서 원인을 알기 어려운
  문법 오류가 납니다. `npm run validate` 가 잡습니다.

## 개발 환경

```bash
git clone https://github.com/kongsol-83/boardgame-studio.git
cd boardgame-studio
npm install
cp .env.example .env
npm run doctor          # 무엇이 준비됐고 무엇이 빠졌는지 확인
```

Node.js 24 이상이 필요합니다. `node:sqlite` 를 쓰기 때문입니다.

### Windows에서 작업한다면

**PowerShell 7 이상을 쓰세요.** 기본 탑재된 5.1은 UTF-8을 제대로 다루지 못합니다.
BOM 없는 UTF-8 스크립트를 읽지 못하고, `>` 는 UTF-16으로 쓰고, `Set-Content -Encoding UTF8`
은 BOM을 붙입니다. BOM이 붙은 `.mjs` 는 shebang이 깨져서 원인을 찾기 어려운 문법 오류가
납니다. 실측 비교는 [README의 해당 절](README.md#windows라면-powershell-7을-먼저-설치하세요)에
있습니다.

**winget 말고 [MSI](https://github.com/PowerShell/PowerShell/releases)로 설치하세요.**
`winget install --id Microsoft.PowerShell` 은 MSIX(Store)만 제공하는데, 그러면 PATH에
0바이트 실행 별칭만 생겨서 **AI 에이전트가 pwsh를 인식하지 못하고 5.1로 떨어집니다.**
`win-x64.msi` 로 깔면 `C:\Program Files\PowerShell\7\pwsh.exe` 에 실체가 생깁니다.

설치 후 에디터의 터미널 기본 프로필을 `pwsh` 로 바꾸고 **Cursor를 완전히 종료했다 켭니다.**
Reload Window로는 환경변수가 갱신되지 않습니다. `npm run doctor` 가 설치 방식과 지금 이
셸이 무엇인지를 각각 확인해줍니다.

커밋 메시지처럼 **여러 줄이거나 따옴표가 들어간 텍스트는 `-m` 으로 넘기지 마세요.**
PowerShell이 exe에 인자를 넘길 때 따옴표에서 문자열을 쪼갭니다. 파일에 쓰고
`git commit -F <파일>` 로 넘기면 버전과 무관하게 안전합니다.

AI 에이전트로 작업한다면 `.cursor/rules/shell.mdc` 를 읽어보세요. 셸을 최소한으로 쓰고
파일은 편집 도구로 다루라는 규칙이 들어 있습니다. 이 규칙들은 전부 실제로 시간을 날린
사례에서 나왔습니다.

## PR 전에 돌릴 것

```bash
npm test        # 형식 검증 + 문법 검사 + 단위 테스트
```

CI도 같은 것을 ubuntu와 windows 두 러너에서 돌리고, 여기에 더해 커밋 금지 항목을 검사합니다.

## 커밋과 PR

커밋 메시지는 [Conventional Commits](https://www.conventionalcommits.org/) 를 따릅니다.

```
feat(skills): bgs-reference에 메커니즘 희소 조합 탐색 추가
fix(pnp): A4 여백 10mm에서 재단선이 인쇄 영역을 벗어나던 문제
docs(readme): 산출물 언어 설정 설명 추가
```

PR은 작고 목적이 하나인 편이 좋습니다. 스킬 프롬프트를 고쳤다면 **무엇이 달라지는지 예시를
같이** 넣어주세요. 프롬프트는 diff만 봐서는 개선인지 알기 어렵습니다.

## 질문

Issue나 Discussion으로 편하게 열어주세요.

---

# Contributing (English)

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first.

## What must never be committed

Two things you cannot undo. CI blocks both, but please be careful locally too.

**BoardGameGeek data.** The XML API Terms of Use do not allow redistributing fetched data.
`data/` is gitignored entirely — the SQLite index and the ranking dumps both live there.
Get your own token at
[boardgamegeek.com/applications](https://boardgamegeek.com/applications).
**We do not create a shared project token.**

**Your own game projects.** Publishing a contest entry can disqualify it. `projects/` is
gitignored entirely and only `projects/example-*/` is tracked. Unless you are editing the
example, do not include anything under `projects/` in a commit.

## Do not wrap this in a service

The BGG XML API Terms of Use prohibit third-party services from relaying data to other
applications. Deploying this as a web service would violate that. The design assumes it
stays **a local tool that each person runs with their own token**, so pull requests that
break that assumption are unlikely to be accepted.

## Language

**Documentation and prompts in this repository are Korean-first.** Public-facing entry
points like `README.md` carry an English version below the Korean body.

Generated design documents are a separate matter. Their language is chosen by the user in
`studio.config.json` under `language`, precisely because contributors and users may not be
Korean. Skills and agents read that value and write in that language.

Contributions that add English documentation are welcome, but **replacing the Korean
original with English is not.** Please put them side by side. Issues and pull requests in
either language are fine.

## Kinds of contribution

Code is not the only contribution — the ones below are arguably more useful.

### Component size presets

Adding standard sizes to `presets/components.json`. Tarot, Euro mini, bridge, square
tiles — anything actually used. This has the lowest barrier to entry and is immediately
useful to everyone. Please include the source (a manufacturer spec sheet, for instance).

### Skill and agent prompts

Editing or adding prompts under `.cursor/skills/` and `.cursor/agents/`. These land best
when they come with a concrete example, like "this critic kept missing X".

A few rules:

- Names must start with the **`bgs-` prefix**. Cursor puts both skills and subagents in
  the slash menu, so anything without a prefix collides with built-in commands.
- A skill's `name` must **exactly match its parent folder name**. If it does not, Cursor
  silently skips loading it and nobody can tell why. `npm run validate` checks this.
- An agent's `name` must **exactly match its filename**. Do not include the tier folder.
- `description` is required and capped at 1024 characters. Say what it does *and* when to
  use it.
- Rule files must use the `.mdc` extension. A `.md` file in `.cursor/rules/` is ignored.
- Do not let an agent decide for the user. Ask first, present options, let the user pick.

Agents are split across `directors/`, `leads/`, and `specialists/`. When adding one, pick
the folder by asking whether it **sets direction, manages execution, or looks at one thing
deeply**.

Names follow Korean game industry job titles: **`-designer` is a planning role and `-artist`
is an art role.** Do not name a drawing role `-designer`. "Illustrator" is avoided because in
that industry it refers to someone drawing promotional art.

#### If all the agents disappear

Cursor identifies agents by filename and ignores the path. Scanning subfolders works today,
but [Cursor considers that a bug to be fixed](https://forum.cursor.com/t/nested-markdown-files-inside-cursor-agents-are-incorrectly-detected-as-subagents/166296).
Whenever the loader changes, **all 13 may vanish from the slash menu at once.**

If that happens, flatten the folders back. Since names never depended on paths, nothing
else needs to change.

```bash
git mv .cursor/agents/*/*.md .cursor/agents/
rmdir .cursor/agents/directors .cursor/agents/leads .cursor/agents/specialists
npm run validate
```

For the same reason, **do not put non-agent documents inside `.cursor/agents/`.** Cursor's
scan treats any file with a pair of `---` as an agent, so dropping a README there creates a
phantom entry in the slash menu. `npm run validate` catches this and name collisions.

### Korean descriptions for BGG mechanisms

Improving `.cursor/skills/bgs-reference/references/bgg-mechanisms.md`. One line from
someone who has actually played a game using that mechanism beats any generated summary.

### Translation

To add an output language, add the code to `KNOWN_LANGUAGES` in `tools/lib/config.mjs`
and check that the skill prompts write well in it.

### Real usage reports

What you built with this, where it fell short, where the workflow got stuck. Issues and
Discussions are the most useful place for these.

### Code

The CLIs under `tools/`. Please respect these constraints:

- **Do not add runtime dependencies.** There are exactly two — `fast-xml-parser` and
  `pdfkit` — and everything else uses Node 24 built-ins (`node:sqlite`, `fetch`, `zlib`,
  `node:test`). Packages requiring a native build are not accepted. If you genuinely need
  a new dependency, open an issue first.
- **Do not assume Windows paths.** Development happens on Windows, but use `node:path`
  and never hardcode separators.
- **Code needing an API key cannot run in CI.** Separate the pure logic so it stays
  testable.
- **Save files without a UTF-8 BOM.** A BOM breaks the shebang and produces a syntax error
  that is hard to trace. `npm run validate` catches it.

## Development setup

```bash
git clone https://github.com/kongsol-83/boardgame-studio.git
cd boardgame-studio
npm install
cp .env.example .env
npm run doctor          # reports what is ready and what is missing
```

Node.js 24 or newer is required, because of `node:sqlite`.

### If you work on Windows

**Use PowerShell 7 or newer.** The bundled 5.1 does not handle UTF-8 properly: it fails to
read BOM-less UTF-8 scripts, writes `>` redirection as UTF-16, and adds a BOM with
`Set-Content -Encoding UTF8`. A BOM on a `.mjs` file breaks the shebang and produces a
syntax error that is hard to trace. See
[the README section](README.md#on-windows-install-powershell-7-first) for a measured
comparison.

**Install the [MSI](https://github.com/PowerShell/PowerShell/releases), not the winget
package.** `winget install --id Microsoft.PowerShell` only ships MSIX (Store), which leaves
a zero-byte execution alias on `PATH` — **the AI agent does not recognise it as pwsh and
falls back to 5.1.** The `win-x64.msi` puts a real binary at
`C:\Program Files\PowerShell\7\pwsh.exe`.

Then switch your editor's default terminal profile to `pwsh` and **fully quit and reopen
Cursor.** Reload Window does not refresh environment variables. `npm run doctor` checks both
the install method and which shell you are currently in.

Do not pass multi-line text or text containing quotes via `-m`, as with commit messages.
PowerShell splits the string at embedded quotes when handing arguments to an exe. Write the
text to a file and use `git commit -F <file>`, which is safe regardless of version.

If you work with an AI agent, read `.cursor/rules/shell.mdc` — it keeps shell usage minimal
and routes file edits through editing tools. Every rule in it came from an actual incident.

## Before opening a pull request

```bash
npm test        # format validation + syntax check + unit tests
```

CI runs the same on both ubuntu and windows, plus the forbidden-file checks.

## Commits and pull requests

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/).

```
feat(skills): add rare mechanism-pair search to bgs-reference
fix(pnp): cut lines fell outside the printable area at 10mm A4 margins
docs(readme): document the output language setting
```

Keep pull requests small and single-purpose. If you changed a skill prompt, **include an
example of what changes as a result** — a prompt diff alone rarely shows whether it is an
improvement.

## Questions

Open an issue or a discussion.
