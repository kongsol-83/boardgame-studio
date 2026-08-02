# 보안

*[English version below](#security-english).*

## 신고

취약점을 찾으면 **공개 이슈에 적지 마세요.** GitHub의
[Security Advisory](https://github.com/kongsol-83/boardgame-studio/security/advisories/new)
로 비공개 신고를 받습니다. 그게 막혀 있으면
[저장소 소유자](https://github.com/kongsol-83)에게 연락하세요.

지원 범위는 `main` 최신 상태입니다. 아직 초기 개발이라 이전 버전에 패치를 백포트하지
않습니다.

## 무엇이 시크릿인가

`.env` 의 두 값뿐입니다.

| 이름 | 쓰이는 곳 | 폐기 |
| --- | --- | --- |
| `OPENAI_API_KEY` | 플레이 시뮬레이션, 아트 생성 | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `BGG_API_TOKEN` | BGG 레퍼런스 조사 | [boardgamegeek.com/applications](https://boardgamegeek.com/applications) |

**`.env` 는 gitignore이고 CI가 따로 한 번 더 막습니다.** `.gitignore` 는 `git add -f`
한 번이면 뚫리지만 CI 잡은 안 뚫립니다. 그래도 실수로 커밋해서 푸시했다면 **먼저 키를
폐기하고 새로 발급하세요.** 히스토리를 고치는 건 그다음입니다. 이미 나간 키는 되돌릴 수
없습니다.

키를 명령줄 인자나 커밋 메시지에 넣지 마세요. 셸 히스토리와 git 히스토리에 남습니다.

## 이 도구가 하는 일 중 알고 있어야 하는 것

세 가지입니다. 취약점이 아니라 설계상 그렇게 동작하는 것들이고, 모르고 쓰면 놀랄 자리입니다.

**규칙 엔진은 코드로 실행됩니다.** `tools/sim.mjs` 는 `projects/<slug>/sim/engine.mjs` 를
동적으로 `import` 합니다. 그래서 **남이 준 프로젝트 폴더를 그대로 넣고 `sim` 을 돌리면 그
안의 코드가 내 기계에서 돕니다.** 파일 읽기와 쓰기, 네트워크 호출을 포함해 Node가 할 수
있는 전부를 할 수 있습니다. 직접 만들었거나 읽어본 엔진만 돌리세요.

**룰셋 전문이 외부로 나갑니다.** `sim run` 은 룰북을 프롬프트에 넣어 OpenAI로 보냅니다.
`art gen` 은 아트 프롬프트를 보냅니다. 미공개 출품작을 시뮬레이션에 돌리는 것은 그 내용을
외부 서비스에 전송한다는 뜻입니다. 데이터 보존 정책은 그 서비스의 약관을 따릅니다. 키가
필요한 명령은 이 둘과 BGG 조회뿐이고, 나머지 파이프라인은 전부 오프라인입니다.

**`sim serve` 는 프로젝트 폴더를 HTTP로 내줍니다.** 기본값은 루프백(`127.0.0.1`)만
듣습니다. `--host 0.0.0.0` 으로 열면 같은 네트워크의 다른 기기가 `projects/<slug>/` 를
읽습니다. 태블릿을 테이블에 놓고 플레이하려면 필요하지만, 그때는 그 폴더가 열려 있다는
것을 알고 열어야 합니다. 신뢰할 수 없는 네트워크에서는 열지 마세요.

## 커밋하면 안 되는 것

시크릿과 별개로 되돌릴 수 없는 것이 둘 더 있습니다. CI가 막습니다.

**본인 게임 프로젝트.** 공모전 출품작이 공개 저장소에 올라가면 출품 자격까지 걸릴 수
있습니다. `projects/` 는 통째로 gitignore이고 `projects/example-*/` 만 추적됩니다.

**BGG 데이터.** XML API 이용약관상 받아온 데이터를 재배포할 수 없습니다. `data/` 도
통째로 제외됩니다.

---

# Security (English)

## Reporting

Found a vulnerability? **Do not open a public issue.** Report it privately through GitHub
[Security Advisories](https://github.com/kongsol-83/boardgame-studio/security/advisories/new),
or contact the [repository owner](https://github.com/kongsol-83) if that is unavailable.

Only the current `main` is supported. This is early development, so fixes are not
backported.

## What counts as a secret

Two values in `.env`, and nothing else.

| Name | Used by | Revoke at |
| --- | --- | --- |
| `OPENAI_API_KEY` | play simulation, art generation | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `BGG_API_TOKEN` | BoardGameGeek reference research | [boardgamegeek.com/applications](https://boardgamegeek.com/applications) |

**`.env` is gitignored and CI blocks it a second time.** A `.gitignore` yields to a single
`git add -f`; the CI job does not. If you do commit and push a key, **revoke and reissue it
first** and rewrite history afterwards. A key that has left your machine cannot be recalled.

Never pass keys as command-line arguments or put them in commit messages; both persist in
history.

## Things worth knowing about how this works

Not vulnerabilities — deliberate behaviour that will surprise you if you do not know it.

**Rules engines run as code.** `tools/sim.mjs` dynamically `import`s
`projects/<slug>/sim/engine.mjs`. Dropping in someone else's project folder and running
`sim` **executes their code on your machine**, with everything Node can do: file reads and
writes, network calls, all of it. Only run engines you wrote or have read.

**Your full ruleset leaves your machine.** `sim run` puts the rulebook into a prompt and
sends it to OpenAI; `art gen` sends art prompts. Simulating an unpublished contest entry
means transmitting its contents to a third-party service under that service's retention
terms. Those two commands and BGG lookups are the only ones needing a key; the rest of the
pipeline is offline.

**`sim serve` exposes a project folder over HTTP.** It binds loopback (`127.0.0.1`) by
default. With `--host 0.0.0.0`, any device on your network can read `projects/<slug>/`.
That is useful for playing on a tablet at the table, but open it knowingly, and not on a
network you do not trust.

## What must never be committed

Beyond secrets, two things you cannot undo. CI blocks both.

**Your own game projects.** Publishing a contest entry can disqualify it. `projects/` is
gitignored entirely; only `projects/example-*/` is tracked.

**BoardGameGeek data.** The XML API Terms of Use do not allow redistributing fetched data.
`data/` is excluded entirely.
