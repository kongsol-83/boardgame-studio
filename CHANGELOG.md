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

### Changed

- 모든 문서를 한국어 본문 + 하단 영어 구성으로 통일. `README.ko.md` 는 `README.md` 로
  합치고 삭제했다. 공개 저장소라 영어를 함께 두지만 기본은 한국어다
- `CODE_OF_CONDUCT.md` 에 Contributor Covenant 2.1 공식 한국어 번역을 함께 실었다
- A4 기본 여백을 10mm에서 **9mm** 로 내렸다. 포커 카드의 실제 규격은 63.5mm이고 3열이면
  190.5mm인데, 여백 10mm면 인쇄 영역이 190mm라 0.5mm 차이로 3열이 무너져 장당 9장이
  8장이 된다. 가장 흔한 규격에서 한 장을 잃는 셈이라 기본값을 바꿨다
