# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A classic Tetris implementation in vanilla JavaScript using HTML5 Canvas. No build process, no package manager, no dependencies — the game is just three files (`index.html`, `style.css`, `game.js`) opened directly in a browser.

## Running the game

There is no build/test/lint tooling. To run:

```bash
start index.html       # Windows: open directly, or
npx serve .             # serve locally (recommended so canvas/assets load consistently)
```

Then open the served URL, or the file directly, in a browser. Changes to `game.js`/`style.css`/`index.html` take effect on page reload — no compilation step.

## Architecture

Everything lives in `game.js` as a single script with module-level `let` state (`board`, `current`, `next`, `score`, `lines`, `level`, `paused`, `gameOver`, `dropAccum`, `dropInterval`, `animId`), reset by `init()`. There is no class structure or module system — functions operate directly on this shared state.

Key pieces, in the order data flows through them:

- **Board model**: `board` is a `ROWS × COLS` matrix (rows-first, `board[y][x]`) where `0` = empty and `1–7` = a color index tied to a piece type. `createBoard()` builds it fresh.
- **Pieces**: `PIECES` defines each of the 7 tetrominoes as a square matrix of color indices; `randomPiece()` clones a shape and spawns it centered at the top. Rotation is purely geometric — `rotateCW()` transposes + reverses rows, no per-piece rotation tables.
- **Collision (`collide`)**: the single source of truth for whether a shape at a given offset is legal (out of bounds or overlapping a filled cell). Every movement/rotation/drop path routes through this before mutating `current`.
- **Wall kicks (`tryRotate`)**: after rotating, tries offsets `[0, -1, 1, -2, 2]` columns and keeps the first that doesn't collide, else the rotation is discarded silently.
- **Lock → merge → clear → spawn pipeline (`lockPiece`)**: `merge()` bakes the current piece into `board`, `clearLines()` removes/re-inserts full rows (scored via `LINE_SCORES` × `level`, also recomputes `level` and `dropInterval`), then `spawn()` promotes `next` to `current`, generates a new `next`, and calls `endGame()` if the new piece immediately collides (top-out).
- **Game loop (`loop`)**: driven by `requestAnimationFrame`; accumulates elapsed time in `dropAccum` and advances the piece one row (or locks it) once `dropAccum >= dropInterval`, then redraws every frame regardless.
- **Rendering (`draw` / `drawNext` / `drawGrid` / `drawBlock`)**: canvas-only, no DOM diffing — the whole board canvas is cleared and redrawn every frame, including a ghost piece (computed via `ghostY()`, drawn at `globalAlpha 0.2`) and the locked board state. `drawNext` renders the same shape into a separate small canvas (`#next-canvas`).
- **Input**: a single `keydown` listener switches on `e.code` for movement/rotation/soft-drop/hard-drop, plus `P` for pause independent of the paused/gameOver guard. `updateHUD()` syncs score/lines/level `<span>`s after every state-changing action.

When changing board dimensions or block size, `COLS`, `ROWS`, and `BLOCK` in `game.js` must stay consistent with the `<canvas id="board">` `width`/`height` attributes in `index.html` (`COLS × BLOCK` and `ROWS × BLOCK`).
