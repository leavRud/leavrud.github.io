// Фон главного экрана: рой коней с пешками и фигурный снегопад.
'use strict';

/* ---- Декоративные кони на фоне ---- */
let figureState = null;

// Телефоны и планшеты: мыши нет, поэтому кони ходят на автопилоте, а палец
// их направляет. На ПК поведение прежнее — кони всегда идут за мышью.
const HOME_TOUCH_MEDIA = window.matchMedia('(hover: none) and (pointer: coarse)');
const HOME_FINGER_HOLD_MS = 1500;   // столько после касания кони слушаются пальца
const HOME_AUTOPILOT_EVERY = 4;     // на автопилоте конь прыгает раз в 4 тика (200 мс)

function computeHomeGrid(layer) {
  const rect = layer.getBoundingClientRect();
  const containerWidth = rect.width;
  const containerHeight = rect.height;
  const rows = 24;
  const cellH = containerHeight / rows;
  // Клетки фона рисует CSS. Размер берём отсюда же: на телефонах 100vh в CSS
  // больше видимой высоты (адресная строка), и фигуры уезжали бы с клеток.
  const bg = document.querySelector('.home-board-bg');
  if (bg) bg.style.setProperty('--cell', `${cellH}px`);
  if (HOME_TOUCH_MEDIA.matches) {
    // На портретном телефоне «не меньше 24 колонок» даёт клетки-полоски
    // шириной ~16px. Там клетки квадратные и точно совпадают с фоном, а
    // неполная клетка у правого края остаётся пустой.
    const cols = Math.max(6, Math.floor(containerWidth / cellH));
    return { rect, rows, cols, cellW: cellH, cellH };
  }
  const cols = Math.max(rows, Math.round(containerWidth / cellH));
  const cellW = containerWidth / cols;
  return { rect, rows, cols, cellW, cellH };
}

function initHomeFigures() {
  const layer = document.getElementById('homeKnights');
  if (!layer) return;
  stopHomeFigures();
  stopHomeSnow();
  layer.innerHTML = '';
  if (state.settings.homeBackground === 'snow') {
    startHomeSnow();
    return;
  }

  const { rect, rows, cols, cellW, cellH } = computeHomeGrid(layer);

  const figures = [];
  const numKnights = 12;
  const centerRow = Math.floor(rows / 2);
  const centerCol = Math.floor(cols / 2);
  for (let i = 0; i < numKnights; i++) {
    const el = document.createElement('div');
    el.className = 'home-figure home-sputnik';
    el.textContent = '♞';
    el.style.fontSize = '30px';
    layer.appendChild(el);
    let row = centerRow + Math.floor(Math.random() * 8) - 4;
    let col = centerCol + Math.floor(Math.random() * 8) - 4;
    row = clamp(row, 0, rows - 1);
    col = clamp(col, 0, cols - 1);
    figures.push({ el, row, col, type: 'knight', prevRow: row, prevCol: col });
  }

  figureState = {
    figures,
    enemies: [],
    rows,
    cols,
    cellW,
    cellH,
    mouseCol: Math.floor(cols / 2),
    mouseRow: Math.floor(rows / 2),
    containerRect: rect,
    lastMovedEnemy: null, // какая пешка ходила последней
    lastMovedStreak: 0,   // сколько раз подряд ходила именно она
    touchMode: HOME_TOUCH_MEDIA.matches,
    lastFingerAt: -Infinity,
    tick: 0,
  };

  positionFigures();
  if (state.settings.homeEnemies) startEnemySpawner();

  if (homeAnimationInterval) clearInterval(homeAnimationInterval);
  homeAnimationInterval = setInterval(() => {
    if (figureState) updateFigures();
  }, 50);

  window.addEventListener('mousemove', onHomeMouseMove);
  window.addEventListener('touchstart', onHomeTouch, { passive: true });
  window.addEventListener('touchmove', onHomeTouch, { passive: true });
  window.addEventListener('resize', onHomeResize);
}

function stopHomeFigures() {
  if (figureState) {
    window.removeEventListener('mousemove', onHomeMouseMove);
    window.removeEventListener('touchstart', onHomeTouch);
    window.removeEventListener('touchmove', onHomeTouch);
    window.removeEventListener('resize', onHomeResize);
    figureState.enemies.forEach(enemy => enemy.el.remove());
    figureState = null;
  }
  if (homeAnimationInterval) {
    clearInterval(homeAnimationInterval);
    homeAnimationInterval = null;
  }
  stopEnemySpawner();
}


/* ---- Вражеские пешки на главном экране ---- */
let enemySpawnInterval = null;
let enemyMoveInterval = null;
const HOME_ENEMY_MAX = 90;
const BASE_SPAWN_MS = 1400;
const FAST_SPAWN_MS = 600;
const BASE_MOVE_MS = 150;
const FAST_MOVE_MS = 50;
const HOME_ENEMY_KILL_RADIUS_FACTOR = 0.9;
const HOME_MAX_TOP_ROWS = 8;
let currentSpawnMs = BASE_SPAWN_MS;
let currentMoveMs = BASE_MOVE_MS;

function startEnemySpawner() {
  if (enemySpawnInterval) clearInterval(enemySpawnInterval);
  if (enemyMoveInterval) clearInterval(enemyMoveInterval);
  
  enemySpawnInterval = setInterval(() => {
    spawnHomeEnemy();
    restartEnemyTimers(); // пересчёт после спавна
  }, currentSpawnMs);
  
  enemyMoveInterval = setInterval(() => {
    advanceHomeEnemies();
    restartEnemyTimers(); // пересчёт после движения
  }, currentMoveMs);
}

function stopEnemySpawner() {
  if (enemySpawnInterval) {
    clearInterval(enemySpawnInterval);
    enemySpawnInterval = null;
  }
  if (enemyMoveInterval) {
    clearInterval(enemyMoveInterval);
    enemyMoveInterval = null;
  }
}
function restartEnemyTimers() {
  if (!figureState) return;
  
  // Новые интервалы на основе текущего состояния
  let newSpawn = BASE_SPAWN_MS;
  let newMove = BASE_MOVE_MS;
  
  const topRowsCount = figureState.enemies.filter(e => e.row === 0 || e.row === 1).length;
  if (topRowsCount < 2) newSpawn = FAST_SPAWN_MS;
  
  const totalEnemies = figureState.enemies.length;
  if (totalEnemies > 30) newMove = FAST_MOVE_MS;
  
  // Если интервалы изменились — перезапускаем таймеры
  if (newSpawn !== currentSpawnMs || newMove !== currentMoveMs) {
    currentSpawnMs = newSpawn;
    currentMoveMs = newMove;
    stopEnemySpawner();
    startEnemySpawner();
  }
}

function spawnHomeEnemy() {
  if (!state.settings.homeEnemies) return;
  if (!figureState || figureState.enemies.length >= HOME_ENEMY_MAX) return;
  const layer = document.getElementById('homeKnights');
  if (!layer) return;
  const { cols, enemies } = figureState;

  const occupiedCols = new Set(enemies.filter(e => e.row === 0).map(e => e.col));
  let col, tries = 0;
  do {
    col = Math.floor(Math.random() * cols);
    tries++;
  } while ((occupiedCols.has(col) || isHomeCellOccupied(0, col)) && tries < 20);
  if (occupiedCols.has(col) || isHomeCellOccupied(0, col)) return;

  const el = document.createElement('div');
  el.className = 'home-figure home-enemy';
  el.textContent = '♟';
  layer.appendChild(el);

  const enemy = { el, row: -1, col, x: 0, y: 0 };
  positionHomeEnemy(enemy);
  figureState.enemies.push(enemy);
  requestAnimationFrame(() => el.classList.add('is-spawned'));
}

function positionHomeEnemy(enemy) {
  if (!figureState) return;
  const { cellW, cellH } = figureState;
  const x = enemy.col * cellW + cellW / 2;
  const y = enemy.row * cellH + cellH / 2;
  enemy.x = x;
  enemy.y = y;
  enemy.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
}

let enemyMoveCursor = 0;

const HOME_ENEMY_MAX_STREAK = 3; // одна и та же пешка не ходит более 3 раз подряд

function advanceHomeEnemies() {
  if (!figureState || !figureState.enemies.length) return;

  const { rows, enemies } = figureState;

  // Пешка, которая уже отходила максимум ходов подряд, временно исключается
  // из кандидатов на ход — но только если есть кем её заменить (иначе,
  // если на доске всего одна пешка, ей всё равно придётся ходить).
  let candidates = enemies;
  if (figureState.lastMovedEnemy && figureState.lastMovedStreak >= HOME_ENEMY_MAX_STREAK) {
    const others = enemies.filter(e => e !== figureState.lastMovedEnemy);
    if (others.length) candidates = others;
  }

  const enemy = candidates[Math.floor(Math.random() * candidates.length)];
  if (!enemy) return;

  if (enemy === figureState.lastMovedEnemy) {
    figureState.lastMovedStreak += 1;
  } else {
    figureState.lastMovedEnemy = enemy;
    figureState.lastMovedStreak = 1;
  }

  const nextRow = enemy.row + 1;

  if (nextRow >= rows + 1) {
    enemy.el.remove();
    figureState.enemies = enemies.filter(e => e !== enemy);
    if (figureState.lastMovedEnemy === enemy) {
      figureState.lastMovedEnemy = null;
      figureState.lastMovedStreak = 0;
    }
    return;
  }

  if (!isHomeCellOccupied(nextRow, enemy.col)) {
    enemy.row = nextRow;
    positionHomeEnemy(enemy);
  }
}

function checkHomeEnemyCatches() {
  if (!figureState || !figureState.enemies.length) return;
  const radius = Math.max(figureState.cellW, figureState.cellH) * HOME_ENEMY_KILL_RADIUS_FACTOR;
  const survivors = [];
  for (const enemy of figureState.enemies) {
    const caughtByKnight = figureState.figures.some(fig => {
      // На телефоне конь ест только пешку на своей клетке
      if (figureState.touchMode) return fig.row === enemy.row && fig.col === enemy.col;
      const fx = fig.col * figureState.cellW + figureState.cellW / 2;
      const fy = fig.row * figureState.cellH + figureState.cellH / 2;
      return Math.hypot(fx - enemy.x, fy - enemy.y) <= radius;
    });
    if (caughtByKnight) {
      killHomeEnemy(enemy, true);
    } else {
      survivors.push(enemy);
    }
  }
  figureState.enemies = survivors;
}

function killHomeEnemy(enemy, byKnight) {
  enemy.el.classList.add('is-dying');
  enemy.el.classList.remove('is-spawned');
  setTimeout(() => enemy.el.remove(), 250);
  if (byKnight && window.Achievements) window.Achievements.track('homeEnemyKill', {});
}

function onHomeMouseMove(e) {
  if (!figureState) return;
  const { cellW, cellH, cols, rows, containerRect } = figureState;
  const x = e.clientX - containerRect.left;
  const y = e.clientY - containerRect.top;
  const col = clamp(Math.round(x / cellW), 0, cols - 1);
  const row = clamp(Math.round(y / cellH), 0, rows - 1);
  figureState.mouseCol = col;
  figureState.mouseRow = row;
}

function onHomeTouch(e) {
  if (!figureState || !e.touches.length) return;
  const t = e.touches[0];
  onHomeMouseMove({ clientX: t.clientX, clientY: t.clientY });
  figureState.lastFingerAt = performance.now();
}

function onHomeResize() {
  if (!figureState) return;
  const layer = document.getElementById('homeKnights');
  if (!layer) return;
  const { rect, rows, cols, cellW, cellH } = computeHomeGrid(layer);
  Object.assign(figureState, {
    rows,
    cols,
    cellW,
    cellH,
    containerRect: rect,
  });
  for (const fig of figureState.figures) {
    fig.col = clamp(fig.col, 0, cols - 1);
    fig.row = clamp(fig.row, 0, rows - 1);
  }
  positionFigures();
  for (const enemy of figureState.enemies) {
    enemy.col = clamp(enemy.col, 0, cols - 1);
    // row не ограничиваем, чтобы пешка могла уйти за границу
    positionHomeEnemy(enemy);
  }
}

function positionFigures() {
  if (!figureState) return;
  const { figures, cellW, cellH } = figureState;
  for (const fig of figures) {
    const x = fig.col * cellW + cellW / 2;
    const y = fig.row * cellH + cellH / 2;
    fig.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  }
}

function getRawMoves(type, row, col, rows, cols) {
  const moves = [];
  if (type === 'knight') {
    const deltas = [
      [1,2],[2,1],[2,-1],[1,-2],
      [-1,-2],[-2,-1],[-2,1],[-1,2]
    ];
    for (const [dc, dr] of deltas) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        moves.push({ row: nr, col: nc });
      }
    }
  }
  return moves;
}

function isOccupied(cell, figures, self) {
  for (const other of figures) {
    if (other === self) continue;
    if (other.row === cell.row && other.col === cell.col) return true;
  }
  return false;
}

function chooseBestMove(moves, target, exclude) {
  if (moves.length === 0) return null;
  let filtered = moves;
  if (exclude) {
    const filteredMoves = moves.filter(m => !(m.row === exclude.row && m.col === exclude.col));
    if (filteredMoves.length > 0) filtered = filteredMoves;
  }
  let bestDist = Infinity;
  let bestMoves = [];
  for (const m of filtered) {
    const dist = Math.abs(m.row - target.row) + Math.abs(m.col - target.col);
    if (dist < bestDist) {
      bestDist = dist;
      bestMoves = [m];
    } else if (dist === bestDist) {
      bestMoves.push(m);
    }
  }
  return bestMoves.length ? bestMoves[Math.floor(Math.random() * bestMoves.length)] : null;
}

function stepFigure(fig, target, figures, rows, cols) {
  if (fig.row === target.row && fig.col === target.col) return;
  const raw = getRawMoves(fig.type, fig.row, fig.col, rows, cols);
  const legal = raw.filter(m => !isOccupied(m, figures, fig));
  const exclude = { row: fig.prevRow, col: fig.prevCol };
  let next = chooseBestMove(legal, target, exclude);
  if (!next) {
    next = chooseBestMove(legal, target, null);
  }
  if (next) {
    fig.prevRow = fig.row;
    fig.prevCol = fig.col;
    fig.row = next.row;
    fig.col = next.col;
  }
}

function updateFigures() {
  if (!figureState) return;
  figureState.tick++;
  const fingerIdle = performance.now() - figureState.lastFingerAt > HOME_FINGER_HOLD_MS;
  if (figureState.touchMode && fingerIdle && figureState.enemies.some(e => e.row >= 0)) {
    if (figureState.tick % HOME_AUTOPILOT_EVERY === 0) updateFiguresAutopilot();
    else checkHomeEnemyCatches();
    return;
  }
  const { figures, rows, cols, mouseCol, mouseRow } = figureState;
  const offsets = [
    [0,2],[-1,1],[0,1],[1,1],
    [-2,0],[-1,0],[1,0],[2,0],
    [0,-2],[-1,-1],[0,-1],[1,-1]
  ];
  const validOffsets = offsets.filter(([dr, dc]) => {
    const r = mouseRow + dr;
    const c = mouseCol + dc;
    return r >= 0 && r < rows && c >= 0 && c < cols;
  });
  const targetCells = validOffsets.map(([dr, dc]) => ({ row: mouseRow + dr, col: mouseCol + dc }));
  for (const fig of figures) {
    const isOnTarget = targetCells.some(cell => cell.row === fig.row && cell.col === fig.col);
    if (isOnTarget) continue;
    const occupied = new Set();
    for (const other of figures) {
      if (other === fig) continue;
      occupied.add(`${other.row},${other.col}`);
    }
    const freeTargets = targetCells.filter(cell => !occupied.has(`${cell.row},${cell.col}`));
    if (freeTargets.length === 0) continue;
    let bestTarget = null;
    let bestDist = Infinity;
    for (const cell of freeTargets) {
      const dist = Math.abs(cell.row - fig.row) + Math.abs(cell.col - fig.col);
      if (dist < bestDist) {
        bestDist = dist;
        bestTarget = cell;
      }
    }
    if (!bestTarget) continue;
    stepFigure(fig, bestTarget, figures, rows, cols);
  }
  positionFigures();
  checkHomeEnemyCatches();
}

// Автопилот: каждый конь выбирает ближайшую пешку, за которой ещё никто
// не охотится, и прыгает к ней. Съесть её можно, только встав на её клетку.
function updateFiguresAutopilot() {
  const { figures, enemies, rows, cols } = figureState;
  const claimed = new Set();
  for (const fig of figures) {
    let prey = null;
    let bestDist = Infinity;
    for (const enemy of enemies) {
      if (enemy.row < 0 || claimed.has(enemy)) continue;
      const dist = Math.abs(enemy.row - fig.row) + Math.abs(enemy.col - fig.col);
      if (dist < bestDist) {
        bestDist = dist;
        prey = enemy;
      }
    }
    if (!prey) continue;
    claimed.add(prey);
    stepFigure(fig, { row: prey.row, col: prey.col }, figures, rows, cols);
  }
  positionFigures();
  checkHomeEnemyCatches();
}

/* ---- Фигурный снегопад на главном экране ---- */
const HOME_SNOW_GLYPHS = '♚♛♜♝♞♟♞♟♟';
const HOME_SNOW_CATCH_RADIUS = 46;  // насколько точно надо попасть по фигуре
const HOME_SNOW_VANISH_MS = 520;    // сколько длится исчезновение пойманной фигуры
const HOME_SNOW_MAX_WIND = 280;     // px/с: сильнее ветер не разгоняется
const HOME_SNOW_GRAVITY = 240;      // px/с²: подброшенная ветром фигура падает обратно по дуге
const HOME_SNOW_MAX_SPEED = 900;
let homeSnow = null;

function startHomeSnow() {
  const screen = $id('homeScreen');
  if (!screen) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'home-snow-layer';
  canvas.setAttribute('aria-hidden', 'true');
  $id('homeKnights').after(canvas);
  screen.classList.add('is-snow'); // у снегопада свой тёмный фон без клеток

  homeSnow = {
    canvas,
    ctx: canvas.getContext('2d'),
    flakes: [],
    vanishing: [],
    colors: readHomeSnowColors(), // [акцентный, приглушённый]; у фигуры хранится индекс
    slow: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    pointer: null,          // последняя точка курсора/пальца
    wind: { x: 0, y: 0 },   // ветер на весь экран, затухает сам
    lastFrame: performance.now(),
    raf: 0,
  };
  resizeHomeSnow();

  window.addEventListener('resize', resizeHomeSnow);
  window.addEventListener('pointermove', onHomeSnowPointerMove, { passive: true });
  window.addEventListener('pointerdown', onHomeSnowPointerDown, { passive: true });
  window.addEventListener('touchstart', onHomeSnowTouch, { passive: true });
  window.addEventListener('touchmove', onHomeSnowTouch, { passive: true });
  window.addEventListener('touchend', onHomeSnowTouchEnd, { passive: true });
  document.addEventListener(PALETTE_CHANGED_EVENT, onHomeSnowPaletteChanged);
  homeSnow.raf = requestAnimationFrame(drawHomeSnow);
}

function readHomeSnowColors() {
  const css = getComputedStyle(document.documentElement);
  return [css.getPropertyValue('--gold').trim() || '#d4a547', css.getPropertyValue('--text-muted').trim() || '#888'];
}

function onHomeSnowPaletteChanged() {
  if (homeSnow) homeSnow.colors = readHomeSnowColors();
}

function stopHomeSnow() {
  if (!homeSnow) return;
  cancelAnimationFrame(homeSnow.raf);
  window.removeEventListener('resize', resizeHomeSnow);
  window.removeEventListener('pointermove', onHomeSnowPointerMove);
  window.removeEventListener('pointerdown', onHomeSnowPointerDown);
  window.removeEventListener('touchstart', onHomeSnowTouch);
  window.removeEventListener('touchmove', onHomeSnowTouch);
  window.removeEventListener('touchend', onHomeSnowTouchEnd);
  document.removeEventListener(PALETTE_CHANGED_EVENT, onHomeSnowPaletteChanged);
  homeSnow.canvas.remove();
  $id('homeScreen').classList.remove('is-snow');
  homeSnow = null;
}

function makeHomeSnowFlake() {
  const z = 0.25 + Math.random() * 0.75; // глубина: дальние мелкие и тусклые
  return {
    x: Math.random() * homeSnow.w,
    y: -40,
    z,
    glyph: HOME_SNOW_GLYPHS[Math.floor(Math.random() * HOME_SNOW_GLYPHS.length)],
    tone: Math.random() < 0.45 ? 0 : 1, // индекс в homeSnow.colors
    phase: Math.random() * Math.PI * 2,
    rot: (Math.random() - 0.5) * 0.6,
    spin: (Math.random() - 0.5) * 0.4,
    vx: 0,
    vy: homeSnowFallSpeed(z),
  };
}

// Спокойная скорость падения: ближние фигуры падают быстрее дальних
function homeSnowFallSpeed(z) {
  return (12 + z * 38) * homeSnow.scale;
}

function resizeHomeSnow() {
  if (!homeSnow) return;
  const rect = homeSnow.canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  homeSnow.w = rect.width;
  homeSnow.h = rect.height;
  homeSnow.scale = clamp(Math.min(rect.width, rect.height) / 420, 1, 1.6);
  homeSnow.canvas.width = Math.round(rect.width * dpr);
  homeSnow.canvas.height = Math.round(rect.height * dpr);
  homeSnow.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const count = clamp(Math.round(rect.width * rect.height / 12000), 26, 90);
  while (homeSnow.flakes.length < count) {
    const flake = makeHomeSnowFlake();
    flake.y = Math.random() * rect.height;
    homeSnow.flakes.push(flake);
  }
  homeSnow.flakes.length = count;
  homeSnow.flakes.sort((a, b) => a.z - b.z);
}

function homeSnowLocalPoint(e) {
  const rect = homeSnow.canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// Движение курсора (на ПК) или свайп пальцем раздувает ветер на весь экран
// в ту же сторону, куда ведут, — в любом направлении.
function homeSnowMoveTo(clientX, clientY) {
  const now = performance.now();
  const prev = homeSnow.pointer;
  if (prev && now - prev.at < 100) {
    const wind = homeSnow.wind;
    wind.x = clamp(wind.x + (clientX - prev.x) * 0.6, -HOME_SNOW_MAX_WIND, HOME_SNOW_MAX_WIND);
    wind.y = clamp(wind.y + (clientY - prev.y) * 0.6, -HOME_SNOW_MAX_WIND, HOME_SNOW_MAX_WIND);
  }
  homeSnow.pointer = { x: clientX, y: clientY, at: now };
}

function onHomeSnowPointerMove(e) {
  if (homeSnow && e.pointerType === 'mouse') homeSnowMoveTo(e.clientX, e.clientY);
}

function onHomeSnowTouch(e) {
  if (!homeSnow || !e.touches.length) return;
  homeSnowMoveTo(e.touches[0].clientX, e.touches[0].clientY);
}

function onHomeSnowTouchEnd() {
  if (homeSnow) homeSnow.pointer = null;
}

// Тап/клик по фону ловит ближайшую крупную фигуру — она тает на месте
function onHomeSnowPointerDown(e) {
  if (!homeSnow) return;
  if (!e.target.closest('#homeScreen') || e.target.closest('button, a, input, .home-oval')) return;
  const p = homeSnowLocalPoint(e);
  let best = null;
  let bestDist = HOME_SNOW_CATCH_RADIUS * homeSnow.scale;
  for (const flake of homeSnow.flakes) {
    if (flake.z < 0.45) continue;
    const dist = Math.hypot(flake.x - p.x, flake.y - p.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = flake;
    }
  }
  if (!best) return;
  homeSnow.vanishing.push({ ...best, at: performance.now() });
  Object.assign(best, makeHomeSnowFlake());
}

function drawHomeSnowGlyph(ctx, f, scale, size, alpha) {
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(f.rot);
  ctx.scale(size, size);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = homeSnow.colors[f.tone];
  ctx.font = `${Math.round((12 + f.z * 26) * scale)}px "Segoe UI Symbol", "DejaVu Sans", serif`;
  ctx.fillText(f.glyph, 0, 0);
  ctx.restore();
}

function drawHomeSnow(now) {
  if (!homeSnow) return;
  const s = homeSnow;
  const dt = Math.min(0.05, (now - s.lastFrame) / 1000) * (s.slow ? 0.35 : 1);
  s.lastFrame = now;
  const ctx = s.ctx;
  ctx.clearRect(0, 0, s.w, s.h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const wind = s.wind;
  const calm = Math.exp(-1.4 * dt); // ветер стихает за пару секунд
  wind.x *= calm;
  wind.y *= calm;
  const gravity = HOME_SNOW_GRAVITY * s.scale;
  const airX = Math.exp(-2.5 * dt); // сопротивление воздуха: снос догоняет ветер не мгновенно
  const airY = Math.exp(-3.5 * dt);

  for (const f of s.flakes) {
    // Ближние фигуры ветер сносит сильнее дальних — так видна глубина
    const sway = Math.sin(now / 1400 + f.phase) * 7 * f.z;
    f.vx = sway + wind.x * f.z + (f.vx - sway - wind.x * f.z) * airX;
    // По вертикали ветер подхватывает фигуру вверх или подгоняет вниз, а когда
    // он стихает, гравитация возвращает её к спокойному падению — по дуге.
    const targetVy = homeSnowFallSpeed(f.z) + wind.y * f.z * 2.2;
    if (f.vy > targetVy) f.vy = targetVy + (f.vy - targetVy) * airY;
    else f.vy = Math.min(targetVy, f.vy + gravity * dt);
    f.vx = clamp(f.vx, -HOME_SNOW_MAX_SPEED, HOME_SNOW_MAX_SPEED);
    f.vy = clamp(f.vy, -HOME_SNOW_MAX_SPEED, HOME_SNOW_MAX_SPEED);
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.rot += (f.spin + f.vx * 0.0015) * dt;
    if (f.y < -80) { f.y = -80; f.vy = Math.max(f.vy, 0); }
    if (f.x < -40) f.x += s.w + 80;
    if (f.x > s.w + 40) f.x -= s.w + 80;
    if (f.y > s.h + 40) Object.assign(f, makeHomeSnowFlake());
    drawHomeSnowGlyph(ctx, f, s.scale, 1, 0.12 + f.z * 0.6);
  }

  // Пойманная фигура вспыхивает, чуть раздувается и тает на месте
  s.vanishing = s.vanishing.filter(v => now - v.at < HOME_SNOW_VANISH_MS);
  for (const v of s.vanishing) {
    const k = (now - v.at) / HOME_SNOW_VANISH_MS;
    const ease = 1 - Math.pow(1 - k, 3);
    const flash = k < 0.15 ? k / 0.15 : 1;
    drawHomeSnowGlyph(ctx, v, s.scale, 1 + ease * 0.6, (0.12 + v.z * 0.6 + 0.3 * flash) * (1 - ease));
  }
  ctx.globalAlpha = 1;
  s.raf = requestAnimationFrame(drawHomeSnow);
}
