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

Everything lives in `game.js` as a single script with module-level `let` state (`board`, `current`, `queue`, `bag`, `hold`, `score`, `lines`, `level`, `combo`, `backToBack`, `gameState`, `dropAccum`, `dropInterval`, `lockTimer`, `lockResets`, `clearingRows`, `particles`, `animId`), reset by `resetState()`. There is no class structure or module system — functions operate directly on this shared state.

`gameState` is a string state machine (`'menu' | 'playing' | 'paused' | 'gameover'`) rather than separate booleans; `loop()` only advances gameplay when it's `'playing'`, otherwise it just redraws the last frame so overlays stay visible.

Key pieces, in the order data flows through them:

- **Board model**: `board` is a `ROWS × COLS` matrix (rows-first, `board[y][x]`) where `0` = empty and `1–7` = a color index tied to a piece type. `createBoard()` builds it fresh.
- **Pieces**: `PIECES` defines each of the 7 tetrominoes as a square matrix of color indices. Rotation is purely geometric — `rotateCW()`/`rotateCCW()` transpose + reverse rows/cols, no per-piece rotation tables. `makePiece(type)` clones a shape and centers it at the top.
- **7-bag randomizer**: `bag` holds a shuffled `[1..7]` batch (`refillBag()`), and `queue` (length `NEXT_COUNT`) is kept topped up from it via `ensureQueue()` — guarantees no more than 12 pieces between repeats, unlike pure random.
- **Hold**: `hold` stores a piece type and `holdUsedThisTurn` limits it to once per drop; `holdPiece()` either stashes the current piece (first use) or swaps it with the held one, resetting lock state. Reset on every successful `lockPiece()`.
- **Collision (`collide`)**: the single source of truth for whether a shape at a given offset is legal (out of bounds or overlapping a filled cell). Every movement/rotation/drop path routes through this before mutating `current`.
- **Wall kicks (`tryRotate(dir)`)**: after rotating (dir `1` = CW, `-1` = CCW), tries offsets `[0, -1, 1, -2, 2]` columns and keeps the first that doesn't collide, else the rotation is discarded silently.
- **DAS/ARR movement**: holding an arrow key moves once immediately, then after `DAS_DELAY` ms auto-repeats every `ARR` ms (`updateDAS()`, driven from `loop()`), instead of relying on the OS key-repeat rate.
- **Lock delay**: once a piece is grounded, `lockTimer` accumulates in `loop()` instead of locking instantly; moving/rotating while grounded resets it via `resetLockIfGrounded()`, capped at `MAX_LOCK_RESETS` resets to prevent infinite floating.
- **Lock → clear → spawn pipeline**: `lockPiece()` merges the piece into `board`, then `processLineClear()` detects full rows. If none, it spawns immediately; if some, it spawns particles and sets `clearingRows`/`clearTimer` so `loop()` shows a pulsing flash for `CLEAR_FLASH_MS` before `finalizeClear()` removes the rows, scores (base `LINE_SCORES × level`, plus combo and back-to-back-Tetris bonuses), and calls `spawnFromQueue()`.
- **Scoring extras**: `combo` counts consecutive clearing locks (bonus `50 × combo × level`); `backToBack` tracks consecutive Tetrises (4-line clears get ×1.5 if the previous clear was also a Tetris).
- **Game loop (`loop`)**: driven by `requestAnimationFrame`; delta time is clamped to 100ms to avoid huge jumps after a backgrounded tab. Advances particles/DAS every frame, and either runs the clear-flash countdown or the normal fall/lock-delay logic, then redraws.
- **Rendering (`draw` / `drawPiecePreview` / `drawGrid` / `drawBlock`)**: canvas-only, no DOM diffing. `drawBlock` renders a gradient + beveled highlight per cell. `drawPiecePreview` is a generic renderer (used for both hold and the 3-slot next queue) that centers a piece's occupied bounding box in a square canvas. Line clears also render a particle burst (`particles` array, gravity + fade) on top of the board.
- **Audio**: a tiny WebAudio helper (`beep`/`playSound`) synthesizes short tones per event (rotate, lock, hold, hard drop, clear, Tetris, level-up, game over) — no audio files. Toggled by `soundBtn`, persisted in `localStorage`.
- **Persistence**: theme, sound on/off, and high score are all persisted in `localStorage` (`THEME_KEY`, `SOUND_KEY`, `HIGHSCORE_KEY`).
- **Input**: `keydown`/`keyup` listeners handle movement (with DAS), rotation (`X`/`↑` CW, `Z` CCW), hold (`C`), hard drop (`Space`), and pause (`P`). The same action handlers are wired to on-screen `.touch-btn` elements (shown via `@media (pointer: coarse)`) through `pointerdown`/`pointerup` for press-and-hold support.

When changing board dimensions or block size, `COLS`, `ROWS`, and `BLOCK` in `game.js` must stay consistent with the `<canvas id="board">` `width`/`height` attributes in `index.html` (`COLS × BLOCK` and `ROWS × BLOCK`).
