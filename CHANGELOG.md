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
