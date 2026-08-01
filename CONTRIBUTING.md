# 기여 가이드

> **English summary** — Contributions are welcome. Prompt and knowledge contributions matter
> here as much as code. Working documents and agent prompts are written in Korean; the
> English `README.md` is the entry point. Before opening a PR, run `npm test`, and never
> commit BoardGameGeek data or a game project other than `projects/example-*`.
> CI enforces both.

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
- `description` 은 필수이며 1024자 이내입니다. 무엇을 하는지와 **언제 쓰는지**를 같이 씁니다.
- 룰 파일은 `.mdc` 확장자여야 합니다. `.cursor/rules/` 의 `.md` 는 무시됩니다.
- 에이전트가 사용자 결정을 대신하게 만들지 마세요. 먼저 묻고, 선택지를 제시하고,
  사용자가 고르는 흐름을 유지합니다.

### BGG 메커니즘 한글 설명

`.cursor/skills/bgs-reference/references/bgg-mechanisms.md` 의 설명과 대표작을 보강하는
기여입니다. 실제로 그 메커니즘을 쓰는 게임을 해본 사람의 한 줄이 훨씬 정확합니다.

### 번역

작업 문서와 에이전트 프롬프트는 한국어가 기본입니다. 영어 문서를 늘리는 기여는 환영하지만,
**한국어 원본을 영어로 대체하는 방향은 받지 않습니다.** 나란히 두는 방향으로 부탁드립니다.

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

## 개발 환경

```bash
git clone https://github.com/kongsol-83/boardgame-studio.git
cd boardgame-studio
npm install
cp .env.example .env
```

Node.js 24 이상이 필요합니다. `node:sqlite` 를 쓰기 때문입니다.

## PR 전에 돌릴 것

```bash
npm test        # 문법 검사 + 형식 검증 + 단위 테스트
```

CI도 같은 것을 돌리고, 여기에 더해 예제 프로젝트로 규격 검증과 PDF 렌더, 엔진 스모크
테스트를 실제로 실행합니다.

## 커밋과 PR

커밋 메시지는 [Conventional Commits](https://www.conventionalcommits.org/) 를 따릅니다.

```
feat(skills): bgs-reference에 메커니즘 희소 조합 탐색 추가
fix(pnp): A4 여백 10mm에서 재단선이 인쇄 영역을 벗어나던 문제
docs(ko): 규격 시스템 설명 보강
chore(deps): 없음 - 의존성은 늘리지 않습니다
```

PR은 작고 목적이 하나인 편이 좋습니다. 스킬 프롬프트를 고쳤다면 **무엇이 달라지는지 예시를
같이** 넣어주세요. 프롬프트는 diff만 봐서는 개선인지 알기 어렵습니다.

## 질문

Issue나 Discussion으로 편하게 열어주세요. 한국어와 영어 모두 괜찮습니다.
