# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser game built on **Phaser 4** with **Vite** bundling and **TypeScript**. This is the near-unmodified `phaserjs/template-vite-ts` starter (the scenes still contain placeholder art and text like "Make something fun!"), so most work here is building the actual game on top of the template scaffolding. Note: the directory is `riftlord`, but `package.json` still carries the template's `name`/metadata — update those when the game takes shape, since `log.js` reports `package.json.name`.

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
- `src/main.ts` — waits for `DOMContentLoaded`, then calls `StartGame('game-container')`.
- `src/game/main.ts` — defines the Phaser `GameConfig` (fixed canvas **1024×768**, `type: AUTO` for WebGL-with-canvas-fallback) and lists the scenes. This is where global game settings live.

**Scene pipeline** (`src/game/scenes/`) — the game is a linear chain of Phaser `Scene`s. The **first scene in the config array auto-starts**; every subsequent transition is an explicit `this.scene.start('Name')` inside the current scene:

```
Boot → Preloader → MainMenu → Game → GameOver → (back to MainMenu)
```

- `Boot` — loads only the minimal assets needed to render the Preloader (there is no loading UI yet at this point), then starts `Preloader`.
- `Preloader` — displays a progress bar wired to the loader's `progress` event, loads the bulk of game assets, then starts `MainMenu`. Add global animations / shared objects in its `create()`.
- `MainMenu`, `Game`, `GameOver` — currently placeholder screens; each advances on `pointerdown`.

When adding a scene: create the class in `src/game/scenes/`, import it, and register it in the `scene` array in `src/game/main.ts`. Ordering in that array matters only for which scene boots first.

**Coordinates:** scenes hard-code the canvas center as `(512, 384)` — that is `1024/2, 768/2`. If you change the canvas size in the config, these literals must change too.

## Assets

Two loading paths (see README "Handling Assets"):
- **Bundled** — `import logoImg from './assets/logo.png'`, then `this.load.image('logo', logoImg)`. Hashed and processed by Vite.
- **Static** — files in `public/assets/` are served/copied verbatim; reference them by string path, e.g. `this.load.image('background', 'assets/bg.png')`. `Preloader` uses `this.load.setPath('assets')` so its keys are relative to that folder.

`public/style.css` and `public/favicon.png` are also served from the web root (referenced as `/style.css`, `/favicon.png` in `index.html`).

## Vite config

Build config is split into two files targeted per-script (not the default `vite.config`):
- `vite/config.dev.mjs` — dev server on port 8080.
- `vite/config.prod.mjs` — adds Terser minification (2 passes, mangle, strips comments) and a build-message plugin.

Both set `base: './'` (relative asset paths, so the `dist/` build can be hosted from any subpath) and split Phaser into its own `phaser` manual chunk. To change build behavior, edit these files rather than adding a root `vite.config.*`.
