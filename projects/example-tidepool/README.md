# 예제 프로젝트: 조수 웅덩이

**이건 실제 게임이 아니라 파이프라인을 보여주기 위한 예제입니다.** 재미있게 만들려고
설계한 게 아니라, 도구가 무엇을 읽고 무엇을 내는지 눈으로 볼 수 있게 만든 것입니다.

## 키 없이 돌아가는 것

클론하고 `npm install` 만 하면 아래가 전부 동작합니다.

```bash
node tools/spec.mjs validate example-tidepool   # 규격과 수량 검증
node tools/spec.mjs resolve example-tidepool    # mm -> 픽셀, 유효 DPI
node tools/spec.mjs sheet example-tidepool      # A4 몇 장이 필요한가
node tools/balance.mjs example-tidepool --cost cost --value power
node tools/pnp.mjs example-tidepool --check     # 텍스트가 카드에 들어가는가
node tools/pnp.mjs example-tidepool             # PDF 렌더
node tools/sim.mjs smoke example-tidepool       # 랜덤 봇 엔진 검사
node tools/sim.mjs serve example-tidepool       # 브라우저에서 직접 플레이
```

CI가 이것들을 매번 실행합니다. 도구가 깨지면 여기서 걸립니다.

## 키가 있어야 하는 것

```bash
node tools/sim.mjs run example-tidepool --games 10    # OpenAI 키
node tools/art.mjs anchor example-tidepool --set nature --subject "..."
```

## 일부러 넣어둔 것들

도구가 무엇을 잡아내는지 보여주려고 의도적으로 심어둔 것이 있습니다.

- **`TP05 무리한 잠수`** — 3코스트에 파워 12입니다. 파워 단독 분포에서는 이상치가
  아니지만 코스트 대비로 보면 튑니다. `balance.mjs` 의 회귀 잔차가 이걸 집어냅니다
- **`main-board` 420x297mm** — A4 한 장에 안 들어갑니다. `spec sheet` 가 가로로 깔면
  4조각, 세로로 깔면 6조각이라고 알려주고 가로를 고릅니다. 유효 DPI가 203으로 떨어지는
  것도 `resolve` 가 경고합니다
- **`marker-strip` 100x25mm** — 비율이 4:1이라 이미지 모델이 생성하지 못합니다.
  `resolve` 가 세 가지 선택지를 제시하고 멈춥니다
- **`resource-token` 20x20mm** — 너무 작아서 최소 해상도를 못 넘깁니다. 키워서
  생성한 뒤 인쇄 시점에 줄입니다

## 룰북에 일부러 남겨둔 구멍

`ruleset.md` 에는 답이 없는 부분이 몇 군데 있습니다. `bgs-rules-critic` 이나
`/bgs-sim` 의 LLM 플레이어가 이걸 짚어내는지 확인해보세요. 실제로 룰북을 쓸 때
빠뜨리기 쉬운 것들입니다.
