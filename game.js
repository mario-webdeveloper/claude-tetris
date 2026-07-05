'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#ff00ff', // J - neon fuchsia
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const THEME_KEY = 'tetris-theme';
const SOUND_KEY = 'tetris-sound';
const HIGHSCORE_KEY = 'tetris-highscore';
const GRID_COLORS = { dark: '#22222e', light: '#d0d0dc' };

const NEXT_COUNT = 3;
const DAS_DELAY = 150;      // ms held before auto-repeat starts
const ARR = 30;             // ms between auto-repeat steps
const SOFT_DROP_INTERVAL = 40; // ms per row while soft-dropping
const LOCK_DELAY = 500;     // ms grace period once a piece is grounded
const MAX_LOCK_RESETS = 15; // prevents infinite floating via move/rotate spam
const CLEAR_FLASH_MS = 220;

// ---- DOM ----
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const holdCanvas = document.getElementById('hold-canvas');
const holdCtx = holdCanvas.getContext('2d');
const nextCanvases = [0, 1, 2].map(i => document.getElementById(`next-canvas-${i}`));
const nextCtxs = nextCanvases.map(c => c.getContext('2d'));

const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const highScoreEl = document.getElementById('high-score');

const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlayHighscore = document.getElementById('overlay-highscore');
const resumeBtn = document.getElementById('resume-btn');
const restartBtn = document.getElementById('restart-btn');

const menuOverlay = document.getElementById('menu-overlay');
const menuHighScore = document.getElementById('menu-high-score');
const startBtn = document.getElementById('start-btn');

const themeToggle = document.getElementById('theme-toggle');
const soundBtn = document.getElementById('sound-btn');
const pauseBtn = document.getElementById('pause-btn');
const toastEl = document.getElementById('toast');

// ---- state ----
let board, current, queue, bag, hold, holdUsedThisTurn;
let score, lines, level, combo, backToBack, highScore;
let gameState; // 'menu' | 'playing' | 'paused' | 'gameover'
let lastTime, dropAccum, dropInterval, lockTimer, lockResets, animId;
let clearingRows, clearTimer;
let particles;
let heldDir, dasTimer, arrAccum, softDropActive;
let theme = 'dark';
let soundOn = true;
let audioCtx = null;
let toastTimer = null;

// ---- theme ----
function applyTheme(t) {
  theme = t;
  document.body.classList.toggle('light-theme', t === 'light');
  themeToggle.checked = t === 'light';
  localStorage.setItem(THEME_KEY, t);
}

// ---- sound ----
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function beep(freq, duration, type = 'square', vol = 0.05, delay = 0) {
  if (!soundOn) return;
  ensureAudio();
  const t0 = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function playSound(name) {
  switch (name) {
    case 'rotate': beep(330, 0.05, 'square', 0.03); break;
    case 'lock': beep(140, 0.05, 'square', 0.04); break;
    case 'hold': beep(260, 0.06, 'triangle', 0.03); break;
    case 'harddrop': beep(90, 0.08, 'sawtooth', 0.05); break;
    case 'clear': beep(520, 0.09, 'square', 0.05); break;
    case 'tetris':
      beep(523, 0.1, 'square', 0.05, 0);
      beep(659, 0.1, 'square', 0.05, 0.08);
      beep(784, 0.15, 'square', 0.06, 0.16);
      break;
    case 'levelup':
      beep(392, 0.08, 'triangle', 0.05, 0);
      beep(523, 0.12, 'triangle', 0.05, 0.09);
      break;
    case 'gameover':
      beep(220, 0.15, 'sawtooth', 0.05, 0);
      beep(160, 0.2, 'sawtooth', 0.05, 0.12);
      break;
  }
}

// ---- toast ----
function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1100);
}

// ---- board / bag / pieces ----
function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function refillBag() {
  const b = [1, 2, 3, 4, 5, 6, 7];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  bag.push(...b);
}

function ensureQueue() {
  while (queue.length < NEXT_COUNT) {
    if (bag.length === 0) refillBag();
    queue.push(bag.shift());
  }
}

function makePiece(type) {
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function rotateCCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[cols - 1 - c][r] = shape[r][c];
  return result;
}

function resetLockIfGrounded() {
  if (collide(current.shape, current.x, current.y + 1)) {
    if (lockResets < MAX_LOCK_RESETS) {
      lockTimer = 0;
      lockResets++;
    }
  } else {
    lockTimer = 0;
  }
}

function tryRotate(dir) {
  if (!current || clearingRows) return;
  const rotated = dir === 1 ? rotateCW(current.shape) : rotateCCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      resetLockIfGrounded();
      playSound('rotate');
      return;
    }
  }
}

function moveHorizontal(dir) {
  if (!current || clearingRows) return;
  if (collide(current.shape, current.x + dir, current.y)) return;
  current.x += dir;
  resetLockIfGrounded();
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function spawnClearParticles(rows) {
  for (const r of rows) {
    for (let c = 0; c < COLS; c++) {
      const colorIdx = board[r][c];
      if (!colorIdx) continue;
      for (let i = 0; i < 3; i++) {
        particles.push({
          x: c * BLOCK + BLOCK / 2,
          y: r * BLOCK + BLOCK / 2,
          vx: (Math.random() - 0.5) * 4,
          vy: -Math.random() * 3 - 1,
          life: 500 + Math.random() * 300,
          maxLife: 800,
          color: COLORS[colorIdx],
          size: 3 + Math.random() * 3,
        });
      }
    }
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    const k = dt / 16;
    p.x += p.vx * k;
    p.y += p.vy * k;
    p.vy += 0.15 * k;
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function processLineClear() {
  const fullRows = [];
  for (let r = 0; r < ROWS; r++) if (board[r].every(v => v !== 0)) fullRows.push(r);

  if (fullRows.length === 0) {
    combo = -1;
    spawnFromQueue();
    return;
  }

  spawnClearParticles(fullRows);
  clearingRows = fullRows;
  clearTimer = CLEAR_FLASH_MS;
}

function finalizeClear() {
  const rows = clearingRows;
  const n = rows.length;
  const remaining = board.filter((_, idx) => !rows.includes(idx));
  board = Array.from({ length: n }, () => new Array(COLS).fill(0)).concat(remaining);

  lines += n;
  combo += 1;

  let base = (LINE_SCORES[n] || 0) * level;
  if (n === 4) {
    if (backToBack) base *= 1.5;
    backToBack = true;
  } else if (n > 0) {
    backToBack = false;
  }
  if (combo > 0) base += 50 * combo * level;
  score += Math.round(base);

  const newLevel = Math.floor(lines / 10) + 1;
  const leveledUp = newLevel > level;
  level = newLevel;
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);

  if (n === 4) { showToast('TETRIS!'); playSound('tetris'); }
  else if (n === 3) { showToast('TRIPLE'); playSound('clear'); }
  else if (n === 2) { showToast('DOBLE'); playSound('clear'); }
  else { playSound('clear'); }

  if (combo > 0) showToast(`COMBO x${combo}`);
  if (leveledUp) { showToast(`NIVEL ${level}`); playSound('levelup'); }

  clearingRows = null;
  clearTimer = 0;
  updateHUD();
  spawnFromQueue();
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  if (!current || clearingRows) return;
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  updateHUD();
  playSound('harddrop');
  lockPiece();
}

function lockPiece() {
  merge();
  current = null;
  playSound('lock');
  holdUsedThisTurn = false;
  processLineClear();
}

function spawnFromQueue() {
  const type = queue.shift();
  ensureQueue();
  current = makePiece(type);
  lockTimer = 0;
  lockResets = 0;
  refreshPreviews();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
}

function holdPiece() {
  if (!current || holdUsedThisTurn || clearingRows) return;
  playSound('hold');
  if (hold == null) {
    hold = current.type;
    spawnFromQueue();
  } else {
    const temp = hold;
    hold = current.type;
    current = makePiece(temp);
    lockTimer = 0;
    lockResets = 0;
    if (collide(current.shape, current.x, current.y)) endGame();
  }
  holdUsedThisTurn = true;
  refreshPreviews();
}

// ---- rendering ----
function shadeColor(hex, percent) {
  const num = parseInt(hex.slice(1), 16);
  let r = (num >> 16) + Math.round(255 * percent);
  let g = ((num >> 8) & 0xff) + Math.round(255 * percent);
  let b = (num & 0xff) + Math.round(255 * percent);
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `rgb(${r},${g},${b})`;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  const px = x * size, py = y * size;
  context.globalAlpha = alpha ?? 1;
  const grad = context.createLinearGradient(px, py, px + size, py + size);
  grad.addColorStop(0, shadeColor(color, 0.18));
  grad.addColorStop(0.5, color);
  grad.addColorStop(1, shadeColor(color, -0.18));
  context.fillStyle = grad;
  context.fillRect(px + 1, py + 1, size - 2, size - 2);
  context.strokeStyle = shadeColor(color, -0.3);
  context.lineWidth = 1;
  context.strokeRect(px + 1.5, py + 1.5, size - 3, size - 3);
  context.fillStyle = 'rgba(255,255,255,0.25)';
  context.fillRect(px + 2, py + 2, size - 4, Math.max(2, size * 0.15));
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = GRID_COLORS[theme];
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  if (current) {
    const gy = ghostY();
    for (let r = 0; r < current.shape.length; r++)
      for (let c = 0; c < current.shape[r].length; c++)
        if (current.shape[r][c])
          drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.18);

    for (let r = 0; r < current.shape.length; r++)
      for (let c = 0; c < current.shape[r].length; c++)
        drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
  }

  if (clearingRows) {
    const pulse = 0.4 + 0.4 * Math.sin(performance.now() / 45);
    ctx.fillStyle = `rgba(255,255,255,${pulse})`;
    for (const r of clearingRows) ctx.fillRect(0, r * BLOCK, COLS * BLOCK, BLOCK);
  }

  drawParticles();
}

function getShapeBounds(shape) {
  let minR = Infinity, maxR = -1, minC = Infinity, maxC = -1;
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      if (shape[r][c]) {
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
      }
  return { minR, maxR, minC, maxC };
}

function drawPiecePreview(context, canvasEl, type) {
  context.clearRect(0, 0, canvasEl.width, canvasEl.height);
  if (type == null) return;
  const cell = Math.min(canvasEl.width, canvasEl.height) / 4;
  const shape = PIECES[type];
  const b = getShapeBounds(shape);
  const wCells = b.maxC - b.minC + 1, hCells = b.maxR - b.minR + 1;
  const offX = (canvasEl.width / cell - wCells) / 2 - b.minC;
  const offY = (canvasEl.height / cell - hCells) / 2 - b.minR;
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      if (shape[r][c]) drawBlock(context, offX + c, offY + r, shape[r][c], cell);
}

function refreshPreviews() {
  drawPiecePreview(holdCtx, holdCanvas, hold);
  holdCanvas.classList.toggle('disabled', holdUsedThisTurn);
  for (let i = 0; i < NEXT_COUNT; i++) {
    drawPiecePreview(nextCtxs[i], nextCanvases[i], queue[i]);
  }
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function updateHighScoreDisplay() {
  highScoreEl.textContent = highScore.toLocaleString();
}

// ---- DAS / soft drop ----
function updateDAS(dt) {
  if (!heldDir) return;
  dasTimer += dt;
  if (dasTimer < DAS_DELAY) return;
  arrAccum += dt;
  while (arrAccum >= ARR) {
    arrAccum -= ARR;
    moveHorizontal(heldDir === 'left' ? -1 : 1);
  }
}

function startHeldDir(dir) {
  if (heldDir === dir) return;
  heldDir = dir;
  dasTimer = 0;
  arrAccum = 0;
  moveHorizontal(dir === 'left' ? -1 : 1);
}

function stopHeldDir(dir) {
  if (heldDir === dir) heldDir = null;
}

// ---- state machine ----
function resetState() {
  board = createBoard();
  bag = [];
  queue = [];
  ensureQueue();
  hold = null;
  holdUsedThisTurn = false;
  score = 0; lines = 0; level = 1; combo = -1; backToBack = false;
  dropInterval = 1000; dropAccum = 0; lockTimer = 0; lockResets = 0;
  clearingRows = null; clearTimer = 0;
  particles = [];
  heldDir = null; dasTimer = 0; arrAccum = 0; softDropActive = false;
  lastTime = performance.now();
}

function startGame() {
  resetState();
  spawnFromQueue();
  updateHUD();
  updateHighScoreDisplay();
  menuOverlay.classList.add('hidden');
  overlay.classList.add('hidden');
  gameState = 'playing';
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

function endGame() {
  gameState = 'gameover';
  playSound('gameover');
  if (score > highScore) {
    highScore = score;
    localStorage.setItem(HIGHSCORE_KEY, String(highScore));
    overlayHighscore.textContent = '¡NUEVO RÉCORD!';
  } else {
    overlayHighscore.textContent = '';
  }
  updateHighScoreDisplay();
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  resumeBtn.classList.add('hidden');
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameState === 'playing') {
    gameState = 'paused';
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlayHighscore.textContent = '';
    resumeBtn.classList.remove('hidden');
    overlay.classList.remove('hidden');
    pauseBtn.textContent = '▶';
  } else if (gameState === 'paused') {
    gameState = 'playing';
    lastTime = performance.now();
    overlay.classList.add('hidden');
    pauseBtn.textContent = '⏸';
  }
}

function loop(ts) {
  const dt = Math.min(ts - lastTime, 100);
  lastTime = ts;

  if (gameState !== 'playing') {
    draw();
    animId = requestAnimationFrame(loop);
    return;
  }

  updateParticles(dt);
  updateDAS(dt);

  if (clearingRows) {
    clearTimer -= dt;
    if (clearTimer <= 0) finalizeClear();
    draw();
    animId = requestAnimationFrame(loop);
    return;
  }

  const grounded = collide(current.shape, current.x, current.y + 1);
  const interval = softDropActive ? Math.min(dropInterval, SOFT_DROP_INTERVAL) : dropInterval;

  if (grounded) {
    lockTimer += dt;
    if (lockTimer >= LOCK_DELAY) {
      lockPiece();
    }
  } else {
    dropAccum += dt;
    if (dropAccum >= interval) {
      dropAccum = 0;
      current.y++;
      if (softDropActive) { score += 1; updateHUD(); }
      lockTimer = 0;
    }
  }

  draw();
  animId = requestAnimationFrame(loop);
}

// ---- input: keyboard ----
document.addEventListener('keydown', e => {
  if (gameState === 'menu') {
    if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); startGame(); }
    return;
  }
  if (e.code === 'KeyP') { togglePause(); return; }
  if (gameState !== 'playing') return;

  switch (e.code) {
    case 'ArrowLeft': startHeldDir('left'); break;
    case 'ArrowRight': startHeldDir('right'); break;
    case 'ArrowDown': softDropActive = true; break;
    case 'ArrowUp':
    case 'KeyX': tryRotate(1); break;
    case 'KeyZ':
    case 'ControlLeft': tryRotate(-1); break;
    case 'KeyC':
    case 'ShiftLeft': holdPiece(); break;
    case 'Space': e.preventDefault(); hardDrop(); break;
  }
});

document.addEventListener('keyup', e => {
  if (e.code === 'ArrowLeft') stopHeldDir('left');
  if (e.code === 'ArrowRight') stopHeldDir('right');
  if (e.code === 'ArrowDown') softDropActive = false;
});

// ---- input: touch controls ----
document.querySelectorAll('.touch-btn').forEach(btn => {
  const action = btn.dataset.action;
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (gameState === 'menu') { startGame(); return; }
    if (gameState !== 'playing') return;
    switch (action) {
      case 'left': startHeldDir('left'); break;
      case 'right': startHeldDir('right'); break;
      case 'down': softDropActive = true; break;
      case 'rotate': tryRotate(1); break;
      case 'drop': hardDrop(); break;
      case 'hold': holdPiece(); break;
    }
  });
  const release = () => {
    if (action === 'left') stopHeldDir('left');
    if (action === 'right') stopHeldDir('right');
    if (action === 'down') softDropActive = false;
  };
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointerleave', release);
  btn.addEventListener('pointercancel', release);
});

// ---- buttons ----
restartBtn.addEventListener('click', startGame);
resumeBtn.addEventListener('click', () => { if (gameState === 'paused') togglePause(); });
startBtn.addEventListener('click', startGame);
pauseBtn.addEventListener('click', () => { if (gameState === 'playing' || gameState === 'paused') togglePause(); });

themeToggle.addEventListener('change', () => {
  applyTheme(themeToggle.checked ? 'light' : 'dark');
});

soundBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  soundBtn.textContent = soundOn ? '🔊' : '🔇';
  localStorage.setItem(SOUND_KEY, soundOn ? '1' : '0');
  if (soundOn) { ensureAudio(); playSound('rotate'); }
});

// ---- boot ----
applyTheme(localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark');
soundOn = localStorage.getItem(SOUND_KEY) !== '0';
soundBtn.textContent = soundOn ? '🔊' : '🔇';
highScore = parseInt(localStorage.getItem(HIGHSCORE_KEY) || '0', 10);
updateHighScoreDisplay();
menuHighScore.textContent = highScore > 0 ? `Récord: ${highScore.toLocaleString()}` : '';

gameState = 'menu';
board = createBoard();
current = null;
particles = [];
clearingRows = null;
draw();
animId = requestAnimationFrame(loop);
