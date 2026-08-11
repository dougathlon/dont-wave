# Don't Wave — v0.4 watchtower prototype

*Don't Wave* is a short first-person watchtower game. From a fixed elevated view, the player calls GREEN LIGHT to let a crowd advance and charge the gun, then calls RED LIGHT to freeze the field. Every visible person is then either still or literally waving. The player has five uncontested seconds to click the wavers before the left and right towers begin shooting.

[Play the public build.](https://dougathlon.github.io/dont-wave/)

This repository contains the v0.4 watchtower reset. The hosted build uses the `/dont-wave/` base path.

## Play

```sh
pnpm install
pnpm dev
```

Open <http://127.0.0.1:4175/>.

- Press `G` or the GREEN LIGHT button to start movement and charge the gun.
- Press `R` or the RED LIGHT button once it is armed.
- During the five-second hunt, click or tap a visible person to fire directly at them.
- Press `Space` during a hunt to fire at the current reticle.
- During the final crossing, hold `W`, `Space`, or the on-screen movement control to walk forward.

## Game loop

A run contains two rounds of four turns each.

1. **GREEN LIGHT:** the crowd walks toward the watchtower. The gun gains one charge every 750 ms, up to six. Anyone who reaches the finish line beneath the tower leaves the visible field.
2. **RED LIGHT:** the crowd stops. Each visible person becomes unmistakably still or waving.
3. **HUNT:** for five seconds, the player clicks targets without interference. Zapping a waver awards 100 points. Zapping a still person deducts 100 points. Either hit evaporates the person and spends one charge; an empty shot also spends one charge.
4. **RIVAL FIRE:** the left and right towers shoot a limited number of unresolved wavers and score independently. Any waver left alive lowers their arm and continues forward on the next GREEN LIGHT.

The second round begins with a fresh crowd. After the eighth turn, the score race ends and the player descends into the field. The only action is to walk forward during GREEN LIGHT. On RED LIGHT, the player's hand rises involuntarily, a rival tower fires, and the run ends in death. There is no alternate ending.

The cause of each still-or-waving result is deliberately left unexplained in the game. The prototype prepares reproducible local turn data for testing and replay, contacts no external service, and establishes no technical claim about how a future version might produce those results.

## Verify

```sh
pnpm run check
pnpm run build:pages
pnpm run test:e2e:built
```

- `pnpm run check` runs strict TypeScript and the deterministic Vitest suite.
- `pnpm run build:pages` creates the production build with the `/dont-wave/` base path. Building does not publish it.
- `pnpm run test:e2e:built` runs the authored Playwright journeys against the built game. On the current macOS host, native Chromium launch is blocked before product assertions by a `MachPortRendezvousServer` permission denial, so this command is not currently a passing local verification route.

Release evidence includes 25 passing unit tests, a successful strict TypeScript check and Pages build, and in-app-browser checks of forward crowd movement, correct and incorrect direct hits, evaporation, rival beams and scoring, all eight turns, the fresh round-two crowd, descent, the compulsory death ending, and replay reset. The complete live run emitted no application errors or warnings.

## Structure

- `src/content/` — the 36-person field layout and mechanically neutral grotesque visual variation
- `src/simulation/` — deterministic turns, movement, charge, scoring, rivals, rounds, and ending state
- `src/game/` — Three.js field, civic playground, crowd, rival towers, camera, raycasting, beams, vapor, and first-person ending
- `src/audio/` — synthesized GREEN LIGHT, RED LIGHT, charge, and shot cues
- `src/input/` — keyboard, pointer, touch, and held crossing movement
- `src/ui/` — HUD, score race, charge display, controls, and transition overlays
- `tests/unit/` — deterministic content, turn-data, transition, scoring, and ending contracts
- `tests/e2e/` — authored browser journeys and presentation checks

## Status

This repository is the public, unlisted v0.4 concept prototype. Search indexing remains disabled, no external service is connected, and no open-source licence is granted. Technical and self-play checks do not establish that an unfamiliar player understands the race, enjoys the aiming, or experiences the ending as intended; those remain observed-playtest questions.
