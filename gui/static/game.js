'use strict';

const BUILD_DATE = '2026-04-30 21:36:14';

// ─── PRNG ────────────────────────────────────────────────────────────────────
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLORS = ['R', 'Y', 'G', 'B'];

// ─── tsumo-rule.md準拠 ぷよぷよ20th LCGツモ生成 ────────────────────────────
// seed 0〜65535 → 128ペアの固定ツモ列（ループ）
// seed > 65535  → mulberry32によるランダム生成にフォールバック
function lcgNext(rand) {
  return Number((BigInt(rand) * 0x5D588B65n + 0x269EC3n) & 0xFFFFFFFFn);
}

function shufflePool(arr, rand, sfl) {
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < sfl[k][0]; i++) {
      for (let j = 0; j < sfl[k][1]; j++) {
        rand = lcgNext(rand);
        const n1 = (rand >>> sfl[k][2]) + i * 0x10;
        rand = lcgNext(rand);
        const n2 = (rand >>> sfl[k][2]) + (i + 1) * 0x10;
        [arr[n1], arr[n2]] = [arr[n2], arr[n1]];
      }
    }
  }
  return rand;
}

function generateTsumoLCG(seed) {
  let rand = seed & 0xFFFFFFFF;
  const sfl = [[15, 8, 28], [7, 16, 27], [3, 32, 26]];

  // Pool 1: 3色プール（初手2手を最大3色に抑えるため）
  const arr1 = Array.from({ length: 256 }, (_, i) => i % 3);
  rand = shufflePool(arr1, rand, sfl);

  // Pool 2: 4色プール（通常ツモ）
  const arr2 = Array.from({ length: 256 }, (_, i) => i % 4);
  rand = shufflePool(arr2, rand, sfl);

  // 初手2手（4要素）をPool1で上書き → 初手2手は必ず3色以内
  arr2[0] = arr1[0]; arr2[1] = arr1[1]; arr2[2] = arr1[2]; arr2[3] = arr1[3];

  return Array.from({ length: 128 }, (_, i) => [COLORS[arr2[i * 2]], COLORS[arr2[i * 2 + 1]]]);
}

function generateQueue(seed, count = 200) {
  if (seed >= 0 && seed <= 65535) {
    const base = generateTsumoLCG(seed);
    return Array.from({ length: count }, (_, i) => base[i % 128]);
  }
  const rng = mulberry32(seed);
  return Array.from({ length: count }, () => [
    COLORS[Math.floor(rng() * 4)],
    COLORS[Math.floor(rng() * 4)],
  ]);
}

// ─── FIELD LOGIC ─────────────────────────────────────────────────────────────
function emptyField() {
  return Array.from({ length: 13 }, () => Array(6).fill('.'));
}

function cloneField(f) {
  return f.map(r => [...r]);
}

function lowestEmpty(field, col) {
  if (col < 0 || col > 5) return -1;
  for (let row = 12; row >= 0; row--) {
    if (field[row][col] === '.') return row;
  }
  return -1;
}

function dropPuyo(field, col, color) {
  const row = lowestEmpty(field, col);
  if (row === -1) return field;
  const f = cloneField(field);
  f[row][col] = color;
  return f;
}

function applyMove(field, x, r, pair) {
  const [c1, c2] = pair;
  let f = cloneField(field);
  if (r === 'UP') {
    f = dropPuyo(f, x, c1);
    f = dropPuyo(f, x, c2);
  } else if (r === 'DOWN') {
    f = dropPuyo(f, x, c2);
    f = dropPuyo(f, x, c1);
  } else if (r === 'RIGHT') {
    f = dropPuyo(f, x, c1);
    f = dropPuyo(f, x + 1, c2);
  } else {  // LEFT
    f = dropPuyo(f, x, c1);
    f = dropPuyo(f, x - 1, c2);
  }
  return f;
}

function applyGravity(field) {
  const f = emptyField();
  for (let col = 0; col < 6; col++) {
    const cells = [];
    for (let row = 0; row < 13; row++) {
      if (field[row][col] !== '.') cells.push(field[row][col]);
    }
    for (let i = 0; i < cells.length; i++) {
      f[12 - i][col] = cells[cells.length - 1 - i];
    }
  }
  return f;
}

function findGroups(field) {
  const visited = Array.from({ length: 13 }, () => Array(6).fill(false));
  const groups = [];
  for (let row = 1; row < 13; row++) {
    for (let col = 0; col < 6; col++) {
      const c = field[row][col];
      if (!visited[row][col] && c !== '.' && c !== '#') {
        const group = [];
        const q = [[row, col]];
        visited[row][col] = true;
        while (q.length) {
          const [r, c2] = q.pop();
          group.push([r, c2]);
          for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const nr = r + dr, nc = c2 + dc;
            if (nr >= 1 && nr < 13 && nc >= 0 && nc < 6 &&
                !visited[nr][nc] && field[nr][nc] === field[r][c2]) {
              visited[nr][nc] = true;
              q.push([nr, nc]);
            }
          }
        }
        groups.push({ color: c, cells: group });
      }
    }
  }
  return groups;
}

// ─── CHAIN SCORE (Puyo Puyo Tsu rules) ──────────────────────────────────────
const CHAIN_POWER  = [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512];
const COLOR_BONUS  = [0, 0, 3, 6, 12, 24];
const GROUP_BONUS  = [0, 0, 0, 0, 0, 2, 3, 4, 5, 6, 7, 10];

function calcStepScore(groups, chainIndex) {
  const popCount   = groups.reduce((s, g) => s + g.cells.length, 0);
  const power      = CHAIN_POWER[Math.min(chainIndex, CHAIN_POWER.length - 1)];
  const colorBonus = COLOR_BONUS[Math.min(new Set(groups.map(g => g.color)).size, COLOR_BONUS.length - 1)];
  let groupBonus   = 0;
  for (const g of groups) groupBonus += GROUP_BONUS[Math.min(g.cells.length, GROUP_BONUS.length - 1)];
  return popCount * 10 * Math.max(1, Math.min(999, power + colorBonus + groupBonus));
}

// Returns { field, steps: [{popped, fieldAfter, stepScore}], chainCount, totalScore, garbageSent }
function popChains(field) {
  const steps = [];
  let chainCount = 0;
  let totalScore = 0;
  let f = cloneField(field);

  while (true) {
    const groups = findGroups(f);
    const toRemove = groups.filter(g => g.cells.length >= 4);
    if (toRemove.length === 0) break;

    const stepScore = calcStepScore(toRemove, chainCount);
    totalScore += stepScore;
    chainCount++;

    const removeCells = new Set();
    for (const g of toRemove) {
      for (const [r, c] of g.cells) removeCells.add(`${r},${c}`);
    }
    for (const key of [...removeCells]) {
      const [r, c] = key.split(',').map(Number);
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < 13 && nc >= 0 && nc < 6 && f[nr][nc] === '#') {
          removeCells.add(`${nr},${nc}`);
        }
      }
    }
    const newF = cloneField(f);
    for (const key of removeCells) {
      const [r, c] = key.split(',').map(Number);
      newF[r][c] = '.';
    }
    const afterGravity = applyGravity(newF);
    steps.push({ popped: removeCells, fieldAfter: afterGravity, stepScore });
    f = afterGravity;
  }

  return { field: f, steps, chainCount, totalScore, garbageSent: Math.floor(totalScore / 70) };
}

// ─── PIECE CONTROLS ──────────────────────────────────────────────────────────
function getGhostPositions(field, piece) {
  const { x, r, pair } = piece;
  const [c1, c2] = pair;

  if (r === 'UP' || r === 'DOWN') {
    const row1 = lowestEmpty(field, x);
    if (row1 === -1) return null;
    const row2 = row1 - 1;
    if (r === 'DOWN') {
      if (row2 < 0) return null;  // 軸ぷよが14段目: 常に無効
      return [{ row: row1, col: x, color: c2 }, { row: row2, col: x, color: c1 }];
    } else {  // UP
      if (row2 < 0 && (game.row14 >> x) & 1) return null;  // 14段目が占有済み
      const cells = [{ row: row1, col: x, color: c1 }];
      if (row2 >= 0) cells.push({ row: row2, col: x, color: c2 });
      return cells;
    }
  } else if (r === 'RIGHT') {
    if (x + 1 > 5) return null;
    const row1 = lowestEmpty(field, x);
    const row2 = lowestEmpty(field, x + 1);
    if (row1 === -1 || row2 === -1) return null;
    return [{ row: row1, col: x, color: c1 }, { row: row2, col: x + 1, color: c2 }];
  } else {  // LEFT
    if (x - 1 < 0) return null;
    const row1 = lowestEmpty(field, x);
    const row2 = lowestEmpty(field, x - 1);
    if (row1 === -1 || row2 === -1) return null;
    return [{ row: row1, col: x, color: c1 }, { row: row2, col: x - 1, color: c2 }];
  }
}

const ROT_CW  = { UP: 'RIGHT', RIGHT: 'DOWN', DOWN: 'LEFT', LEFT: 'UP' };
const ROT_CCW = { UP: 'LEFT',  LEFT: 'DOWN',  DOWN: 'RIGHT', RIGHT: 'UP' };

function clampX(x, r) {
  if (r === 'RIGHT' && x > 4) return 4;
  if (r === 'LEFT'  && x < 1) return 1;
  return x;
}

function rotatePiece(piece, dir) {
  const r = dir === 'CW' ? ROT_CW[piece.r] : ROT_CCW[piece.r];
  return { ...piece, r, x: clampX(piece.x, r) };
}

function movePiece(piece, dir) {
  if (dir === 'LEFT') {
    const minX = piece.r === 'LEFT' ? 1 : 0;
    if (piece.x <= minX) return piece;
    return { ...piece, x: piece.x - 1 };
  } else {
    const maxX = piece.r === 'RIGHT' ? 4 : 5;
    if (piece.x >= maxX) return piece;
    return { ...piece, x: piece.x + 1 };
  }
}

// ─── PUYOP URL ENCODING ──────────────────────────────────────────────────────
const PUYOP_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ[]';

function puyopFieldCellId(color) {
  return { '.': 0, 'R': 1, 'G': 2, 'B': 3, 'Y': 4, '#': 6 }[color] ?? 0;
}
function puyopTsumoId(color) {
  return { 'R': 0, 'G': 1, 'B': 2, 'Y': 3 }[color] ?? 0;
}
function directionInt(r) {
  return { 'UP': 0, 'RIGHT': 1, 'DOWN': 2, 'LEFT': 3 }[r] ?? 0;
}

function encodePuyopField(field) {
  let result = '';
  let started = false;
  for (let row = 0; row < 13; row++) {        // row 0 = y13 (top)
    for (let col = 0; col <= 4; col += 2) {   // col 0,2,4 → x=1,3,5 pairs
      const l = puyopFieldCellId(field[row][col]);
      const r2 = puyopFieldCellId(field[row][col + 1]);
      if (!started && l === 0 && r2 === 0) continue;
      started = true;
      result += PUYOP_CHARS[l * 8 + r2];
    }
  }
  return result;
}

function encodePuyopMoves(moves) {
  let result = '';
  for (const { pair, x, r } of moves) {
    const pairCode = puyopTsumoId(pair[0]) * 5 + puyopTsumoId(pair[1]);
    const placementCode = ((x + 1) << 2) + directionInt(r);
    const code = pairCode | (placementCode << 7);
    result += PUYOP_CHARS[code & 0x3F];
    result += PUYOP_CHARS[(code >> 6) & 0x3F];
  }
  return result;
}

function generatePuyopURL() {
  const fieldStr = encodePuyopField(game.initialField);
  const movesStr = encodePuyopMoves(game.moves.slice(0, game.queueIndex));
  return `http://www.puyop.com/s/${fieldStr}_${movesStr}`;
}

// ─── GAME STATE ──────────────────────────────────────────────────────────────
const game = {
  field: emptyField(),
  fullQueue: [],      // 200-length generated queue
  queueIndex: 0,
  currentPiece: null,
  history: [],        // [{field, queueIndex, moveCount, chainCount}]
  future: [],
  moveCount: 0,
  chainCount: 0,
  totalScore: 0,
  row14: 0,
  animating: false,
  gameOver: false,
  aiEnabled: false,
  pendingAI: null,    // {candidates, forQueueIndex} or null
  aiQuerying: false,
  aiError: null,
  session: 0,
  aiPlaying: false,
  autoPlaying: false,
  moves: [],          // [{pair, x, r}] for each placed piece
  initialField: null, // field state at game start (for ぷよ譜URL)
  garbageMode: false,
};

// ─── RENDERING ───────────────────────────────────────────────────────────────
const COLOR_NAMES = { R: '赤', Y: '黄', G: '緑', B: '青' };

function cellClass(color) {
  if (color === '.') return 'cell cell-empty';
  if (color === '#') return 'cell cell-hash';
  return `cell cell-${color}`;
}

function renderField() {
  const ghost = game.currentPiece && !game.animating
    ? getGhostPositions(game.field, game.currentPiece) : null;
  const ghostSet = {};
  if (ghost) {
    for (const g of ghost) ghostSet[`${g.row},${g.col}`] = g.color;
  }

  // Entry rows: show current piece at its current position
  const entryColors = {}; // `${row},${col}` → color
  if (game.currentPiece && !game.animating) {
    const { x, r, pair } = game.currentPiece;
    const [c1, c2] = pair;
    if (r === 'UP')         { entryColors['0,' + x] = c2; entryColors['1,' + x] = c1; }
    else if (r === 'DOWN')  { entryColors['0,' + x] = c1; entryColors['1,' + x] = c2; }
    else if (r === 'RIGHT') { entryColors['1,' + x] = c1; entryColors['1,' + (x + 1)] = c2; }
    else                    { entryColors['1,' + x] = c1; entryColors['1,' + (x - 1)] = c2; }
  }
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 6; col++) {
      const el = document.getElementById(`ce${row}_${col}`);
      if (!el) continue;
      const color = entryColors[`${row},${col}`];
      const base = row === 1 ? 'cell cell-entry cell-entry-bottom' : 'cell cell-entry';
      if (color) {
        el.className = base + ` cell-${color}`;
        el.textContent = color;
      } else {
        el.className = base;
        el.textContent = '';
      }
    }
  }

  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 6; col++) {
      const el = document.getElementById(`c${row}_${col}`);
      if (!el) continue;
      const key = `${row},${col}`;
      const val = game.field[row][col];
      if (val !== '.') {
        el.className = cellClass(val);
        el.textContent = val === '#' ? '×' : val;
      } else if (ghostSet[key]) {
        el.className = `cell cell-ghost-${ghostSet[key]}`;
        el.textContent = ghostSet[key];
      } else {
        el.className = 'cell cell-empty';
        el.textContent = '';
      }
      if (row === 0) el.classList.add('cell-row0');
    }
  }
}

function renderPiecePreview() {
  const el = document.getElementById('piece-display');
  if (!el) return;
  el.innerHTML = '';

  if (!game.currentPiece) {
    el.innerHTML = '<div style="color:#888;font-size:0.75rem">待機中</div>';
    return;
  }

  const { r, pair } = game.currentPiece;
  const [c1, c2] = pair;

  // 2×2 grid: [top-left, top-right, bottom-left, bottom-right]
  // UP:    c2 .  / c1 .    (c1=axis at bottom, c2 above)
  // DOWN:  c1 .  / c2 .    (c2=axis at bottom, c1 above)
  // RIGHT: .  .  / c1 c2
  // LEFT:  .  .  / c2 c1
  let cells;
  if (r === 'UP')    cells = [c2, null, c1, null];
  else if (r === 'DOWN')  cells = [c1, null, c2, null];
  else if (r === 'RIGHT') cells = [null, null, c1, c2];
  else                    cells = [null, null, c2, c1];

  // Actually render as 3-row, 2-col: just show the relevant 2 cells
  const grid = document.createElement('div');
  grid.className = 'piece-display';
  for (const c of cells) {
    const d = document.createElement('div');
    d.className = c ? `piece-cell cell-${c}` : 'piece-cell';
    if (c) d.textContent = c;
    grid.appendChild(d);
  }
  el.appendChild(grid);

  const rot = document.createElement('div');
  rot.className = 'rotation-label';
  rot.textContent = `x=${game.currentPiece.x + 1}  ${r}`;
  el.appendChild(rot);
}

function renderQueue() {
  const el = document.getElementById('next-queue');
  if (!el) return;
  el.innerHTML = '';
  if (settings.nextVisible === 0) {
    el.innerHTML = '<div style="color:#888;font-size:0.75rem">非表示</div>';
    return;
  }
  for (let i = 1; i <= settings.nextVisible; i++) {
    const idx = game.queueIndex + i;
    if (idx >= game.fullQueue.length) break;
    const [c1, c2] = game.fullQueue[idx];
    const div = document.createElement('div');
    div.className = 'next-item';
    div.innerHTML = `<span>${i}</span>
      <div class="mini-cell ${c2}">${c2}</div>
      <div class="mini-cell ${c1}">${c1}</div>`;
    el.appendChild(div);
  }
}

function renderStats() {
  document.getElementById('move-count').textContent = game.moveCount;
  document.getElementById('chain-count').textContent = game.chainCount;
  const sEl = document.getElementById('score-count');
  if (sEl) sEl.textContent = game.totalScore.toLocaleString();
}

function renderAiStatus() {
  const el = document.getElementById('ai-status');
  if (!el) return;
  if (game.aiQuerying) {
    el.textContent = 'AI思考中...';
    el.className = 'ai-status querying';
  } else if (game.aiError) {
    el.textContent = 'AIエラー: ' + game.aiError;
    el.className = 'ai-status error';
  } else if (game.pendingAI) {
    el.textContent = 'AI準備完了';
    el.className = 'ai-status ready';
  } else {
    el.textContent = '';
    el.className = 'ai-status';
  }
}

function render() {
  renderField();
  renderPiecePreview();
  renderQueue();
  renderStats();
  renderAiStatus();

  const placing = !game.animating && !game.gameOver;
  ['left-btn','right-btn','drop-btn','rot-cw-btn','rot-ccw-btn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !placing;
  });
  const undoBtn = document.getElementById('undo-btn');
  if (undoBtn) undoBtn.disabled = game.history.length === 0 || game.animating;
  const redoBtn = document.getElementById('redo-btn');
  if (redoBtn) redoBtn.disabled = game.future.length === 0 || game.animating;
  const resetStartBtn = document.getElementById('reset-start-btn');
  if (resetStartBtn) resetStartBtn.disabled = game.history.length === 0 || game.animating;
  const aiDisabled = game.aiQuerying || game.aiPlaying || game.gameOver;
  ['ask-ai-btn', 'play-ai-btn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = aiDisabled;
  });
  const autoBtn = document.getElementById('auto-play-btn');
  if (autoBtn) {
    autoBtn.textContent = game.autoPlaying ? '■ 停止' : 'オートプレイ';
    autoBtn.disabled = game.gameOver && !game.autoPlaying;
  }
  const garbageBtn = document.getElementById('garbage-mode-btn');
  if (garbageBtn) {
    garbageBtn.textContent = game.garbageMode ? '■ おじゃま置きON' : 'おじゃま置きモード';
    garbageBtn.classList.toggle('active-mode', game.garbageMode);
  }
  const fieldEl = document.getElementById('field');
  if (fieldEl) fieldEl.classList.toggle('garbage-mode', game.garbageMode);
}

// ─── CHAIN ANIMATION ─────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function animateChains(steps) {
  game.animating = true;
  const banner = document.getElementById('chain-banner');

  for (let i = 0; i < steps.length; i++) {
    const { popped, fieldAfter, stepScore } = steps[i];

    for (const key of popped) {
      const [r, c] = key.split(',').map(Number);
      const el = document.getElementById(`c${r}_${c}`);
      if (el) el.className = el.className + ' cell-pop';
    }

    if (banner) {
      banner.innerHTML = `${i + 1}連鎖！<br><span style="font-size:1.1rem">${stepScore.toLocaleString()}点</span>`;
      banner.classList.add('show');
    }

    await sleep(420);

    game.field = fieldAfter;
    if (banner) banner.classList.remove('show');
    renderField();

    await sleep(200);
  }

  game.animating = false;
}

// ─── SETTINGS ────────────────────────────────────────────────────────────────
const settings = {
  beamWidth: 500,
  beamDepth: 24,
  aiTimeoutMs: 10000,
  badMoveThreshold: 0.75,
  weightsMode: 'build',
  noFire: false,
  nextVisible: 2,
};

// ─── KEY CONFIG ───────────────────────────────────────────────────────────────
const DEFAULT_KEYCONFIG = {
  left: 'ArrowLeft',
  right: 'ArrowRight',
  down: 'ArrowDown',
  rotateCW: 'x',
  rotateCCW: 'z',
  undo: 'ArrowUp',
  askAI: 'a',
  playAI: 's',
  newGame: '',
  resetStart: '',
};

let keyConfig = { ...DEFAULT_KEYCONFIG };
try {
  const saved = localStorage.getItem('keyConfig');
  if (saved) keyConfig = { ...DEFAULT_KEYCONFIG, ...JSON.parse(saved) };
} catch {}

function saveKeyConfig() {
  try { localStorage.setItem('keyConfig', JSON.stringify(keyConfig)); } catch {}
}

function keyLabel(binding) {
  if (!binding) return '(未設定)';
  const map = { ArrowLeft: '←', ArrowRight: '→', ArrowDown: '↓', ArrowUp: '↑', ' ': 'Space', Enter: 'Enter', Escape: 'Esc', Control: 'Ctrl', Alt: 'Alt' };
  return binding.split('+').map(p => map[p] || p.toUpperCase()).join('+');
}

// binding形式: "ArrowLeft", "x", "A"(=Shift+a), "Control+z", "Alt+r"
// Shiftはe.keyの大文字/小文字で表現するため別途チェックしない
function matchesKey(e, binding) {
  if (!binding) return false;
  const parts = binding.split('+');
  const mainKey = parts[parts.length - 1];
  const needCtrl = parts.includes('Control');
  const needAlt = parts.includes('Alt');
  return e.key === mainKey && e.ctrlKey === needCtrl && e.altKey === needAlt;
}

// ─── AI (Web Worker) ─────────────────────────────────────────────────────────
let _aiWorkerReady = false;
let _aiWorkerFatalError = null;

const _aiWorker = new Worker('ai-worker.js');
const _aiPending = new Map();
let _aiCallId = 0;

function _showAIFatalError(msg) {
  _aiWorkerFatalError = msg;
  const el = document.getElementById('ai-fatal-banner');
  if (el) {
    el.querySelector('#ai-fatal-msg').textContent = msg;
    el.style.display = 'flex';
  }
}

_aiWorker.onmessage = (e) => {
  if (e.data.type === 'ready') {
    _aiWorkerReady = true;
    return;
  }
  if (e.data.type === 'init_error') {
    _showAIFatalError('AIエンジン初期化失敗: ' + e.data.message);
    for (const [id, callbacks] of _aiPending) {
      _aiPending.delete(id);
      callbacks.reject(new Error(e.data.message));
    }
    return;
  }
  const { id, result, error } = e.data;
  const callbacks = _aiPending.get(id);
  if (!callbacks) return;
  _aiPending.delete(id);
  if (error) callbacks.reject(new Error(error));
  else callbacks.resolve(result);
};

_aiWorker.onerror = (e) => {
  const msg = e.message || 'unknown';
  _showAIFatalError('AIワーカーエラー: ' + msg);
  for (const [id, callbacks] of _aiPending) {
    _aiPending.delete(id);
    callbacks.reject(new Error('AI worker error: ' + msg));
  }
};

async function queryAI(field, queuePairs) {
  const fieldStr = field.map(row => row.join(''));
  const input = JSON.stringify({
    field: fieldStr,
    queue: queuePairs,
    options: { width: settings.beamWidth, depth: settings.beamDepth, weights: settings.weightsMode, no_fire: settings.noFire },
  });
  return new Promise((resolve, reject) => {
    const id = _aiCallId++;
    const timer = setTimeout(() => {
      if (!_aiPending.has(id)) return;
      _aiPending.delete(id);
      reject(new Error('AI timeout'));
    }, settings.aiTimeoutMs);
    _aiPending.set(id, {
      resolve: (r) => { clearTimeout(timer); resolve(JSON.parse(r)); },
      reject:  (e) => { clearTimeout(timer); reject(e); },
    });
    _aiWorker.postMessage({ id, input });
  });
}

async function startAIQuery() {
  if (game.aiQuerying || game.gameOver) return;
  const qi = game.queueIndex;
  // Need at least 2 pairs for the binary
  const queuePairs = game.fullQueue.slice(qi, qi + 4).map(p => [p[0], p[1]]);
  if (queuePairs.length < 2) return;

  game.aiQuerying = true;
  game.pendingAI = null;
  game.aiError = null;
  renderAiStatus();

  try {
    const result = await queryAI(game.field, queuePairs);
    if (result.error) throw new Error(result.error);
    if (game.queueIndex === qi) {
      game.pendingAI = { candidates: result.candidates, forQueueIndex: qi };
    }
  } catch (e) {
    game.aiError = e.message;
  } finally {
    game.aiQuerying = false;
    render();
  }
}

function checkBadMove(candidates, x, r, pair) {
  if (settings.badMoveThreshold <= 0) return null;
  if (!candidates || candidates.length === 0) return null;
  const bestScore = candidates[0].expected_score;
  if (bestScore <= 1000) return null;
  let humanCand = candidates.find(c => c.x === x && c.r === r);
  // 同色ペアの等価配置: UP≡DOWN, RIGHT at x ≡ LEFT at x+1
  if (!humanCand && pair && pair[0] === pair[1]) {
    if      (r === 'UP')    humanCand = candidates.find(c => c.x === x     && c.r === 'DOWN');
    else if (r === 'DOWN')  humanCand = candidates.find(c => c.x === x     && c.r === 'UP');
    else if (r === 'RIGHT') humanCand = candidates.find(c => c.x === x + 1 && c.r === 'LEFT');
    else if (r === 'LEFT')  humanCand = candidates.find(c => c.x === x - 1 && c.r === 'RIGHT');
  }
  const humanScore = humanCand ? humanCand.expected_score : 0;
  const ratio = humanScore / bestScore;
  if (ratio < settings.badMoveThreshold) {
    return {
      bestScore,
      humanScore,
      bestX: candidates[0].x,
      bestR: candidates[0].r,
      ratio,
    };
  }
  return null;
}

function highlightAICandidate(c) {
  document.querySelectorAll('.cell-ai-best').forEach(el => el.classList.remove('cell-ai-best'));
  const ghost = getGhostPositions(game.field, { x: c.x, r: c.r, pair: game.fullQueue[game.queueIndex] });
  if (ghost) {
    for (const g of ghost) {
      const el = document.getElementById(`c${g.row}_${g.col}`);
      if (el) el.classList.add('cell-ai-best');
    }
  }
}

function showAIOverlay(candidates) {
  const overlay = document.getElementById('ai-overlay');
  const list = document.getElementById('ai-candidates');
  if (!overlay || !list) return;

  list.innerHTML = '';
  const top = candidates.slice(0, 5);
  for (let i = 0; i < top.length; i++) {
    const c = top[i];
    const li = document.createElement('li');
    li.className = i === 0 ? 'best' : '';
    li.style.cursor = 'pointer';
    li.title = 'クリックでこの配置に移動';
    li.innerHTML = `
      <div class="rank-badge ${i === 0 ? 'gold' : ''}">${i + 1}</div>
      <div class="cand-detail">
        <strong>x=${c.x + 1}  ${c.r}</strong>
        <div class="cand-score">score: ${c.expected_score.toLocaleString()}</div>
      </div>`;
    li.addEventListener('mouseenter', () => highlightAICandidate(c));
    li.addEventListener('mouseleave', () => highlightAICandidate(top[0]));
    li.addEventListener('click', () => {
      if (game.currentPiece) {
        game.currentPiece = { ...game.currentPiece, x: c.x, r: c.r };
        hideAIOverlay();
      }
    });
    list.appendChild(li);
  }

  overlay.classList.add('active');
  highlightAICandidate(top[0]);
}

function hideAIOverlay() {
  const overlay = document.getElementById('ai-overlay');
  if (overlay) overlay.classList.remove('active');
  // Remove highlights
  document.querySelectorAll('.cell-ai-best').forEach(el => el.classList.remove('cell-ai-best'));
  render();
}

async function onAskAI() {
  if (game.gameOver) return;
  let candidates = game.pendingAI?.candidates;

  if (!candidates) {
    // Query now if not available
    const qi = game.queueIndex;
    const queuePairs = game.fullQueue.slice(qi, qi + 4).map(p => [p[0], p[1]]);
    if (queuePairs.length < 2) return;
    try {
      const result = await queryAI(game.field, queuePairs);
      if (result.error) { alert('AI error: ' + result.error); return; }
      candidates = result.candidates;
    } catch (e) {
      alert('AI error: ' + e.message);
      return;
    }
  }

  showAIOverlay(candidates);
}

async function onPlayAI() {
  if (game.animating || game.gameOver || !game.currentPiece || game.aiPlaying || game.aiQuerying) return;
  const session = game.session;
  game.aiPlaying = true;
  render();

  try {
    let candidates = game.pendingAI?.candidates;

    if (!candidates) {
      const qi = game.queueIndex;
      const queuePairs = game.fullQueue.slice(qi, qi + 4).map(p => [p[0], p[1]]);
      if (queuePairs.length < 2) return;
      try {
        const result = await queryAI(game.field, queuePairs);
        if (result.error) { alert('AI error: ' + result.error); return; }
        candidates = result.candidates;
        if (game.queueIndex === qi) {
          game.pendingAI = { candidates, forQueueIndex: qi };
        }
      } catch (e) {
        alert('AI error: ' + e.message);
        return;
      }
    }

    if (game.session !== session || !game.currentPiece) return;
    if (!candidates || candidates.length === 0) return;

    const best = candidates[0];
    game.currentPiece = { ...game.currentPiece, x: best.x, r: best.r };
    render();
    await sleep(200);

    if (game.session !== session || !game.currentPiece) return;

    await dropCurrentPiece();
  } finally {
    game.aiPlaying = false;
    render();
  }
}

async function onAutoPlay() {
  if (game.autoPlaying) {
    game.autoPlaying = false;
    render();
    return;
  }
  if (game.gameOver || game.animating || game.aiPlaying) return;
  game.autoPlaying = true;
  render();
  const session = game.session;

  while (game.autoPlaying && !game.gameOver && game.session === session) {
    if (game.animating || !game.currentPiece) { await sleep(50); continue; }

    game.aiPlaying = true;
    render();
    try {
      let candidates = game.pendingAI?.candidates;
      if (!candidates) {
        const qi = game.queueIndex;
        const queuePairs = game.fullQueue.slice(qi, qi + 4).map(p => [p[0], p[1]]);
        if (queuePairs.length < 2) break;
        const result = await queryAI(game.field, queuePairs).catch(() => null);
        if (!result || result.error) break;
        candidates = result.candidates;
        if (game.queueIndex === qi) game.pendingAI = { candidates, forQueueIndex: qi };
      }
      if (game.session !== session || !game.currentPiece) break;
      if (!candidates || candidates.length === 0) break;
      const best = candidates[0];
      game.currentPiece = { ...game.currentPiece, x: best.x, r: best.r };
      render();
      await sleep(150);
      if (game.session !== session || !game.currentPiece) break;
      await dropCurrentPiece();
    } finally {
      game.aiPlaying = false;
    }

    if (game.session !== session) break;
    // 悪手ダイアログが開いたら停止
    const badOverlay = document.getElementById('bad-move-overlay');
    if (badOverlay && badOverlay.classList.contains('active')) { game.autoPlaying = false; break; }
    await sleep(200);
  }

  game.autoPlaying = false;
  game.aiPlaying = false;
  render();
}

// ─── GAME ACTIONS ─────────────────────────────────────────────────────────────
function nextPiece() {
  if (game.queueIndex >= game.fullQueue.length) {
    game.gameOver = true;
    render();
    return;
  }
  const pair = game.fullQueue[game.queueIndex];
  game.currentPiece = { x: 2, r: 'UP', pair };

  // Check game over: if both cols of center are full
  if (lowestEmpty(game.field, 2) === -1 && lowestEmpty(game.field, 3) === -1) {
    game.gameOver = true;
    alert('ゲームオーバー！');
    render();
    return;
  }

  if (game.aiEnabled) {
    startAIQuery();  // async, no await
  }
  render();
}

function saveToHistory() {
  game.history.push({
    field: cloneField(game.field),
    queueIndex: game.queueIndex,
    moveCount: game.moveCount,
    chainCount: game.chainCount,
    totalScore: game.totalScore,
    row14: game.row14,
  });
  game.future = [];
}

async function dropCurrentPiece() {
  if (!game.currentPiece || game.animating || game.gameOver) return;

  const { x, r, pair } = game.currentPiece;

  // Check if placement is valid
  const ghost = getGhostPositions(game.field, game.currentPiece);
  if (!ghost) return; // can't place

  const childGoes14th = r === 'UP' && lowestEmpty(game.field, x) === 0;

  // Save for undo
  saveToHistory();

  const prevField = cloneField(game.field);
  const prevQI = game.queueIndex;
  const pendingAI = game.pendingAI;

  // Apply move
  const newField = applyMove(game.field, x, r, pair);
  game.field = newField;
  if (childGoes14th) game.row14 |= (1 << x);
  game.currentPiece = null;
  game.moveCount++;
  game.moves[prevQI] = { pair, x, r };  // ぷよ譜用
  game.queueIndex++;
  game.pendingAI = null;

  render();

  // Run chain simulation
  const { steps, chainCount, totalScore } = popChains(game.field);
  game.chainCount = chainCount;
  game.totalScore += totalScore;

  if (steps.length > 0) {
    await animateChains(steps);
    renderStats();
  } else {
    game.field = game.field; // no-op, already set
  }

  // Bad move check (after animation)
  if (game.aiEnabled && pendingAI && pendingAI.forQueueIndex === prevQI) {
    const bad = checkBadMove(pendingAI.candidates, x, r, pair);
    if (bad) {
      showBadMoveAlert(bad, x, r);
      return; // don't advance to next piece yet
    }
  }

  nextPiece();
}

function showBadMoveAlert(info, humanX, humanR) {
  const overlay = document.getElementById('bad-move-overlay');
  const msg = document.getElementById('bad-move-msg');
  if (!overlay || !msg) return;

  msg.innerHTML = `
    あなたの手: <strong>x=${humanX + 1} ${humanR}</strong>
    (${info.humanScore.toLocaleString()}点)<br>
    AIの最善手: <strong>x=${info.bestX + 1} ${info.bestR}</strong>
    (${info.bestScore.toLocaleString()}点)<br>
    スコア比: <strong>${Math.round(info.ratio * 100)}%</strong>
  `;

  overlay.classList.add('active');

  document.getElementById('undo-alert-btn').onclick = () => {
    overlay.classList.remove('active');
    // Undo the last move
    undoMove();
  };

  document.getElementById('continue-btn').onclick = () => {
    overlay.classList.remove('active');
    nextPiece();
  };
}

function undoMove() {
  if (game.history.length === 0 || game.animating) return;
  // AI思考中でもアンドゥできるようaiQueryingをリセット（古い結果はqueueIndexチェックで弾かれる）
  game.aiQuerying = false;
  game.aiError = null;
  const prevPendingAI = game.pendingAI;
  const snap = game.history.pop();
  game.future.push({
    field: cloneField(game.field),
    queueIndex: game.queueIndex,
    moveCount: game.moveCount,
    chainCount: game.chainCount,
    totalScore: game.totalScore,
    row14: game.row14,
  });
  game.field = snap.field;
  game.queueIndex = snap.queueIndex;
  game.moveCount = snap.moveCount;
  game.chainCount = snap.chainCount;
  game.totalScore = snap.totalScore;
  game.row14 = snap.row14;
  game.pendingAI = (prevPendingAI?.forQueueIndex === snap.queueIndex) ? prevPendingAI : null;
  game.gameOver = false;
  nextPiece();
}

function resetToStart() {
  if (game.history.length === 0 || game.animating) return;
  // undo連打と等価: currentをfutureに積み、historyを逆順にfutureへ移す
  game.future.push({
    field: cloneField(game.field), queueIndex: game.queueIndex,
    moveCount: game.moveCount, chainCount: game.chainCount,
    totalScore: game.totalScore, row14: game.row14,
  });
  while (game.history.length > 1) {
    game.future.push(game.history.pop());
  }
  const snap = game.history.pop();
  game.field = snap.field;
  game.queueIndex = snap.queueIndex;
  game.moveCount = snap.moveCount;
  game.chainCount = snap.chainCount;
  game.totalScore = snap.totalScore;
  game.row14 = snap.row14;
  game.pendingAI = null;
  game.gameOver = false;
  nextPiece();
}

function redoMove() {
  if (game.future.length === 0 || game.animating) return;
  const snap = game.future.pop();
  game.history.push({
    field: cloneField(game.field),
    queueIndex: game.queueIndex,
    moveCount: game.moveCount,
    chainCount: game.chainCount,
    totalScore: game.totalScore,
    row14: game.row14,
  });
  game.field = snap.field;
  game.queueIndex = snap.queueIndex;
  game.moveCount = snap.moveCount;
  game.chainCount = snap.chainCount;
  game.totalScore = snap.totalScore;
  game.row14 = snap.row14;
  game.pendingAI = null;
  game.gameOver = false;
  nextPiece();
}

function startNewGame(seed) {
  game.field = emptyField();
  game.fullQueue = generateQueue(seed);
  game.queueIndex = 0;
  game.currentPiece = null;
  game.history = [];
  game.future = [];
  game.moveCount = 0;
  game.chainCount = 0;
  game.totalScore = 0;
  game.row14 = 0;
  game.animating = false;
  game.gameOver = false;
  game.pendingAI = null;
  game.aiQuerying = false;
  game.aiError = null;
  game.session++;
  game.aiPlaying = false;
  game.autoPlaying = false;
  game.garbageMode = false;
  game.moves = [];
  game.initialField = cloneField(game.field);
  nextPiece();
}

// ─── DOM SETUP ───────────────────────────────────────────────────────────────
function toggleGarbageAt(row, col) {
  if (game.animating) return;
  const cell = game.field[row][col];
  if (cell !== '.' && cell !== '#') return; // 色ぷよは触らない
  const f = cloneField(game.field);
  f[row][col] = cell === '.' ? '#' : '.';
  game.field = f;
  game.pendingAI = null;
  render();
}

// N個のおじゃまを列0→5の順に落とす（重力適用）
function dropGarbageN(n) {
  if (game.animating) return;
  let f = cloneField(game.field);
  for (let i = 0; i < n; i++) {
    const col = i % 6;
    const row = lowestEmpty(f, col);
    if (row !== -1) f[row][col] = '#';
  }
  game.field = f;
  game.pendingAI = null;
  render();
}

function buildField() {
  const fieldEl = document.getElementById('field');
  fieldEl.innerHTML = '';
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 6; col++) {
      const div = document.createElement('div');
      div.id = `ce${row}_${col}`;
      div.className = row === 1 ? 'cell cell-entry cell-entry-bottom' : 'cell cell-entry';
      fieldEl.appendChild(div);
    }
  }
  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 6; col++) {
      const div = document.createElement('div');
      div.id = `c${row}_${col}`;
      div.className = 'cell cell-empty';
      div.addEventListener('click', () => {
        if (game.garbageMode) toggleGarbageAt(row, col);
      });
      fieldEl.appendChild(div);
    }
  }
}

function focusGame() {
  document.getElementById('field').focus({ preventScroll: true });
}

function setupControls() {
  document.getElementById('new-game-btn').addEventListener('click', () => {
    const seed = Math.floor(Math.random() * 65536);
    document.getElementById('seed-input').value = seed;
    startNewGame(seed);
    focusGame();
  });

  document.getElementById('reset-start-btn').addEventListener('click', () => {
    resetToStart();
    focusGame();
  });

  document.getElementById('ai-toggle').addEventListener('change', e => {
    game.aiEnabled = e.target.checked;
    if (game.aiEnabled && game.currentPiece && !game.aiQuerying && !game.pendingAI) {
      startAIQuery();
    }
    focusGame();
  });

  document.getElementById('left-btn').addEventListener('click', () => {
    if (!game.currentPiece || game.animating || game.gameOver) return;
    game.currentPiece = movePiece(game.currentPiece, 'LEFT');
    render();
  });

  document.getElementById('right-btn').addEventListener('click', () => {
    if (!game.currentPiece || game.animating || game.gameOver) return;
    game.currentPiece = movePiece(game.currentPiece, 'RIGHT');
    render();
  });

  document.getElementById('drop-btn').addEventListener('click', () => {
    dropCurrentPiece();
  });

  document.getElementById('rot-cw-btn').addEventListener('click', () => {
    if (!game.currentPiece || game.animating || game.gameOver) return;
    game.currentPiece = rotatePiece(game.currentPiece, 'CW');
    render();
  });

  document.getElementById('rot-ccw-btn').addEventListener('click', () => {
    if (!game.currentPiece || game.animating || game.gameOver) return;
    game.currentPiece = rotatePiece(game.currentPiece, 'CCW');
    render();
  });

  document.getElementById('undo-btn').addEventListener('click', undoMove);
  document.getElementById('redo-btn').addEventListener('click', redoMove);

  // Settings sliders
  const beamWidthEl = document.getElementById('beam-width');
  const beamDepthEl = document.getElementById('beam-depth');
  const badThresholdEl = document.getElementById('bad-threshold');
  if (beamWidthEl) {
    beamWidthEl.addEventListener('input', () => {
      settings.beamWidth = parseInt(beamWidthEl.value);
      document.getElementById('beam-width-val').textContent = beamWidthEl.value;
    });
    beamWidthEl.addEventListener('change', focusGame);
  }
  if (beamDepthEl) {
    beamDepthEl.addEventListener('input', () => {
      settings.beamDepth = parseInt(beamDepthEl.value);
      document.getElementById('beam-depth-val').textContent = beamDepthEl.value;
    });
    beamDepthEl.addEventListener('change', focusGame);
  }
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const w = parseInt(btn.dataset.w);
      const d = parseInt(btn.dataset.d);
      settings.beamWidth = w;
      settings.beamDepth = d;
      if (beamWidthEl) { beamWidthEl.value = w; document.getElementById('beam-width-val').textContent = w; }
      if (beamDepthEl) { beamDepthEl.value = d; document.getElementById('beam-depth-val').textContent = d; }
      focusGame();
    });
  });
  const aiTimeoutEl = document.getElementById('ai-timeout');
  if (aiTimeoutEl) {
    aiTimeoutEl.addEventListener('input', () => {
      settings.aiTimeoutMs = parseInt(aiTimeoutEl.value) * 1000;
      document.getElementById('ai-timeout-val').textContent = aiTimeoutEl.value + 's';
    });
    aiTimeoutEl.addEventListener('change', focusGame);
  }
  if (badThresholdEl) {
    badThresholdEl.addEventListener('input', () => {
      settings.badMoveThreshold = parseInt(badThresholdEl.value) / 100;
      const label = badThresholdEl.value === '0' ? 'OFF' : badThresholdEl.value + '%';
      document.getElementById('bad-threshold-val').textContent = label;
    });
    badThresholdEl.addEventListener('change', focusGame);
  }

  const aiModeEl = document.getElementById('ai-mode');
  if (aiModeEl) {
    aiModeEl.addEventListener('change', () => {
      settings.weightsMode = aiModeEl.value;
      game.pendingAI = null;
      if (game.aiEnabled && game.currentPiece) startAIQuery();
      focusGame();
    });
  }

  const noFireEl = document.getElementById('no-fire-toggle');
  if (noFireEl) {
    noFireEl.addEventListener('change', () => {
      settings.noFire = noFireEl.checked;
      game.pendingAI = null;
      if (game.aiEnabled && game.currentPiece) startAIQuery();
      focusGame();
    });
  }

  // キーコンフィグUI初期化
  let keyCaptureAction = null;
  function updateKeyconfigButtons() {
    document.querySelectorAll('.keyconfig-btn').forEach(btn => {
      const action = btn.dataset.action;
      btn.textContent = keyLabel(keyConfig[action]);
      btn.classList.toggle('waiting', keyCaptureAction === action);
    });
  }
  updateKeyconfigButtons();

  document.querySelectorAll('.keyconfig-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      keyCaptureAction = btn.dataset.action;
      updateKeyconfigButtons();
    });
  });

  document.addEventListener('keydown', e => {
    if (!keyCaptureAction) return;
    if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return;
    e.preventDefault();
    // Ctrl/AltをプレフィックスとしてBinding文字列に含める。Shiftはe.keyの大文字で表現
    const parts = [];
    if (e.ctrlKey) parts.push('Control');
    if (e.altKey) parts.push('Alt');
    parts.push(e.key);
    keyConfig[keyCaptureAction] = parts.join('+');
    saveKeyConfig();
    keyCaptureAction = null;
    updateKeyconfigButtons();
  }, true); // capture phaseで処理してゲーム操作より先に捕捉

  document.getElementById('ask-ai-btn').addEventListener('click', onAskAI);
  document.getElementById('play-ai-btn').addEventListener('click', onPlayAI);
  document.getElementById('close-ai-btn').addEventListener('click', hideAIOverlay);
  document.getElementById('auto-play-btn').addEventListener('click', onAutoPlay);

  document.getElementById('garbage-mode-btn').addEventListener('click', () => {
    game.garbageMode = !game.garbageMode;
    render();
    focusGame();
  });

  document.getElementById('drop-garbage-btn').addEventListener('click', () => {
    const n = parseInt(document.getElementById('garbage-count').value) || 6;
    dropGarbageN(n);
    focusGame();
  });

  document.getElementById('puyop-url-btn').addEventListener('click', () => {
    if (game.queueIndex === 0) { alert('まだ手が置かれていません'); return; }
    const url = generatePuyopURL();
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.getElementById('puyop-url-btn');
      const orig = btn.textContent;
      btn.textContent = 'コピー完了！';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }).catch(() => {
      prompt('ぷよ譜URL:', url);
    });
    focusGame();
  });

  const nextVisibleEl = document.getElementById('next-visible');
  if (nextVisibleEl) {
    nextVisibleEl.addEventListener('change', () => {
      settings.nextVisible = parseInt(nextVisibleEl.value);
      renderQueue();
      focusGame();
    });
  }

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;

    // Bad-move overlay が開いているときのショートカット
    const badOverlay = document.getElementById('bad-move-overlay');
    if (badOverlay && badOverlay.classList.contains('active')) {
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        document.getElementById('undo-alert-btn').click();
      } else if (e.key === 'Enter' || e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        document.getElementById('continue-btn').click();
      }
      return;
    }

    // AI overlay が開いているときはAsk AIキーまたはEsc/Enterで閉じる
    const aiOverlay = document.getElementById('ai-overlay');
    if (aiOverlay && aiOverlay.classList.contains('active')) {
      if (e.key === 'Escape' || e.key === 'Enter' || matchesKey(e, keyConfig.askAI)) {
        e.preventDefault();
        hideAIOverlay();
      }
      return;
    }

    // Undo/Redo（アニメーション中でも操作できるよう先に処理）
    if (matchesKey(e, keyConfig.undo) || ((e.ctrlKey || e.metaKey) && e.key === 'z')) {
      e.preventDefault();
      undoMove();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
      e.preventDefault();
      redoMove();
      return;
    }

    if (game.animating || game.gameOver) return;

    if (matchesKey(e, keyConfig.left)) {
      e.preventDefault();
      if (game.currentPiece) { game.currentPiece = movePiece(game.currentPiece, 'LEFT'); render(); }
    } else if (matchesKey(e, keyConfig.right)) {
      e.preventDefault();
      if (game.currentPiece) { game.currentPiece = movePiece(game.currentPiece, 'RIGHT'); render(); }
    } else if (matchesKey(e, keyConfig.down) || e.key === ' ') {
      e.preventDefault();
      dropCurrentPiece();
    } else if (matchesKey(e, keyConfig.rotateCW)) {
      e.preventDefault();
      if (game.currentPiece) { game.currentPiece = rotatePiece(game.currentPiece, 'CW'); render(); }
    } else if (matchesKey(e, keyConfig.rotateCCW)) {
      e.preventDefault();
      if (game.currentPiece) { game.currentPiece = rotatePiece(game.currentPiece, 'CCW'); render(); }
    } else if (matchesKey(e, keyConfig.askAI)) {
      e.preventDefault();
      if (!game.aiQuerying && !game.aiPlaying) onAskAI();
    } else if (matchesKey(e, keyConfig.playAI)) {
      e.preventDefault();
      if (!game.aiQuerying && !game.aiPlaying) onPlayAI();
    } else if (keyConfig.newGame && matchesKey(e, keyConfig.newGame)) {
      e.preventDefault();
      document.getElementById('new-game-btn').click();
    } else if (keyConfig.resetStart && matchesKey(e, keyConfig.resetStart)) {
      e.preventDefault();
      document.getElementById('reset-start-btn').click();
    }
  });
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // last updated表示
  const bdEl = document.getElementById('build-date');
  if (bdEl) bdEl.textContent = BUILD_DATE;

  // SharedArrayBuffer / crossOriginIsolated チェック
  if (!self.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const iosNote = isIOS
      ? 'iOS Safariではサービスワーカー経由のクロスオリジン分離が正しく動作しない既知の問題があります。' +
        'PCブラウザ（Chrome/Firefox）を試してください。'
      : 'ページをリロード（Ctrl+Shift+R）すると解決することがあります。';
    _showAIFatalError(
      'AIエンジンが起動できません: クロスオリジン分離が無効です（SharedArrayBuffer 利用不可）。' +
      iosNote +
      ' [crossOriginIsolated=' + self.crossOriginIsolated + ']'
    );
  }

  buildField();
  setupControls();

  // Read seed from URL if present
  const params = new URLSearchParams(window.location.search);
  const urlSeed = params.get('seed');
  const seed = urlSeed ? parseInt(urlSeed) : Math.floor(Math.random() * 65536);
  document.getElementById('seed-input').value = seed;

  startNewGame(seed);
  focusGame();
});
