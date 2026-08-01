# Boardgame Studio

An AI board game design studio for [Cursor](https://cursor.com). Turn a one-line idea into
BGG reference research, mechanism proposals, a ruleset, LLM playtest simulation, and
print-and-play PDFs.

> **한국어 사용자에게** — 본문은 [README.ko.md](README.ko.md) 에 있습니다. 스킬과 에이전트
> 프롬프트, 그리고 생성되는 모든 설계 문서는 한국어입니다.

## What it is

Board game design is not a single task. It is research, systems design, rules writing,
component specification, balance checking, and art direction — each needing a different
kind of judgement. This repository gives a Cursor session that structure: a set of
skills that run the pipeline, and subagents that each own one of those judgements.

The target output is a **contest-submission prototype**: a ruleset someone else can read,
components you can print on A4 and cut with scissors, and enough verification that you
do not waste a table full of playtesters on an obvious defect.

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
```

Open the folder in Cursor and type `/bgs` to see the available skills.

### Without any API key

Most of the pipeline runs offline. Clone, `npm install`, and these work immediately
against the bundled example project:

- component spec validation and mm-to-pixel resolution
- A4 print-and-play PDF rendering
- rules-engine smoke testing with a random bot
- numeric balance analysis over component CSVs

Only three things need a key: BGG research (BGG token), LLM playtesting, and art
generation (OpenAI key).

## Repository layout

```
.cursor/agents/     subagents — research, critics, spec, simulation, art
.cursor/skills/     the /bgs-* workflow skills
tools/              Node CLIs — bgg, spec, balance, sim, art, pnp
presets/            standard component sizes
projects/           your games. gitignored except example-*
data/               local BGG index and ranking dumps. gitignored
```

## Status

Early development. See [CHANGELOG.md](CHANGELOG.md) for what has landed.

## Contributing

Contributions are welcome, and prompt and knowledge contributions matter here as much
as code. See [CONTRIBUTING.md](CONTRIBUTING.md).

Two rules worth knowing before you open a PR: never commit BoardGameGeek data, and never
commit a game project other than `projects/example-*`. CI enforces both.

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for attribution and the BoardGameGeek
data terms.

Board game data comes from [BoardGameGeek](https://boardgamegeek.com) via the BGG XML
API2. No BGG data is redistributed here; you bring your own token.
