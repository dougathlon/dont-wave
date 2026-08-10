# Don't Wave — watchtower prototype

A Three.js/TypeScript/Vite prototype of *Don't Wave*: a two-round watchtower game in which the player chooses when a crowd must stop, then races two side operators to zap the creatures caught waving.

[Play the public build.](https://dougathlon.github.io/dont-wave/)

Version 0.3 uses an original procedural 3D civic playground, a scoring-versus-escape timing choice, direct target shooting, per-turn reports, escalating side-tower pressure, and an embodied crossing-and-death ending.

## Prototype boundary

The game prepares four deterministic **classical demo records** locally before play, one for each `{ round, turn }` address. A record binds a still-or-waving outcome to every stable creature ID and can be consumed once. Green-light duration changes physical crossing progress and exposure; it does not select a different prepared result.

The player-facing game leaves the cause of each resolution unstated. It does not contact an external simulator, service, or quantum computer, and it makes no claim about circuits, measurement bases, collapse, entanglement, particles, or quantum advantage. The compulsory wave in the ending is scripted and is not a fifth prepared record.

## Play

```sh
pnpm install
pnpm dev
```

Open <http://127.0.0.1:4175/>. The hosted build uses the `/dont-wave/` base path.

- `G`: begin a green-light movement window
- `R`: choose red after the short safety gate
- Pointer/touch: click or tap a visibly waving creature to zap it
- `Space`: fire at the current reticle during a hunt; hold to move during the final crossing
- `W`: hold to move during the final crossing
- `Escape`: pause or resume

A complete run contains two rounds of two green/red turns—four turns total. Each red consumes exactly one prepared record. Waiting lets more people reach the gate, but leaves fewer possible targets. The player gets a short uncontested targeting window before the left and right side operators enter at an increasingly fast pace. Towers never receive unresolved targets automatically at timeout. Correct hits score 100 points; invalid or duplicate shots count as misses but do not reduce the score.

After the fourth report, the player descends from the tower and enters the same crossing in first person. The sequence always ends with a compulsory wave and death; there is no hidden success branch.

## Verify

```sh
pnpm check
pnpm build:pages
pnpm test:e2e:built
```

`pnpm check` runs strict TypeScript and deterministic unit tests. `build:pages` uses `/dont-wave/` as the production base. Browser screenshots and a real unaccelerated playthrough are required in addition to compilation because the field, aiming, beams, and ending are WebGL-rendered.

## Structure

- `src/content/` — 48 stable identities and mechanically neutral visual variation
- `src/audio/` — gesture-unlocked synthesized action and impact cues
- `src/simulation/` — deterministic state, prepared-record validation, scoring, side-operator race, rounds, and scripted ending
- `src/game/` — Three.js playground, instanced crowd, camera, hit testing, reticle, beams, and first-person ending
- `src/input/` — keyboard, held movement, pointer lifecycle, pause, and visibility handling
- `src/ui/` — DOM briefing, edge HUD, controls, overlays, accessibility state, and reduced-motion presentation
- `tests/unit/` — content, record-bank, transition, scoring, persistence, and ending contracts
- `tests/e2e/` — complete desktop/touch journeys, responsive checks, screenshots, and browser errors

## Status

This repository is the public, unlisted v0.3 concept playtest. Search indexing is disabled, no live external service is connected, and no open-source licence is granted. Static and browser checks establish the implementation boundary; timing comprehension, aim feel, and the effect of the inevitable ending still require an unbriefed observed human playtest.
