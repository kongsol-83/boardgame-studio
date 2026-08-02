# 변경 이력

이 프로젝트는 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 따르고
[유의적 버전](https://semver.org/lang/ko/)을 씁니다.

## [Unreleased]

### Added

- 저장소 골격과 오픈소스 구성 (Apache-2.0, 한국어 우선 문서에 영어 README)
- `.gitignore` — BGG 데이터(`data/`)와 본인 게임 프로젝트(`projects/`, `example-*` 제외)를
  버전 관리에서 제외
- CI — 커밋 금지 항목 검사, 형식 검증, 단위 테스트를 ubuntu와 windows 두 러너에서 실행
- `tools/validate.mjs` — 스킬 `name`이 부모 폴더명과 다르면 Cursor가 조용히 로드하지
  않으므로 이를 검사. 문법 오류와 UTF-8 BOM도 함께 잡는다
- `tools/lib/` — 의존성 없는 공용 모듈. YAML 프론트매터 파서, CSV 파서, ZIP 리더
- `tools/bgg/` — BGG XML API2 클라이언트와 로컬 인덱스
  - `seed` — 랭킹 덤프(zip 직접 읽기)에서 ID와 랭크 임포트. `--crawl` 로 덤프 없이도 가능
  - `hydrate` — 메커니즘, 카테고리, 무게, 인원, 시간을 20개씩 받아 채움
  - `search` / `similar` / `mechanics` / `stats`
  - 랭킹 덤프가 90일보다 오래되면 알리고 다운로드 페이지를 연다 (하루 1회)
- `/bgs-concept` — 아이디어를 핵심 동사 한 문장으로 낮추고 인원, 시간, 무게를 확정
- `/bgs-reference` — 유사작 조사와 메커니즘 후보 제안
- `bgs-researcher` 서브에이전트 — 조회 결과를 압축해 돌려준다. 원본 JSON이 메인
  컨텍스트를 잡아먹지 않게 하는 게 목적
- `studio.config.json` 과 `tools/config.mjs` — 생성되는 설계 문서의 언어를 정한다.
  이 저장소는 한국어로 만들어졌지만 쓰는 사람의 나라는 다를 수 있다. 환경변수
  `BGS_LANGUAGE` 가 파일보다 우선한다

- `/bgs-ruleset` — 룰북 형태의 룰셋. 수치는 인원별 열을 가진 표 하나로 모으고,
  버전과 `무엇을 / 왜 / 무엇을 확인하려고` 형식의 변경 이력을 남긴다
- `/bgs-review` — 크리틱 3명 병렬 검토와 플레이테스트 기록 정리
- 크리틱 3명 — `bgs-mechanism-critic`(핵심 동사가 실제로 일어나는가),
  `bgs-rules-critic`(룰 구멍과 애매한 문장. 설계 의도를 모르는 상태로 읽는다),
  `bgs-balance-analyst`(수치와 플레이 기록)
- `tools/balance.mjs` — 컴포넌트 CSV의 수치 컬럼을 자동으로 잡아 분포, IQR 이상치,
  상관, 코스트 대비 값 회귀 잔차를 낸다. 잔차가 큰 항목이 "비용 대비 과한 카드" 후보다

- 규격 시스템 — `spec.json` 에 mm로 선언하면 픽셀은 산출된다. `tools/spec.mjs` 가
  `validate`(선언 수량과 CSV 실제 수량 대조 포함), `resolve`(모델 제약에 맞춰 스냅하고
  유효 DPI 보고), `sheet`(A4 몇 장, 시트보다 큰 건 페이지 방향을 양쪽 다 계산해 분할),
  `presets` 를 낸다
- `presets/components.json` — BGG 슬리브 레퍼런스 기준 표준 카드 규격과 타일·토큰·보드 관례
- `.cursor/rules/shell.mdc` — 셸을 최소한으로 쓰는 규칙. Windows PowerShell 5.1의
  인코딩 기본값과 인라인 스크립트 파싱으로 실제로 시간을 날린 사례에서 나왔다
- `npm run doctor` — 개발 환경 점검. Node 버전, PowerShell 7 여부, git 신원, 키 설정,
  랭킹 덤프 신선도, 인덱스 상태를 한 번에 보여준다
- `/bgs-components` 와 `bgs-component-manager` — 룰셋의 구성물을 규격과 데이터로 옮긴다
- `/bgs-pnp` 와 `tools/pnp.mjs` — A4 프린트 앤 플레이 PDF. 재단선, 뒷면 좌우 반전,
  시트보다 큰 컴포넌트 분할(정렬 마크와 조각 번호), `--check` 텍스트 오버플로 검사.
  **아트가 없으면 도형과 텍스트로 렌더**해서 룰을 굳히기 전에 프로토타입을 뽑을 수 있다
- 한글 PDF를 위해 시스템 CJK 폰트를 찾아 임베드한다. 쓰인 글자만 서브셋되므로
  12.8MB 맑은 고딕을 써도 16페이지 PDF가 28KB다

- `/bgs-art` 와 `tools/art.mjs` — 아트 바이블로 스타일 앵커를 뽑고, 승인된 앵커를
  레퍼런스로 붙여 배치 생성한다. **승인 전에는 도구가 배치 생성을 거부한다.**
  A4 인쇄 전제(안전 여백 3mm, 글자 금지, 명도 하한, 유효 DPI 경고)가 프롬프트에
  자동으로 붙는다
- 아트 부서 5명 — `bgs-art-director`(바이블과 승인), `bgs-art-lead`(실행과 비용),
  `bgs-char-illustrator`(개체 식별성), `bgs-scene-illustrator`(타일 이음새),
  `bgs-graphic-designer`(정보 위계와 색약 대비)
- `bgs-creative-director` — 컨셉과 테마 각도. 개정이 쌓이며 방향이 꺾였는지 본다
- 시뮬레이션 검토 단계 — `run --focus` 로 확인하려는 것을 남기면 리포트와 검토가
  그 질문에 먼저 답한다. 종합/포커스 선택을 물은 뒤 각도별 에이전트를 병렬로 돌려
  새로 해볼 것 / 고칠 것 / 버릴 것으로 제안을 낸다

- `projects/example-tidepool/` — 키 없이 파이프라인 전체를 돌려볼 수 있는 예제.
  **도구가 무엇을 잡아내는지 보여주려고 문제를 일부러 심어뒀다.** 코스트 대비 튀는
  카드(단독 분포로는 이상치가 아니지만 회귀 잔차가 2위의 네 배), A4를 넘는 420mm 보드,
  이미지 모델이 거부하는 4:1 비율 컴포넌트, 최소 해상도에 못 미치는 20mm 토큰,
  답이 빠진 룰북
- CI에 예제 파이프라인 잡 추가 — `spec validate/resolve/sheet`, `balance`,
  `pnp --check`, `pnp`(폰트 설치 포함), `sim smoke` 를 실제로 실행한다. 단위 테스트가
  함수를 본다면 이건 도구들이 서로 맞물리는지를 본다
- `projects/example-tidepool/TUTORIAL.md` — 예제에 심어둔 것들을 순서대로 직접 걸려보는
  7단계 안내. 규격, 인쇄 장수, 수치, 텍스트 오버플로, 엔진 스모크, 룰북 구멍 찾기,
  개정과 버전 올리기. **전부 키 없이 20분이다.** 단계마다 값을 바꿔보고 `git checkout` 으로
  되돌리는 실습을 붙여서, 문서로 주장만 하던 것을 눈으로 확인하게 했다. 여백을 9mm에서
  10mm로 올리면 카드가 장당 9장에서 8장으로 떨어지는 것, `TP05` 가 단독 분포로는 이상치가
  아닌데 회귀 잔차로는 2위의 네 배인 것이 그런 예다. 예제 README는 "무엇이 심어져 있는지"
  목록으로 남겨 역할을 나눴다

### Fixed

- **Windows 설치 안내가 오히려 문제를 만들던 것을 고쳤다.** `winget install --id
  Microsoft.PowerShell` 이 MSIX(Store)만 제공하는데, MSIX로 깔면 PATH에 0바이트 실행
  별칭만 남는다. 사람이 `pwsh` 를 치면 동작하지만 **Cursor의 에이전트 셸은 이걸 인식하지
  못하고 내장 5.1로 폴백한다.** 설치했는데 에이전트만 5.1인 상태가 된다.
  [Cursor가 알려진 버그로 인정한 사안](https://forum.cursor.com/t/windows-agent-keep-using-powershell-5-instead-of-powershell-7/162813)
  이고 터미널 프로필 설정으로는 못 바꾼다. 안내를 GitHub 릴리스의 `win-x64.msi` 로 바꿨다
- `npm run doctor` 가 두 가지를 나눠서 본다. PowerShell 7이 MSIX로 깔렸는지, 그리고
  **지금 이 셸이 실제로 무엇인지**. 후자가 5.1이면 완전 종료 후 재시작을 안내한다
  (Reload Window로는 환경변수가 갱신되지 않는다)

- **산출물 날짜가 UTC로 찍히던 것을 고쳤다.** 한국에서 자정과 오전 9시 사이에 만든 파일이
  전날 날짜가 됐다. 예제 시뮬레이션 리포트가 실제로 하루 전 날짜로 커밋돼 있었다.
  `tools/lib/datetime.mjs` 를 만들어 PnP PDF 파일명, 시뮬레이션 로그와 리포트, 아트 승인
  기록이 전부 현지 시각을 쓴다. 로그의 `at` 은 `2026-08-02T03:10:33+09:00` 처럼 오프셋을
  붙인 형태라 기계가 파싱하면서 사람이 읽어도 현지 시각이다
- `studio.config.json` 에 `timezone` 을 추가했다. 기본값 `"auto"` 는 기계의 시간대를 쓰고,
  `"Asia/Seoul"` 처럼 IANA 이름을 직접 적어 고정할 수도 있다. 기계가 알려주지 않을 때만
  `language` 로 추정한다. 한국어를 쓰면서 다른 나라에 있을 수 있으므로 추정은 최후 수단이다

### Changed

- 게임 디자인 부서를 추가했다. `bgs-design-lead` 가 아래 넷을 조율한다.
  `bgs-system-designer`(규칙 구조와 코어 루프), `bgs-content-designer`(카드 종류와 덱 구성),
  `bgs-narrative-designer`(테마 붙이기, 이름, 용어 통일), `bgs-balance-designer`(수치)
- **직군명을 한국 게임 업계 관례로 통일했다.** 디자이너는 기획 직군이고 그림을 그리는 쪽은
  아티스트다. 업계에서 일러스트레이터는 홍보용 그림을 그리는 사람을 가리키므로 뺐다.
  `char-illustrator` → `character-artist`, `scene-illustrator` → `background-artist`,
  `graphic-designer` → `ui-artist`, `balance-analyst` → `balance-designer`.
  `ui-artist` 는 보드게임 업계에서 Graphic Designer라고 부르는 자리지만, 디자이너를 기획에만
  쓰기로 해서 바꿨다. 카드가 곧 플레이어와 게임 사이의 인터페이스라는 관점이기도 하다
- `bgs-component-manager` 를 `leads/` 에서 `specialists/` 로 내렸다. 사람을 관리하는
  자리가 아니라 규격 하나를 깊게 보는 자리다
- `.cursor/agents/` 를 `directors/`(2), `leads/`(2), `specialists/`(13) 세 단으로 나눴다.
  **Cursor는 에이전트를 파일명으로 식별하고 경로는 무시**하므로 이름과 참조는 그대로다.
  폴더는 파일 트리를 읽기 위한 구분이고, 슬래시 메뉴에는 드러나지 않는다.
  하위 폴더 스캔은 Cursor가 버그로 규정해 수정 예정이라, 로더가 바뀌면 에이전트가 한꺼번에
  사라질 수 있다. 증상과 복구 명령을 CONTRIBUTING에 남겼다
- `tools/validate.mjs` — 티어 폴더가 생기면서 새로 가능해진 사고 두 가지를 검사한다.
  다른 폴더에 같은 파일명이 있으면 Cursor가 한쪽을 조용히 드롭하는 것, 그리고
  `.cursor/agents/` 안에 둔 참고 문서가 유령 에이전트로 잡히는 것
- `/bgs-ruleset` — 수치표 규칙을 고쳤다. 기존 문구가 "표에는 인원별 열을 둔다"라고 강하게
  말하고 예외는 절 끝에 각주로 있어서, 인원과 무관한 값까지 2인/3인/4인 열을 만들고 같은
  숫자를 세 번 적게 됐다. 열이 나뉘어 있으면 읽는 사람은 인원별로 다를 것이라 기대한다.
  이제 인원별 표와 공통 표를 나누고, 컴포넌트 수량은 `spec.json` 이 원본임을 명시한다
- 예제에 크리틱과 LLM 플레이테스트를 둘 다 돌린 결과를 정리했다. **같은 룰북에서 두 방법의
  우선순위가 뒤집힌다.** 크리틱이 "해석 갈림"으로 본 항목(낸 카드의 행선지)이 플레이에서는
  89회로 압도적 1위였고, 크리틱이 잡은 "전원 채집력 0"은 30판 동안 한 번도 안 걸렸다.
  크리틱으로 목록을 만들고 플레이테스터로 순서를 정하는 근거다

- 모든 문서를 한국어 본문 + 하단 영어 구성으로 통일. `README.ko.md` 는 `README.md` 로
  합치고 삭제했다. 공개 저장소라 영어를 함께 두지만 기본은 한국어다
- `CODE_OF_CONDUCT.md` 에 Contributor Covenant 2.1 공식 한국어 번역을 함께 실었다
- A4 기본 여백을 10mm에서 **9mm** 로 내렸다. 포커 카드의 실제 규격은 63.5mm이고 3열이면
  190.5mm인데, 여백 10mm면 인쇄 영역이 190mm라 0.5mm 차이로 3열이 무너져 장당 9장이
  8장이 된다. 가장 흔한 규격에서 한 장을 잃는 셈이라 기본값을 바꿨다
