# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

《異界魔王》RIFTLORD — a browser game built on **Phaser 4** with **Vite** bundling and **TypeScript**, started from the `phaserjs/template-vite-ts` scaffold. A **reverse tower-defense roguelike** (v0.5 "詛咒行軍"): you run the creep side — a fixed squad marches from the spring down a lane to a boss-HP rift gate, a curse drains their HP en route, and your facilities are buff-towers (heal/enchant) bought and upgraded with mana earned by damaging the gate. Death on the lane is permanent; wipe = run over. Design docs live in `docs/`: `gdd.md` is the design source of truth (§二 核心循環 describes v0.5; parts of §三 are marked as v0.1–0.4 history); `prototype-notes.md` records the current prototype's scope, design calls, and tuning knobs. UI text is Traditional Chinese.

## Commands

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies |
| `npm run dev` | Dev server with hot-reload at `http://localhost:8080` |
| `npm run build` | Production build to `dist/` |
| `npm run dev-nolog` / `build-nolog` | Same, but skip the `log.js` telemetry call |
| `npx tsc --noEmit` | Type-check only (there is no build-time type check — Vite transpiles without checking) |

There is **no test runner and no linter** configured. Type safety comes solely from `tsc` under a strict `tsconfig.json` (`strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`). `noEmit` is set, so `tsc` only checks.

`dev`/`build` prefix the command with `node log.js <event> &` — a single silent GET to `gryzor.co` (Phaser Studio's anonymous template-usage ping; see `log.js` and README). It runs in the background via `&`, so it never blocks or fails the build. Use the `-nolog` variants to suppress the network call entirely.

## Architecture

**Two-stage bootstrap:**
- `src/main.ts` — waits for `DOMContentLoaded`, calls `StartGame('game-container')`, and exposes the game instance as `window.__game` (debug handle for console/tests).
- `src/game/main.ts` — defines the Phaser `GameConfig` (`type: AUTO`, `Scale.FIT` + center) and lists the scenes. This is where global game settings live. **Retina handling:** the canvas is created at **1024×768 × `DPR`** (from `ui.ts`, capped at 2) and every scene's `create()` starts with `this.cameras.main.setZoom(DPR).centerOn(512, 384)`, so the logical coordinate space stays **1024×768** everywhere. Consequences: all `Text` styles must pass `resolution: DPR` (the `label()`/`makeButton()` helpers do), and raw pointer reads must use `pointer.worldX/worldY`, not `pointer.x/y` (interactive zones are camera-aware automatically).

**Scene pipeline** (`src/game/scenes/`) — the **first scene in the config array auto-starts**; every transition is an explicit `this.scene.start('Name')`:

```
MainMenu → Game → GameOver → (MainMenu or straight back to Game)
```

There is no Boot/Preloader chain: all art is programmatic (Graphics + emoji Text), nothing is loaded. `Game` restarts itself (`scene.restart()`) for each new level; all of its state must be re-zeroed at the top of `create()`.

**Game modules** (`src/game/`):
- `balance.ts` — every tuning knob, commented. Tune here, nowhere else.
- `types.ts` — traits (races dormant in v0.5), unit/door types, facility table, door flavor-name generation.
- `levelgen.ts` — one door per level: boss HP (exponential), curse DPS, weakness/resist trait from level 3.
- `grid.ts` — 15×9 board geometry (64px cells at offset 32,88) + BFS pathfinding (currently unused; kept for when free-form routing returns).
- `run.ts` — mutable singleton for the current run (level, squad with per-unit HP, mana, skills, placed stations — all persist across levels).
- `skills.ts` — in-run skill tree defs + effect helpers (`reviveRatio()`, `squadCap()`, …); scenes read effects only through these.
- `save.ts` — meta progression (reward points, unlock defs) persisted in `localStorage` key `riftlord_save_v2`.
- `ui.ts` — `label()`/`makeButton()` helpers; shared CJK font stack.

**Fixed layout** (v0.4.1+): spring at cell (7,7), gate at (7,1), auto-wired straight lane between them (`SPRING_CELL`/`DOOR_CELL` in `scenes/Game.ts`). Stations only take effect on lane cells.

**Coordinates:** menu scenes hard-code the canvas center `(512, 384)`; the board layout constants live in `grid.ts`. If you change the canvas size, both must change.

## Assets

Currently **zero external assets** — everything is drawn with Graphics/Text. `public/assets/bg.png` and `logo.png` are unused template leftovers. When real art arrives, use the template's two loading paths (see README "Handling Assets"): bundled imports under `src/`, or static files in `public/assets/` referenced by string path.

`public/style.css` and `public/favicon.png` are served from the web root (referenced as `/style.css`, `/favicon.png` in `index.html`).

## Vite config

Build config is split into two files targeted per-script (not the default `vite.config`):
- `vite/config.dev.mjs` — dev server on port 8080.
- `vite/config.prod.mjs` — adds Terser minification (2 passes, mangle, strips comments) and a build-message plugin.

Both set `base: './'` (relative asset paths, so the `dist/` build can be hosted from any subpath) and split Phaser into its own `phaser` manual chunk. To change build behavior, edit these files rather than adding a root `vite.config.*`.
