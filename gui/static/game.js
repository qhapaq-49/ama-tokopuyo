'use strict';

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

function generateQueue(seed, count = 200) {
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
  for (let row = 0; row < 13; row++) {
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
            if (nr >= 0 && nr < 13 && nc >= 0 && nc < 6 &&
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
    if (r === 'UP') {
      const cells = [{ row: row1, col: x, color: c1 }];
      if (row2 >= 0) cells.push({ row: row2, col: x, color: c2 });
      return cells;
    } else {
      const cells = [{ row: row1, col: x, color: c2 }];
      if (row2 >= 0) cells.push({ row: row2, col: x, color: c1 });
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
  totalGarbage: 0,
  animating: false,
  gameOver: false,
  aiEnabled: false,
  pendingAI: null,    // {candidates, forQueueIndex} or null
  aiQuerying: false,
  aiError: null,
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
  for (let i = 1; i <= 2; i++) {
    const idx = game.queueIndex + i;
    if (idx >= game.fullQueue.length) break;
    const [c1, c2] = game.fullQueue[idx];
    const div = document.createElement('div');
    div.className = 'next-item';
    div.innerHTML = `<span>${i}</span>
      <div class="mini-cell ${c1}">${c1}</div>
      <div class="mini-cell ${c2}">${c2}</div>`;
    el.appendChild(div);
  }
}

function renderStats() {
  document.getElementById('move-count').textContent = game.moveCount;
  document.getElementById('chain-count').textContent = game.chainCount;
  const gEl = document.getElementById('garbage-count');
  if (gEl) gEl.textContent = game.totalGarbage;
}

function renderAiStatus() {
  const el = document.getElementById('ai-status');
  if (!el) return;
  if (game.aiQuerying) {
    el.textContent = 'AI思考中...';
    el.className = 'ai-status querying';
  } else if (game.aiError) {
    el.textContent = 'AIエラー';
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
}

// ─── CHAIN ANIMATION ─────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function animateChains(steps, garbageSent) {
  game.animating = true;
  const banner = document.getElementById('chain-banner');

  for (let i = 0; i < steps.length; i++) {
    const { popped, fieldAfter, stepScore } = steps[i];
    const isLast = i === steps.length - 1;

    for (const key of popped) {
      const [r, c] = key.split(',').map(Number);
      const el = document.getElementById(`c${r}_${c}`);
      if (el) el.className = el.className + ' cell-pop';
    }

    if (banner) {
      const garbageLine = isLast && garbageSent > 0 ? `<br><span style="font-size:1.1rem">おじゃま ${garbageSent} 個分</span>` : '';
      banner.innerHTML = `${i + 1}連鎖！${garbageLine}`;
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
  beamWidth: 250,
  beamDepth: 16,
  badMoveThreshold: 0.75,
  weightsMode: 'build',
  noFire: false,
  fireThreshold: 5000,
};

// ─── FIRE THRESHOLD FILTER ───────────────────────────────────────────────────
function applyFireThreshold(candidates, field, pair) {
  if (settings.fireThreshold <= 0 || settings.noFire) return candidates;
  const filtered = candidates.filter(c => {
    const newField = applyMove(field, c.x, c.r, pair);
    const { chainCount, totalScore } = popChains(newField);
    if (chainCount === 0) return true;
    return totalScore >= settings.fireThreshold;
  });
  return filtered.length > 0 ? filtered : candidates;
}

// ─── AI (Web Worker) ─────────────────────────────────────────────────────────
const _aiWorker = new Worker('ai-worker.js');
const _aiPending = new Map();
let _aiCallId = 0;

_aiWorker.onmessage = (e) => {
  const { id, result, error } = e.data;
  const callbacks = _aiPending.get(id);
  if (!callbacks) return;
  _aiPending.delete(id);
  if (error) callbacks.reject(new Error(error));
  else callbacks.resolve(result);
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
    _aiPending.set(id, {
      resolve: (r) => resolve(JSON.parse(r)),
      reject,
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
      const filtered = applyFireThreshold(result.candidates, game.field, game.fullQueue[qi]);
      game.pendingAI = { candidates: filtered, forQueueIndex: qi };
    }
  } catch (e) {
    game.aiError = e.message;
  } finally {
    game.aiQuerying = false;
    renderAiStatus();
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
    li.innerHTML = `
      <div class="rank-badge ${i === 0 ? 'gold' : ''}">${i + 1}</div>
      <div class="cand-detail">
        <strong>x=${c.x + 1}  ${c.r}</strong>
        <div class="cand-score">score: ${c.expected_score.toLocaleString()}</div>
      </div>`;
    list.appendChild(li);
  }

  overlay.classList.add('active');

  // Highlight best on field
  const best = candidates[0];
  const ghost = getGhostPositions(game.field, { x: best.x, r: best.r, pair: game.fullQueue[game.queueIndex] });
  if (ghost) {
    for (const g of ghost) {
      const el = document.getElementById(`c${g.row}_${g.col}`);
      if (el) el.classList.add('cell-ai-best');
    }
  }
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
      candidates = applyFireThreshold(result.candidates, game.field, game.fullQueue[qi]);
    } catch (e) {
      alert('AI error: ' + e.message);
      return;
    }
  }

  showAIOverlay(candidates);
}

async function onPlayAI() {
  if (game.animating || game.gameOver || !game.currentPiece) return;
  let candidates = game.pendingAI?.candidates;

  if (!candidates) {
    const qi = game.queueIndex;
    const queuePairs = game.fullQueue.slice(qi, qi + 4).map(p => [p[0], p[1]]);
    if (queuePairs.length < 2) return;
    try {
      const result = await queryAI(game.field, queuePairs);
      if (result.error) { alert('AI error: ' + result.error); return; }
      candidates = applyFireThreshold(result.candidates, game.field, game.fullQueue[qi]);
      if (game.queueIndex === qi) {
        game.pendingAI = { candidates, forQueueIndex: qi };
      }
    } catch (e) {
      alert('AI error: ' + e.message);
      return;
    }
  }

  const best = candidates[0];
  game.currentPiece = { ...game.currentPiece, x: best.x, r: best.r };
  render();
  // Short delay so the player can see the piece move, then drop
  await sleep(200);
  dropCurrentPiece();
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
    totalGarbage: game.totalGarbage,
  });
  game.future = [];
}

async function dropCurrentPiece() {
  if (!game.currentPiece || game.animating || game.gameOver) return;

  const { x, r, pair } = game.currentPiece;

  // Check if placement is valid
  const ghost = getGhostPositions(game.field, game.currentPiece);
  if (!ghost) return; // can't place

  // Save for undo
  saveToHistory();

  const prevField = cloneField(game.field);
  const prevQI = game.queueIndex;
  const pendingAI = game.pendingAI;

  // Apply move
  const newField = applyMove(game.field, x, r, pair);
  game.field = newField;
  game.currentPiece = null;
  game.moveCount++;
  game.queueIndex++;
  game.pendingAI = null;

  render();

  // Run chain simulation
  const { steps, chainCount, garbageSent } = popChains(game.field);
  game.chainCount += chainCount;
  game.totalGarbage += garbageSent;

  if (steps.length > 0) {
    await animateChains(steps, garbageSent);
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
  const snap = game.history.pop();
  game.future.push({
    field: cloneField(game.field),
    queueIndex: game.queueIndex,
    moveCount: game.moveCount,
    chainCount: game.chainCount,
    totalGarbage: game.totalGarbage,
  });
  game.field = snap.field;
  game.queueIndex = snap.queueIndex;
  game.moveCount = snap.moveCount;
  game.chainCount = snap.chainCount;
  game.totalGarbage = snap.totalGarbage;
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
    totalGarbage: game.totalGarbage,
  });
  game.field = snap.field;
  game.queueIndex = snap.queueIndex;
  game.moveCount = snap.moveCount;
  game.chainCount = snap.chainCount;
  game.totalGarbage = snap.totalGarbage;
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
  game.totalGarbage = 0;
  game.animating = false;
  game.gameOver = false;
  game.pendingAI = null;
  game.aiQuerying = false;
  game.aiError = null;
  nextPiece();
}

// ─── DOM SETUP ───────────────────────────────────────────────────────────────
function buildField() {
  const fieldEl = document.getElementById('field');
  fieldEl.innerHTML = '';
  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 6; col++) {
      const div = document.createElement('div');
      div.id = `c${row}_${col}`;
      div.className = 'cell cell-empty';
      fieldEl.appendChild(div);
    }
  }
}

function focusGame() {
  document.getElementById('field').focus({ preventScroll: true });
}

function setupControls() {
  document.getElementById('new-game-btn').addEventListener('click', () => {
    const seed = parseInt(document.getElementById('seed-input').value) || 42;
    startNewGame(seed);
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

  const fireThresholdEl = document.getElementById('fire-threshold');
  if (fireThresholdEl) {
    fireThresholdEl.addEventListener('input', () => {
      settings.fireThreshold = parseInt(fireThresholdEl.value);
      const label = settings.fireThreshold === 0 ? 'OFF' : settings.fireThreshold.toLocaleString();
      document.getElementById('fire-threshold-val').textContent = label;
    });
    fireThresholdEl.addEventListener('change', focusGame);
  }

  document.getElementById('ask-ai-btn').addEventListener('click', onAskAI);
  document.getElementById('play-ai-btn').addEventListener('click', onPlayAI);
  document.getElementById('close-ai-btn').addEventListener('click', hideAIOverlay);

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

    // AI overlay が開いているときはEscで閉じる
    const aiOverlay = document.getElementById('ai-overlay');
    if (aiOverlay && aiOverlay.classList.contains('active')) {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        hideAIOverlay();
      }
      return;
    }

    if (game.animating || game.gameOver) return;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        if (game.currentPiece) { game.currentPiece = movePiece(game.currentPiece, 'LEFT'); render(); }
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (game.currentPiece) { game.currentPiece = movePiece(game.currentPiece, 'RIGHT'); render(); }
        break;
      case 'ArrowDown':
      case ' ':
        e.preventDefault();
        dropCurrentPiece();
        break;
      case 'x': case 'X':
        if (game.currentPiece) { game.currentPiece = rotatePiece(game.currentPiece, 'CW'); render(); }
        break;
      case 'z': case 'Z':
        if (!e.ctrlKey && !e.metaKey) {
          if (game.currentPiece) { game.currentPiece = rotatePiece(game.currentPiece, 'CCW'); render(); }
        }
        break;
      case 'a': case 'A':
        if (e.shiftKey) onPlayAI();
        else onAskAI();
        break;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      undoMove();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
      e.preventDefault();
      redoMove();
    }
  });
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  buildField();
  setupControls();

  // Read seed from URL if present
  const params = new URLSearchParams(window.location.search);
  const urlSeed = params.get('seed');
  const seed = urlSeed ? parseInt(urlSeed) : Math.floor(Math.random() * 0xFFFFFF);
  document.getElementById('seed-input').value = seed;

  startNewGame(seed);
  focusGame();
});
