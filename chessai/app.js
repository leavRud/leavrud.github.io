'use strict';

/* =========================================================================
   SUPABASE — замените на свои значения из Project Settings → API
   ========================================================================= */
const SUPABASE_URL = 'https://lmkomispucbysxidkcno.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxta29taXNwdWNieXN4aWRrY25vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MDE3MzEsImV4cCI6MjEwMjQ3NzczMX0.0VMFP0MdbZNyL-o9YCPot1zqbhF5hsMlUaMjmkak1PQ';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Единая версия приложения — используется в "О приложении" и в отправке обратной связи.
const APP_VERSION = '1.0.0';

/* =========================================================================
   НАСТРОЙКИ PROVOD.AI — ключ теперь только в secrets Edge Function
   (supabase/functions/chat-proxy), в браузере его больше нет
   ========================================================================= */
const PROVODAI_MODEL = 'deepseek/deepseek-v4-pro';
let temp = localStorage.getItem('chessTemperature');
if (temp !== null) {
  const val = parseFloat(temp);
  if (Number.isInteger(val) && val >= 1 && val <= 10) {
    // уже в новом формате
    temp = val;
  } else if (!isNaN(val) && val >= 0 && val <= 1) {
    // старое значение 0..1 → преобразуем в 1..10
    temp = Math.round(val * 10);
    localStorage.setItem('chessTemperature', String(temp));
  } else {
    temp = 6; // по умолчанию
  }
} else {
  temp = 6;
}
/* =========================================================================
   СОСТОЯНИЕ ПРИЛОЖЕНИЯ
   ========================================================================= */
const state = {
  mode: null,
  playerColor: 'w',
  aiColor: 'b',
  game: null,
  board: null,
  isThinking: false,
  isAsking: false,
  isGameOver: false,
  chatDisplay: [],
  chatApiHistory: [],
  capturedByWhite: [],
  capturedByBlack: [],
  skillLevel: 20,
  fenHistory: [],
  settings: {
    accent: localStorage.getItem('chessAccent') || 'gold',
    boardStyle: localStorage.getItem('chessBoardStyle') || 'classic',
    timeControl: parseInt(localStorage.getItem('chessTimeControl') || '10', 10),
    soundMoves: localStorage.getItem('chess_soundMoves') !== '0',
    soundCaptures: localStorage.getItem('chess_soundCaptures') !== '0',
    soundCheck: localStorage.getItem('chess_soundCheck') !== '0',
    soundMate: localStorage.getItem('chess_soundMate') !== '0',
    soundUi: localStorage.getItem('chess_soundUi') !== '0',
    volume: parseInt(localStorage.getItem('chessVolume') || '80', 10),
    responseLength: localStorage.getItem('chessResponseLength') || 'medium',
    autoHint: localStorage.getItem('chessAutoHint') === '1',
    autoHintDelay: parseInt(localStorage.getItem('chessAutoHintDelay') || '20', 10),
    language: localStorage.getItem('chessLanguage') || 'ru',
    perfHardware: localStorage.getItem('chess_perfHardware') !== '0',
    perfHighFps: localStorage.getItem('chess_perfHighFps') !== '0',
    perfSmoothAnim: localStorage.getItem('chess_perfSmoothAnim') !== '0',
    perfGlow: localStorage.getItem('chessGlow') !== '0',
    homeEnemies: localStorage.getItem('chess_homeEnemies') !== '0',
    timeLimited: localStorage.getItem('chessTimeLimited') !== '0',
    // Режим анализа: 'standard' — Infinite Analysis (максимальная глубина в фоне),
    // 'weak' — короткий анализ фиксированной глубины после каждого хода (для слабых ПК)
    analysisMode: localStorage.getItem('chess_analysisMode') === 'weak' ? 'weak' : 'standard',
  },
};
state.lastAutoReplyTime = 0;
state.lastAutoReplies = [];
state.settings.temperature = temp;
state.timeLimited = localStorage.getItem('chessTimeLimited') !== '0';
state.timeWhite = 600;  // секунд
state.timeBlack = 600;
state.timerInterval = null;
state.timerRunning = false;
state.timerPaused = false;
let autoHintTimer = null;
let homeAnimationInterval = null;
const WHITE_GLYPH = { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' };
const BLACK_GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
let homePageVisible = !document.hidden;
/* =========================================================================
   УТИЛИТЫ
   ========================================================================= */
function $id(id) { return document.getElementById(id); }
function showModal(id) { $id(id).classList.remove('hidden'); }
function hideModal(id) { $id(id).classList.add('hidden'); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function stripMarkdown(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, m => m.replace(/```/g, '').trim())
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .trim();
}
function isHomeCellOccupied(row, col) {
  if (!figureState) return false;
  for (const enemy of figureState.enemies) {
    if (enemy.row === row && enemy.col === col) return true;
  }
  return false;
}
function showConnectionBanner(text) {
  $id('connectionBannerText').textContent = text;
  $id('connectionBanner').classList.remove('hidden');
  playSound('error');
}
function hideConnectionBanner() {
  $id('connectionBanner').classList.add('hidden');
}
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 3000);
}
function onHomeVisibilityChange() {
  homePageVisible = !document.hidden;

  if (!figureState) return;

  if (homePageVisible) {
    if (state.settings.homeEnemies) startEnemySpawner();
  } else {
    stopEnemySpawner();
  }
}
/* =========================================================================
   ТЁМНАЯ ТЕМА
   ========================================================================= */
function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem('chessTheme', theme);
  const icon = $id('settingsThemeIcon');
  const label = $id('settingsThemeLabel');
  if (icon) icon.textContent = theme === 'dark' ? '🌙' : '☀️';
  if (label) {
    const i18nKey = 'settings.appearance.' + (theme === 'dark' ? 'dark' : 'light');
    label.textContent = window.t ? window.t(i18nKey) : (theme === 'dark' ? 'Тёмная' : 'Светлая');
  }
}
(function initTheme() {
  const saved = localStorage.getItem('chessTheme') || 'dark';
  applyTheme(saved);
})();
function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  applyTheme(isDark ? 'light' : 'dark');
}

/* =========================================================================
   ФИГУРЫ ДОСКИ (SVG)
   ========================================================================= */
const PIECE_GLYPH = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟',
};
function buildPieceSvg(piece) {
  const isWhite = piece[0] === 'w';
  const glyph = PIECE_GLYPH[piece];
  const fill = isWhite ? '#F6F1E6' : '#3A2A22';
  const stroke = isWhite ? '#7B3B3E' : '#AD8A4E';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<text x="50" y="78" font-size="80" text-anchor="middle" ` +
    `font-family="'Segoe UI Symbol','Noto Sans Symbols 2',sans-serif" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="2.2" paint-order="stroke">${glyph}</text>` +
    `</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}
const PIECE_THEME_CACHE = {};
function pieceThemeFn(piece) {
  if (!PIECE_THEME_CACHE[piece]) PIECE_THEME_CACHE[piece] = buildPieceSvg(piece);
  return PIECE_THEME_CACHE[piece];
}

/* =========================================================================
   PROVOD.AI (через Supabase Edge Function — работает на любом хостинге,
   включая GitHub Pages, без локального прокси-сервера)
   ========================================================================= */
async function provodChat(messages, { temperature = 0.6 } = {}) {
  const { data, error } = await sb.functions.invoke('chat-proxy', {
    body: { model: PROVODAI_MODEL, messages, temperature },
  });
  if (error) throw new Error(`Provod.ai ошибка: ${error.message}`);
  return data?.choices?.[0]?.message?.content ?? '';
}

/* =========================================================================
   STOCKFISH
   ========================================================================= */
let stockfish = null;
let isEngineReady = false;
let engineChain = Promise.resolve();

function initStockfish() {
  try {
    stockfish = new Worker("stockfish/stockfish-18-lite-single.js");
    stockfish.onmessage = (e) => {
      const msg = e.data;
      if (msg === "uciok") stockfish.postMessage("isready");
      if (msg === "readyok") {
        isEngineReady = true;
        stockfish.postMessage(`setoption name Skill Level value ${state.skillLevel || 20}`);
        markLoadingReady('engine');
      }
    };
    stockfish.onerror = (e) => { console.error("Stockfish:", e); markLoadingReady('engine'); };
    stockfish.postMessage("uci");
    stockfish.postMessage("setoption name Threads value 2");
    stockfish.postMessage("setoption name Hash value 64");
  } catch (e) { console.error(e); markLoadingReady('engine'); }
}

// Крайний случай: воркер Stockfish не ответил даже на 'stop' (реально завис
// / выполняет неразрешимо тяжёлый поиск / вкладка потеряла фокус на долго
// и таймеры браузера искажены). Пересоздаём воркер с нуля, чтобы очередь
// анализа (engineChain) не была заблокирована навсегда одной сломанной
// задачей — bgAnalysisState тоже сбрасывается, следующий вызов
// startBackgroundAnalysis/analyzePosition запустится на чистом движке.
function restartStockfishEngine() {
  try { if (stockfish) stockfish.terminate(); } catch (e) { /* игнорируем */ }
  stockfish = null;
  isEngineReady = false;
  bgAnalysisState.active = false;
  bgAnalysisState.fen = null;
  backgroundAnalysisPromise = null;
  engineChain = Promise.resolve();
  initStockfish();
}

function waitForEngine(timeout = 4000) {
  return new Promise((resolve) => {
    if (isEngineReady) return resolve(true);
    const start = Date.now();
    const check = setInterval(() => {
      if (isEngineReady) { clearInterval(check); resolve(true); }
      else if (Date.now() - start > timeout) { clearInterval(check); resolve(false); }
    }, 200);
  });
}

function queueEngineTask(taskFn) {
  engineChain = engineChain.then(taskFn, taskFn);
  return engineChain;
}

/* =========================================================================
   КЭШ АНАЛИЗА ПОЗИЦИЙ (Map: FEN -> результат анализа)
   Заполняется постепенно во время партии фоновым анализом (см. ниже),
   а после её окончания используется вместо повторного запуска Stockfish.
   ========================================================================= */
const analysisCache = new Map();

// Целевые глубины для разных сценариев использования кэша. Наличие ЛЮБОЙ
// записи в кэше больше не означает «позиция полностью проанализирована» —
// запись считается достаточной только если её depth >= нужного порога для
// конкретной задачи (чат, review, обычный запрос).
const ANALYSIS_TARGET = {
  chatMinDepth: 16,      // качество, нужное для ответа нейросети в чате
  reviewBaseDepth: 14,   // базовая глубина для всех позиций партии при Review
  reviewCriticalDepth: 20, // глубина для критических ходов при Review
  weakChatMinDepth: 12,
  weakReviewBaseDepth: 10,
  weakReviewCriticalDepth: 14,
};

// Приоритеты приоритетной очереди «отложенного углубления» старых позиций.
const PRIORITY = {
  CURRENT: 100,
  LAST_PLAYER_MOVE: 90,
  LAST_AI_MOVE: 70,
  CRITICAL_OLD: 60,
  OTHER_OLD: 20,
};

// Очередь позиций, которым нужен более глубокий анализ, когда движок
// освободится. Каждый элемент: { fen, priority, targetDepth }.
const analysisQueue = [];

function enqueueAnalysisTask(fen, priority, targetDepth) {
  if (!fen || !targetDepth) return;
  if (isAnalysisGoodEnough(fen, targetDepth)) return;
  const existing = analysisQueue.find(t => t.fen === fen);
  if (existing) {
    existing.priority = Math.max(existing.priority, priority);
    existing.targetDepth = Math.max(existing.targetDepth, targetDepth);
  } else {
    analysisQueue.push({ fen, priority, targetDepth });
  }
  analysisQueue.sort((a, b) => b.priority - a.priority);
}

function dequeueAnalysisTask() { return analysisQueue.shift() || null; }

// Есть ли уже в кэше результат нужного (или большего) качества для этой FEN.
function isAnalysisGoodEnough(fen, minDepth) {
  const cached = analysisCache.get(fen);
  return !!cached && cached.depth >= (minDepth || 0);
}

// Грубая оценка «уверенности» в результате: смотрим не только на depth, но и
// на то, насколько стабильна оценка между последними итерациями (см. ТЗ п.10).
function computeAnalysisConfidence(entry) {
  if (!entry || entry.depth < 12) return 'low';
  const hist = (entry.scoreHistory || [])
    .map(h => h.score)
    .filter(s => s != null && Math.abs(s) < 90000); // исключаем мат-оценки из разброса
  if (hist.length >= 2) {
    const spread = Math.max(...hist) - Math.min(...hist);
    if (spread > 80) return entry.depth >= 18 ? 'medium' : 'low';
  }
  if (entry.depth >= 20) return 'high';
  if (entry.depth >= 14) return 'medium';
  return 'low';
}

// Кладёт результат анализа позиции в кэш, но НЕ как простую перезапись —
// более слабый (по depth/nodes) результат никогда не затирает уже
// достигнутый более качественный. Формат записи расширен согласно ТЗ:
// { fen, bestMove, score, pv, depth, seldepth, nodes, timeMs, multipv,
//   scoreHistory, confidence, timestamp }
function mergeAnalysisResult(fen, result) {
  if (!fen || !result) return;
  const prev = analysisCache.get(fen);
  const candidate = {
    fen,
    bestMove: result.bestMove || (prev ? prev.bestMove : null),
    score: result.score != null ? result.score : (prev ? prev.score : null),
    pv: result.pv || (prev ? prev.pv : null),
    depth: result.depth || 0,
    seldepth: result.seldepth || (prev ? prev.seldepth : 0) || 0,
    nodes: result.nodes || (prev ? prev.nodes : 0) || 0,
    timeMs: result.timeMs || (prev ? prev.timeMs : 0) || 0,
    multipv: result.multipv || (prev ? prev.multipv : 1) || 1,
    timestamp: Date.now(),
  };
  // Правило из ТЗ: слабый ранний результат — промежуточный, а не окончательный,
  // но он и не должен откатываться назад, если новый прогон оказался хуже.
  if (prev && prev.depth > candidate.depth) return;
  if (prev && prev.depth === candidate.depth && (prev.nodes || 0) > candidate.nodes) return;

  const history = (prev && Array.isArray(prev.scoreHistory)) ? prev.scoreHistory.slice(-4) : [];
  if (candidate.score != null && (!prev || prev.depth !== candidate.depth)) {
    history.push({ depth: candidate.depth, score: candidate.score });
  }
  candidate.scoreHistory = history.slice(-5);
  candidate.confidence = computeAnalysisConfidence(candidate);
  analysisCache.set(fen, candidate);
}

// Оставлено для обратной совместимости с прежним именем/вызовами.
function cacheAnalysisResult(fen, result) { mergeAnalysisResult(fen, result); }

// Полностью очищает кэш анализа и очередь. Вызывается при старте новой партии.
function clearAnalysisCache() { analysisCache.clear(); analysisQueue.length = 0; }

// Переводит score (относительный к стороне, чей ход в данной FEN, как того
// требует UCI) в единую шкалу «с точки зрения белых» — нужно для корректного
// сравнения оценок ДО и ПОСЛЕ хода (см. ТЗ п.6).
function scoreAbsoluteWhite(entry, fen) {
  if (!entry || entry.score == null || !fen) return null;
  const turn = fen.split(' ')[1];
  return turn === 'w' ? entry.score : -entry.score;
}

/* =========================================================================
   ФОНОВЫЙ АНАЛИЗ ПОЗИЦИИ (Infinite Analysis)
   Пока пользователь думает над ходом, движок в фоне анализирует текущую
   позицию (go infinite в стандартном режиме, либо короткий go depth в
   режиме «Слабый ПК»). Как только сделан следующий ход — предыдущий
   анализ останавливается, последний полученный результат сохраняется
   в кэш, и запускается анализ уже новой позиции.
   В любой момент существует не более одного активного анализа —
   вся синхронизация идёт через общую очередь engineChain.
   ========================================================================= */
// Промис текущей фоновой задачи анализа (null, если фоновый анализ не идёт)
let backgroundAnalysisPromise = null;
// Состояние фонового анализа: активен ли он сейчас и для какой позиции
const bgAnalysisState = { active: false, fen: null };

// Низкоуровневый запуск поиска Stockfish с накоплением последнего известного
// результата (bestMove/score/pv/depth) по мере поступления строк "info".
// opts.infinite=true  -> "go infinite" (работает, пока не придёт 'stop')
// opts.depth=N        -> "go depth N" (завершается сам по себе)
// opts.movetime=N     -> "go movetime N" (завершается сам по себе, как раньше)
// opts.onUpdate(snapshot) — необязательный колбэк, вызывается при каждом
// новом depth (пока идёт go infinite/depth), чтобы вызывающий код мог
// сохранять промежуточный результат в кэш ПО ХОДУ анализа, а не только
// после остановки (см. ТЗ п.2 — постепенное углубление).
function runEngineAnalysis(fen, opts = {}) {
  return new Promise((resolve) => {
    if (!stockfish || !isEngineReady) { resolve({ bestMove: null, score: null, pv: null, depth: 0, seldepth: 0, nodes: 0, timeMs: 0 }); return; }
    const startedAt = Date.now();
    const latest = { bestMove: null, score: null, pv: null, depth: 0, seldepth: 0, nodes: 0, timeMs: 0 };
    let resolved = false;
    const finish = (bestMoveFromUci) => {
      if (resolved) return;
      resolved = true;
      stockfish.removeEventListener('message', handler);
      clearTimeout(safetyTimer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      if (bestMoveFromUci) latest.bestMove = bestMoveFromUci;
      if (!latest.timeMs) latest.timeMs = Date.now() - startedAt;
      resolve(latest);
    };
    const handler = (e) => {
      const msg = e.data;
      if (typeof msg !== 'string') return;
      if (msg.startsWith('info') && msg.indexOf(' pv ') !== -1) {
        const parts = msg.split(' ');
        const scoreIdx = parts.indexOf('score');
        const depthIdx = parts.indexOf('depth');
        const seldepthIdx = parts.indexOf('seldepth');
        const nodesIdx = parts.indexOf('nodes');
        const timeIdx = parts.indexOf('time');
        const pvIdx = parts.indexOf('pv');
        if (scoreIdx !== -1 && parts[scoreIdx + 1] === 'cp') {
          const val = parseInt(parts[scoreIdx + 2], 10);
          if (!Number.isNaN(val)) latest.score = val;
        } else if (scoreIdx !== -1 && parts[scoreIdx + 1] === 'mate') {
          const mateIn = parseInt(parts[scoreIdx + 2], 10);
          if (!Number.isNaN(mateIn)) latest.score = mateIn > 0 ? 100000 - mateIn : -100000 - mateIn;
        }
        if (depthIdx !== -1) {
          const d = parseInt(parts[depthIdx + 1], 10);
          if (!Number.isNaN(d)) latest.depth = d;
        }
        if (seldepthIdx !== -1) {
          const sd = parseInt(parts[seldepthIdx + 1], 10);
          if (!Number.isNaN(sd)) latest.seldepth = sd;
        }
        if (nodesIdx !== -1) {
          const nd = parseInt(parts[nodesIdx + 1], 10);
          if (!Number.isNaN(nd)) latest.nodes = nd;
        }
        if (timeIdx !== -1) {
          const tm = parseInt(parts[timeIdx + 1], 10);
          if (!Number.isNaN(tm)) latest.timeMs = tm;
        }
        if (pvIdx !== -1 && parts[pvIdx + 1]) {
          latest.pv = parts.slice(pvIdx + 1).join(' ');
          latest.bestMove = parts[pvIdx + 1];
        }
        if (depthIdx !== -1 && typeof opts.onUpdate === 'function') {
          opts.onUpdate({ ...latest });
        }
      }
      if (msg.startsWith('bestmove')) {
        const move = msg.split(' ')[1];
        finish(move && move !== '(none)' ? move : null);
      }
    };
    // Страховка от зависания движка. ВАЖНО: у 'go depth N' в UCI нет
    // ограничения по времени — движок будет считать до нужной глубины
    // сколько потребуется. Поэтому по таймауту мы НЕ можем просто
    // зарезолвить промис (как было раньше) — движок физически продолжит
    // считать старую задачу, а следующая задача из очереди пришлёт ему
    // новые position/go поверх незавершённого поиска, что путает движок и
    // выглядит как «бесконечное думание» на одном из следующих ходов.
    // Поэтому для ЛЮБОГО режима по таймауту сначала шлём 'stop' и ждём
    // настоящий bestmove (движок сам корректно освобождается). И только
    // если даже это не помогло (воркер реально завис) — жёстко резолвим и
    // пересоздаём Stockfish, чтобы не заблокировать все последующие анализы
    // навсегда.
    let stopSent = false;
    const requestStop = () => {
      if (stopSent || resolved) return;
      stopSent = true;
      if (stockfish) stockfish.postMessage('stop');
      hardKillTimer = setTimeout(() => {
        if (resolved) return;
        console.error('Stockfish не ответил на stop — перезапускаю движок.');
        finish(null);
        restartStockfishEngine();
      }, 8000);
    };
    let hardKillTimer = null;
    const safetyTimer = setTimeout(requestStop,
      opts.infinite ? 120000 : (opts.movetime || (opts.depth ? opts.depth * 1500 : 3000)) + 8000);

    stockfish.addEventListener('message', handler);
    stockfish.postMessage('position fen ' + fen);
    if (opts.infinite) stockfish.postMessage('go infinite');
    else if (opts.depth) stockfish.postMessage(`go depth ${opts.depth}`);
    else stockfish.postMessage(`go movetime ${opts.movetime || 400}`);
  });
}

// Останавливает текущий фоновый анализ (если он идёт) и дожидается, пока
// последний накопленный результат будет сохранён в кэш. Безопасно вызывать
// в любой момент, даже если фоновый анализ сейчас не запущен — тогда это
// просто ничего не делает. Все функции, которым нужен эксклюзивный доступ
// к движку (реальный поиск хода, разовый анализ конкретной позиции и т.д.),
// обязаны вызвать это перед постановкой своей задачи в очередь движка —
// иначе бесконечный "go infinite" никогда сам не завершится и очередь
// зависнет навсегда.
async function stopBackgroundAnalysis() {
  if (!bgAnalysisState.active) return;
  if (stockfish) stockfish.postMessage('stop');
  if (backgroundAnalysisPromise) {
    try { await backgroundAnalysisPromise; } catch (e) { /* игнорируем — не критично */ }
  }
}

// Запускает ЖИВОЙ (progressive) фоновый анализ переданной позиции согласно
// текущей настройке «Режим анализа». В отличие от прежней версии, НЕ
// пропускает позицию из-за одного лишь факта присутствия в кэше — наличие
// записи не означает завершённость анализа (см. ТЗ п.1). В standard-режиме
// кэш обновляется постепенно по мере роста depth (opts.onUpdate), поэтому
// даже мгновенный ход игрока не «замораживает» позицию на низком качестве —
// то, что успело накопиться к моменту stop, уже лежит в кэше как
// промежуточный (не окончательный) результат.
function startBackgroundAnalysis(fen) {
  if (!fen) return;
  if (!stockfish) return;
  const weak = state.settings.analysisMode === 'weak';
  bgAnalysisState.active = true;
  bgAnalysisState.fen = fen;
  const opts = weak
    ? { depth: 12 }
    : { infinite: true, onUpdate: (snapshot) => mergeAnalysisResult(fen, snapshot) };
  backgroundAnalysisPromise = queueEngineTask(() => runEngineAnalysis(fen, opts))
    .then((result) => { mergeAnalysisResult(fen, result); })
    .catch(() => { /* игнорируем — просто останется без кэша */ })
    .finally(() => {
      bgAnalysisState.active = false;
      bgAnalysisState.fen = null;
      backgroundAnalysisPromise = null;
      // В weak-режиме go depth 12 завершается сам по себе, движок реально
      // освобождается — используем эту паузу, чтобы чуть подтянуть самую
      // приоритетную позицию из очереди отложенного анализа.
      if (weak) processAnalysisQueueOnce();
    });
}

// Забирает из очереди самую приоритетную задачу (если она ещё актуальна —
// вдруг её уже дотянули до нужной глубины другим путём) и прогоняет
// ограниченный по depth (самозавершающийся) анализ, результат которого
// сливается в кэш через mergeAnalysisResult (слабее прежнего — не перезапишет).
// Не await'ится вызывающим кодом — ставится в общую очередь движка и
// выполняется, когда до неё дойдёт очередь (см. ТЗ п.3 — «когда CPU свободен»).
async function processAnalysisQueueOnce() {
  const task = dequeueAnalysisTask();
  if (!task) return;
  if (!stockfish || isAnalysisGoodEnough(task.fen, task.targetDepth)) return;
  try {
    const result = await queueEngineTask(() => runEngineAnalysis(task.fen, { depth: task.targetDepth }));
    mergeAnalysisResult(task.fen, result);
  } catch (e) { /* игнорируем — попробуем в следующий раз */ }
}

// Вызывается после каждого сделанного хода (см. onMoveMade): останавливает
// анализ предыдущей позиции (сохраняя накопленный результат в кэш), ставит
// эту предыдущую позицию в приоритетную очередь на ДОУГЛУБЛЕНИЕ (она ещё не
// считается окончательно проанализированной — ТЗ п.3), и, если партия не
// окончена, запускает живой анализ новой текущей позиции.
async function advanceBackgroundAnalysis() {
  const outgoingFen = bgAnalysisState.fen;
  const moverColor = state.game ? (state.game.turn() === 'w' ? 'b' : 'w') : null; // кто только что сходил
  await stopBackgroundAnalysis();

  if (outgoingFen) {
    const isAiMove = (state.mode === 'ai' || state.mode === 'characters') && moverColor === state.aiColor;
    const weak = state.settings.analysisMode === 'weak';
    const baseDepth = weak ? ANALYSIS_TARGET.weakReviewBaseDepth : ANALYSIS_TARGET.reviewBaseDepth;
    enqueueAnalysisTask(outgoingFen, isAiMove ? PRIORITY.LAST_AI_MOVE : PRIORITY.LAST_PLAYER_MOVE, baseDepth);
  }
  // Не блокируем ход — просто ставим попытку доуглубления в общую очередь
  // движка перед запуском live-анализа новой позиции.
  processAnalysisQueueOnce();

  if (state.isGameOver || !state.game) return;
  const ready = await waitForEngine(4000);
  if (!ready || state.isGameOver || !state.game) return;
  startBackgroundAnalysis(state.game.fen());
}

async function searchBestMove(fen, { movetime = 700 } = {}) {
  // Освобождаем движок от фонового анализа перед реальным поиском хода —
  // делаем это ДО постановки задачи в очередь: если "go infinite" никогда
  // не остановить, задача в очереди зависнет навсегда и до этой функции
  // очередь просто не дойдёт.
  await stopBackgroundAnalysis();
  return queueEngineTask(() => new Promise((resolve) => {
    if (!stockfish || !isEngineReady) { resolve(null); return; }
    let resolved = false;
    const finish = (move) => {
      if (resolved) return;
      resolved = true;
      stockfish.removeEventListener('message', handler);
      clearTimeout(timer);
      resolve(move);
    };
    const handler = (e) => {
      const msg = e.data;
      if (typeof msg === 'string' && msg.startsWith('bestmove')) {
        const move = msg.split(' ')[1];
        finish(move && move !== '(none)' ? move : null);
      }
    };
    const timer = setTimeout(() => finish(null), movetime + 4000);
    stockfish.addEventListener('message', handler);
    stockfish.postMessage('position fen ' + fen);
    stockfish.postMessage(`go movetime ${movetime}`);
  }));
}

// Возвращает анализ позиции — из кэша (мгновенно), если он ДОСТАТОЧНО
// качественный для запрошенной задачи (minDepth). Наличие записи в кэше
// само по себе больше не гарантирует достаточность (ТЗ п.1): если depth
// кэша ниже minDepth, движок доанализирует эту же позицию дальше и
// результат сольётся в кэш через mergeAnalysisResult (не откатится назад).
// Повторный запуск Stockfish «с нуля» для уже достаточно глубокой позиции
// не выполняется.
async function analyzePosition(fen, { movetime = 400, minDepth = 0 } = {}) {
  const cached = analysisCache.get(fen);
  if (cached && cached.depth >= minDepth) return cached;

  // Останавливаем фоновый анализ (не важно, для этой позиции он идёт или
  // для другой) — движок должен быть свободен перед разовым запросом.
  await stopBackgroundAnalysis();

  const freshlyCached = analysisCache.get(fen);
  if (freshlyCached && freshlyCached.depth >= minDepth) return freshlyCached;

  const targetDepth = Math.max(minDepth, freshlyCached ? freshlyCached.depth + 1 : 0);
  const result = targetDepth > 0
    ? await queueEngineTask(() => runEngineAnalysis(fen, { depth: targetDepth }))
    : await queueEngineTask(() => runEngineAnalysis(fen, { movetime }));
  mergeAnalysisResult(fen, result);
  return analysisCache.get(fen);
}

function movetimeForSkill(level) {
  return 350 + clamp(level || 20, 1, 20) * 55;
}

/* =========================================================================
   ЭКРАН ЗАГРУЗКИ
   Скрывается только когда реально готовы: шрифты, полная загрузка окна
   (скрипты/картинки/стили) и движок Stockfish (получен readyok). Есть
   аварийный тайм-аут, чтобы не держать пользователя вечно, если Stockfish
   не смог инициализироваться (например, воркеры не поддерживаются).
   ========================================================================= */
const loadingReadyFlags = { fonts: false, engine: false, windowLoad: false };
let loadingScreenHidden = false;

function markLoadingReady(flag) {
  loadingReadyFlags[flag] = true;
  maybeHideLoadingScreen();
}

function maybeHideLoadingScreen() {
  if (loadingScreenHidden) return;
  if (loadingReadyFlags.fonts && loadingReadyFlags.engine && loadingReadyFlags.windowLoad) {
    hideLoadingScreen();
  }
}

function hideLoadingScreen() {
  if (loadingScreenHidden) return;
  loadingScreenHidden = true;
  const el = $id('loadingScreen');
  if (!el) return;
  el.classList.add('is-hidden');
  setTimeout(() => { el.style.display = 'none'; }, 500);
}

(function initLoadingScreenWatchers() {
  // Шрифты
  const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
  fontsReady.then(() => markLoadingReady('fonts')).catch(() => markLoadingReady('fonts'));

  // Полная загрузка окна (картинки, стили, все <script>)
  if (document.readyState === 'complete') {
    markLoadingReady('windowLoad');
  } else {
    window.addEventListener('load', () => markLoadingReady('windowLoad'), { once: true });
  }

  // Аварийный предохранитель — не дольше 8 секунд ожидания движка
  setTimeout(() => markLoadingReady('engine'), 8000);
})();

/* =========================================================================
   ГЛАВНЫЙ ЭКРАН
   ========================================================================= */
function showHomeScreen() {
  $id('homeScreen').classList.remove('hidden');
  document.querySelector('.app').classList.add('hidden');
  hideModal('colorModal');
  hideModal('characterSetupModal');
  hideModal('characterCardModal');
  initHomeFigures();
}
function hideHomeScreen() {
  $id('homeScreen').classList.add('hidden');
  document.querySelector('.app').classList.remove('hidden');
  stopHomeFigures();
}

let homeSelectedMode = 'ai';

// Функция для переключения иконки режима
function updateModeIcon(mode) {
  document.querySelectorAll('.mode-icon').forEach(img => {
    const isActive = img.dataset.mode === mode;
    img.classList.toggle('active', isActive);
  });
}

document.querySelectorAll('.home-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    homeSelectedMode = mode;
    document.querySelectorAll('.home-mode-btn').forEach(b => {
      const active = b === btn;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    updateModeIcon(mode);
  });
});

$id('homePlayText').addEventListener('click', () => {
  playSound('ui');
  state.mode = homeSelectedMode;
  if (state.mode === 'friend') {
    state.playerColor = 'w';
    state.aiColor = 'b';
    hideHomeScreen();
    initGame();
  } else if (state.mode === 'characters') {
    openCharacterSetup();
  } else {
    resetDifficultyChoice();
    showModal('colorModal');
  }
});

/* ---- Модалка цвета/сложности ---- */
let chosenColor = null;
let chosenLevel = null;

function resetDifficultyChoice() {
  chosenColor = null;
  chosenLevel = null;
  document.querySelectorAll('.color-choice-btn, .diff-choice-btn').forEach(b => {
    b.classList.remove('is-active');
    b.setAttribute('aria-pressed', 'false');
  });
  $id('startAiGameBtn').disabled = true;
}
function updateStartAiBtn() {
  $id('startAiGameBtn').disabled = !(chosenColor && chosenLevel);
}
document.querySelectorAll('.color-choice-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    playSound('ui');
    chosenColor = btn.dataset.color;
    document.querySelectorAll('.color-choice-btn').forEach(b => {
      const active = b === btn;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    updateStartAiBtn();
  });
});
document.querySelectorAll('.diff-choice-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    playSound('ui');
    chosenLevel = parseInt(btn.dataset.level, 10);
    document.querySelectorAll('.diff-choice-btn').forEach(b => {
      const active = b === btn;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    updateStartAiBtn();
  });
});
$id('colorModalBackBtn').addEventListener('click', () => hideModal('colorModal'));
$id('startAiGameBtn').addEventListener('click', () => {
  playSound('ui');
  if (!chosenColor || !chosenLevel) return;
  state.playerColor = chosenColor;
  state.aiColor = chosenColor === 'w' ? 'b' : 'w';
  state.skillLevel = chosenLevel;
  hideModal('colorModal');
  if (stockfish && isEngineReady) {
    stockfish.postMessage(`setoption name Skill Level value ${chosenLevel}`);
  }
  hideHomeScreen();
  initGame();
});

/* =========================================================================
   РЕЖИМ «ПРОТИВ ПЕРСОНАЖЕЙ» — состояние
   ========================================================================= */
const charState = {
  activeTab: 'name',
  lastInput: null, // { type: 'name'|'desc', value: string }
};

function openCharacterSetup() {
  hideModal('characterCardModal');
  $id('charSetupError').classList.add('hidden');
  showModal('characterSetupModal');

  // Заполняем примеры из статистики
  const examplesContainer = document.getElementById('charExamples');
  if (!examplesContainer) return;
  const stats = window.Achievements?.getStats?.();
  const played = stats?.charactersPlayed || [];
  const recent = Array.from(new Set(played)).slice(-4).reverse();
  if (recent.length === 0) {
    examplesContainer.innerHTML = '';
    examplesContainer.style.display = 'none';
  } else {
    examplesContainer.style.display = 'flex';
    examplesContainer.innerHTML = recent.map(name =>
      `<button type="button" class="char-example-chip" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`
    ).join('');
    // Перепривязываем обработчики кликов (если нужны)
    examplesContainer.querySelectorAll('.char-example-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.getElementById('charNameInput').value = chip.dataset.name;
      });
    });
  }
}

/* ---- Вкладки: имя / описание ---- */
document.querySelectorAll('.char-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    charState.activeTab = target;
    document.querySelectorAll('.char-tab').forEach(t => {
      const active = t === tab;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', String(active));
    });
    $id('charNameTab').classList.toggle('hidden', target !== 'name');
    $id('charDescTab').classList.toggle('hidden', target !== 'desc');
  });
});

document.querySelectorAll('.char-example-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    $id('charNameInput').value = chip.dataset.name;
  });
});

$id('charSetupBackBtn').addEventListener('click', () => {
  hideModal('characterSetupModal');
  showHomeScreen();
});

$id('charCreateBtn').addEventListener('click', () => {
  playSound('ui');
  const errEl = $id('charSetupError');
  errEl.classList.add('hidden');
  let input;
  if (charState.activeTab === 'name') {
    const value = $id('charNameInput').value.trim();
    if (!value) {
      errEl.textContent = 'Введите имя персонажа.';
      errEl.classList.remove('hidden');
      playSound('error');
      return;
    }
    input = { type: 'name', value };
  } else {
    const value = $id('charDescInput').value.trim();
    if (!value) {
      errEl.textContent = 'Опишите вашего персонажа.';
      errEl.classList.remove('hidden');
      playSound('error');
      return;
    }
    input = { type: 'desc', value };
  }
  charState.lastInput = input;
  hideModal('characterSetupModal');
  runCharacterGeneration(input);
});

/* ---- Карточка персонажа ---- */
$id('charCardBackBtn').addEventListener('click', () => {
  hideModal('characterCardModal');
  openCharacterSetup();
});
$id('charCardRegenBtn').addEventListener('click', () => {
  if (!charState.lastInput) return;
  runCharacterGeneration(charState.lastInput);
});
$id('charCardPlayBtn').addEventListener('click', () => {
  if (!state.character) return;
  hideModal('characterCardModal');
  state.mode = 'characters';
  state.playerColor = 'w';
  state.aiColor = 'b';
  state.skillLevel = eloToSkillLevel(state.character.elo);
  if (stockfish && isEngineReady) {
    stockfish.postMessage(`setoption name Skill Level value ${state.skillLevel}`);
  }
  hideHomeScreen();
  initGame();
});

function setCharCardLoading(isLoading) {
  $id('characterCardLoading').classList.toggle('hidden', !isLoading);
  $id('characterCardBody').classList.toggle('hidden', isLoading);
  $id('charCardPlayBtn').disabled = isLoading;
  $id('charCardRegenBtn').disabled = isLoading;
}

async function runCharacterGeneration(input) {
  showModal('characterCardModal');
  $id('charCardError').classList.add('hidden');
  setCharCardLoading(true);
  try {
    const profile = await generateCharacterProfile(input);
    state.character = profile;
    renderCharacterCard(profile);
    setCharCardLoading(false);
  } catch (error) {
    console.error('Ошибка генерации персонажа:', error);
    setCharCardLoading(false);
    $id('characterCardBody').classList.add('hidden');
    const errEl = $id('charCardError');
    errEl.textContent = 'Не удалось создать персонажа: ' + error.message + '. Нажмите «Перегенерировать», чтобы попробовать снова.';
    errEl.classList.remove('hidden');
    playSound('error');
  }
}

/* ---- Генерация профиля персонажа ---- */
function buildCharacterGenSystemPrompt() {
  return `Ты создаёшь игровой профиль шахматного персонажа для приложения. Не преувеличивай умения. 
  Отвечай ТОЛЬКО валидным JSON-объектом без markdown-разметки, без пояснений, без \`\`\`.
  {
  "name": "имя персонажа",
  "shortDescription": "одно короткое предложение о персонаже",
  "style": "1-2 предложения о стиле игры в шахматы",
  "openings": "предпочитаемые дебюты, коротко",
  "aggression": число 0-100,
  "combination": число 0-100,
  "sacrifice": число 0-100,
  "caution": число 0-100,
  "emotionality": число 0-100,
  "endgame": число 0-100,
  "drawishness": число 0-100,
  "elo": число примерно от 400 до 2800,
  "tone": "манера общения персонажа, коротко",
  }
  Все текстовые поля — на русском языке. Придумай образ ярко и с характером. 
  Если дано известное имя, опирайся на известные о нём черты и адаптируй их под шахматный стиль и манеру речи.
  Если дано произвольное описание — придумай персонажа с нуля строго по этому описанию, включая подходящее имя.
  Числовые черты должны логично соответствовать описанию.`;
}

function extractJson(text) {
  const cleaned = String(text ?? '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return cleaned;
  return cleaned.slice(start, end + 1);
}

function normalizeCharacterProfile(p, input) {
  const clampNum = (v, min, max, def) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? clamp(n, min, max) : def;
  };
  const fallbackName = input.type === 'name' ? input.value : 'Загадочный соперник';
  const name = String(p.name || fallbackName).trim().slice(0, 40) || fallbackName;
  return {
    name,
    shortDescription: String(p.shortDescription || '').trim().slice(0, 180) || 'Загадочный противник со своим стилем игры.',
    style: String(p.style || '').trim().slice(0, 320) || 'Играет непредсказуемо, полагаясь на интуицию.',
    openings: String(p.openings || '').trim().slice(0, 160) || 'Разные дебюты.',
    aggression: clampNum(p.aggression, 0, 100, 50),
    combination: clampNum(p.combination, 0, 100, 50),
    sacrifice: clampNum(p.sacrifice, 0, 100, 30),
    caution: clampNum(p.caution, 0, 100, 50),
    emotionality: clampNum(p.emotionality, 0, 100, 50),
    endgame: clampNum(p.endgame, 0, 100, 50),
    drawishness: clampNum(p.drawishness, 0, 100, 30),
    elo: clampNum(p.elo, 500, 2900, 1400),
    tone: String(p.tone || '').trim().slice(0, 160) || 'Сдержанная, немногословная.',
  };
}

async function generateCharacterProfile(input) {
  const userMsg = input.type === 'name'
    ? `Имя персонажа: ${input.value}`
    : `Описание персонажа от пользователя: ${input.value}`;
  const messages = [
    { role: 'system', content: buildCharacterGenSystemPrompt() },
    { role: 'user', content: userMsg },
  ];
  const raw = await provodChat(messages, { temperature: 0.95 });
  let profile;
  try {
    profile = JSON.parse(extractJson(raw));
  } catch (e) {
    throw new Error('не удалось разобрать ответ нейросети');
  }
  return normalizeCharacterProfile(profile, input);
}

function eloToSkillLevel(elo) {
  const level = Math.round(((clamp(elo, 500, 2900) - 500) / 2400) * 19) + 1;
  return clamp(level, 1, 20);
}

/* ---- Отрисовка карточки персонажа ---- */
function traitLevelLabel(value) {
  const v = clamp(value, 0, 100);
  if (v < 20) return 'очень низкая';
  if (v < 40) return 'низкая';
  if (v < 60) return 'средняя';
  if (v < 80) return 'высокая';
  return 'очень высокая';
}

function eloDifficultyLabel(elo) {
  const e = clamp(elo, 500, 2900);
  if (e < 900) return 'новичок';
  if (e < 1200) return 'любитель';
  if (e < 1600) return 'уверенный игрок';
  if (e < 2000) return 'кандидат в мастера';
  if (e < 2400) return 'мастер';
  return 'гроссмейстер';
}

function charBarRow(label, value) {
  const pct = clamp(value, 0, 100);
  const hue = pct * 1.2;
  const color = `hsl(${hue}, 80%, 50%)`;
  return `<div class="char-bar-row">
    <span class="char-bar-label">${escapeHtml(label)}</span>
    <span class="char-bar-track" title="${pct}/100">
      <span class="char-bar-fill" style="width:${pct}%; height:100%; background:${color}; display:block;"></span>
    </span>
    <span class="char-bar-value">${traitLevelLabel(pct)}</span>
  </div>`;
}

function renderCharacterCard(profile) {
  $id('charCardName').textContent = profile.name;
  $id('charCardDesc').textContent = profile.shortDescription;
  const eloLabel = eloDifficultyLabel(profile.elo);
  $id('charCardElo').textContent = `${eloLabel.charAt(0).toUpperCase()}${eloLabel.slice(1)}\n≈${profile.elo} Elo`;
  $id('charCardBars').innerHTML = [
    charBarRow('Агрессия', profile.aggression),
    charBarRow('Тактика', profile.combination),
    charBarRow('Жертвы', profile.sacrifice),
    charBarRow('Осторожность', profile.caution),
    charBarRow('Эндшпиль', profile.endgame),
  ].join('');
  $id('charCardStyle').textContent = profile.style;
  $id('charCardTone').textContent = profile.openings ? `Дебюты: ${profile.openings}` : '';
}

/* ---- Декоративные кони на фоне ---- */
let figureState = null;

function computeHomeGrid(layer) {
  const rect = layer.getBoundingClientRect();
  const containerWidth = rect.width;
  const containerHeight = rect.height;
  const rows = 24;
  const cellH = containerHeight / rows;
  const cols = Math.max(rows, Math.round(containerWidth / cellH));
  const cellW = containerWidth / cols;
  return { rect, rows, cols, cellW, cellH };
}

function initHomeFigures() {
  const layer = document.getElementById('homeKnights');
  if (!layer) return;
  stopHomeFigures();
  layer.innerHTML = '';

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
  };

  positionFigures();
  if (state.settings.homeEnemies) startEnemySpawner();

  if (homeAnimationInterval) clearInterval(homeAnimationInterval);
  homeAnimationInterval = setInterval(() => {
    if (figureState) updateFigures();
  }, 50);

  window.addEventListener('mousemove', onHomeMouseMove);
  window.addEventListener('resize', onHomeResize);
}

function stopHomeFigures() {
  if (figureState) {
    window.removeEventListener('mousemove', onHomeMouseMove);
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

/* =========================================================================
   ИНИЦИАЛИЗАЦИЯ ИГРЫ
   ========================================================================= */
$id('newGameBtn').addEventListener('click', () => {
  playSound('ui');
  if (state.game && !state.isGameOver && state.game.history().length > 0) {
    if (!confirm('Начать новую игру? Текущая партия будет потеряна.')) return;
  }
  resetToModeSelection();
});
$id('closeResultBtn').addEventListener('click', resetToModeSelection);
$id('moveDetailCloseBtn').addEventListener('click', () => {
  document.getElementById('moveDetailModal').classList.add('hidden');
});
$id('moveDetailModal').addEventListener('click', (e) => {
  if (e.target.id === 'moveDetailModal') e.target.classList.add('hidden');
});

function resetToModeSelection() {
  stopTimer();
  hideModal('resultModal');
  hideModal('moveDetailModal');
  showHomeScreen();
}

function initGame() {
  state.game = new Chess();
  state.isGameOver = false;
  state.isThinking = false;
  state.chatDisplay = [];
  state.chatApiHistory = [];
  state.capturedByWhite = [];
  state.capturedByBlack = [];
  state.fenHistory = [state.game.fen()];
  state.prevCharacterEval = null;
  state.lastMoveFlavor = null;

  // Новая партия — старый кэш анализа больше не актуален
  clearAnalysisCache();

  $id('chatLog').innerHTML = '';
  $id('analysisBlock').classList.add('hidden');
  $id('analysisContent').innerHTML = '';
  $id('requestAnalysisBtn').textContent = 'Анализ партии';
  hideModal('resultModal');
  hideConnectionBanner();
  renderCaptured();
  renderMoveList();
  updateStatus();

  const orientation = state.playerColor === 'w' ? 'white' : 'black';
  const config = {
    draggable: true,
    position: 'start',
    orientation,
    pieceTheme: pieceThemeFn,
    onDragStart,
    onDrop,
    onSnapEnd,
    moveSpeed: 220,
    snapbackSpeed: 260,
    snapSpeed: 90,
  };
  state.board = Chessboard('board', config);

  const chatInputEl = $id('chatInput');
  if (state.mode === 'ai') {
    $id('modeLabel').textContent = `Против нейросети · вы играете ${state.playerColor === 'w' ? 'белыми' : 'чёрными'}`;
    $id('chatTitle').textContent = 'Диалог с нейросетью';
    $id('chatHint').textContent = 'Можно спросить в любой момент партии';
    chatInputEl.placeholder = 'Спросите о позиции, ходе, угрозах, совете…';
  } else if (state.mode === 'characters' && state.character) {
    $id('modeLabel').textContent = `Против персонажа: ${state.character.name} · вы играете ${state.playerColor === 'w' ? 'белыми' : 'чёрными'}`;
    $id('chatTitle').textContent = `Разговор с соперником — ${state.character.name}`;
    $id('chatHint').textContent = `${state.character.name} — ваш соперник и не даёт подсказок по ходам`;
    chatInputEl.placeholder = `Скажите что-нибудь ${state.character.name}…`;
    logSystemChat(`Вы играете против персонажа «${state.character.name}» (≈${state.character.elo} Elo). Он ваш соперник за доской и не будет подсказывать вам ходы.`);
  } else {
    $id('modeLabel').textContent = 'Игра вдвоём за одним ПК';
    $id('chatTitle').textContent = 'Диалог с нейросетью';
    $id('chatHint').textContent = 'Нейросеть отвечает только по запросу и не подсказывает сама';
    chatInputEl.placeholder = 'Спросите о позиции, ходе, угрозах, совете…';
  }
  syncAutoHintAvailability();

  if (!stockfish) initStockfish();

  if (state.mode === 'ai' && state.game.turn() === state.aiColor) {
    setTimeout(requestAiMove, 500);
  } else if (state.mode === 'characters' && state.game.turn() === state.aiColor) {
    setTimeout(requestCharacterMove, 500);
  }
  resetTimers();
  startTimer();

  // Запускаем фоновый анализ стартовой позиции (Infinite Analysis либо
  // короткий анализ — в зависимости от настройки «Режим анализа»), как
  // только движок будет готов. Если следующим ходом должен ответить сам
  // движок (см. выше), searchBestMove сам корректно остановит этот фоновый
  // анализ перед поиском своего хода — конфликта не возникает.
  waitForEngine(4000).then((ready) => {
    if (ready && state.game && !state.isGameOver) startBackgroundAnalysis(state.game.fen());
  });

  // Настройку режима анализа нельзя менять во время партии — обновляем
  // состояние блокировки в панели настроек (если она открыта/будет открыта).
  syncAnalysisModeLock();

  if (window.Achievements) {
    window.Achievements.track('gameStart', {
      mode: state.mode,
      playerColor: state.playerColor,
      skillLevel: state.skillLevel,
      character: state.mode === 'characters' ? state.character : null,
    });
  }
}

/* =========================================================================
   ВЗАИМОДЕЙСТВИЕ С ДОСКОЙ
   ========================================================================= */
function onDragStart(source, piece) {
  if (!state.game || state.isGameOver || state.isThinking) return false;
  const turn = state.game.turn();
  const isPieceWhite = piece.search(/^w/) !== -1;
  if ((turn === 'w' && !isPieceWhite) || (turn === 'b' && isPieceWhite)) return false;
  if ((state.mode === 'ai' || state.mode === 'characters') && turn !== state.playerColor) return false;
  highlightLegalMoves(source);
}

function onDrop(source, target) {
  clearHighlights();
  const move = state.game.move({ from: source, to: target, promotion: 'q' });
  if (move === null) {
    playSound('error');
    return 'snapback';
  }
  state.fenHistory.push(state.game.fen());
  const isUserMove = ((state.mode === 'ai' || state.mode === 'characters') && move.color === state.playerColor) || state.mode === 'friend';
  onMoveMade(move, isUserMove);
}

function onSnapEnd() {
  state.board.position(state.game.fen());
}

function highlightLegalMoves(square) {
  clearHighlights();
  const moves = state.game.moves({ square, verbose: true });
  moves.forEach((m) => {
    const $sq = $(`#board .square-${m.to}`);
    $sq.addClass('highlight-move');
    if (m.flags.includes('c') || m.flags.includes('e')) $sq.addClass('highlight-capture');
  });
  $(`#board .square-${square}`).addClass('highlight-select');
}

function clearHighlights() {
  $('#board .square-55d63').removeClass('highlight-move highlight-capture highlight-select');
}

function clearCheckHighlight() {
  $('#board .square-55d63').removeClass('highlight-check');
}

function getKingSquare(color) {
  const boardArr = state.game.board();
  const files = 'abcdefgh';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = boardArr[r][c];
      if (p && p.type === 'k' && p.color === color) {
        return files[c] + (8 - r);
      }
    }
  }
  return null;
}

/* =========================================================================
   ОБРАБОТКА ХОДА
   ========================================================================= */
function onMoveMade(move, isUserMove = false) {
  if (move.captured) {
    const isAi = (state.mode === 'ai' && move.color === state.aiColor);
    const flashColor = isAi ? 'red' : 'green';
    animateCapture(move.to, flashColor);
    playSound('capture');
  } else {
    playSound('move');
  }
  state.board.position(state.game.fen());
  if (move.captured) trackCapture(move);
  appendLastMoveRow();
  updateStatus();
  highlightLastMoveFade(move.from, move.to);
  if (state.game.in_check() && !state.game.in_checkmate()) playSound('check');
  if (state.mode === 'characters' && state.character) {
    triggerCharacterEvents(move, isUserMove);
  }
  if (window.Achievements) {
    window.Achievements.track('move', {
      move,
      isUserMove,
      mode: state.mode,
      playerColor: state.playerColor,
      givesCheck: state.game.in_check(),
      board: state.game.board(),
    });
  }
  // После хода перезапускаем таймер
  if (!state.isGameOver) {
    stopTimer();
    startTimer();
  }
  const isOver = checkGameOver();
  // Останавливаем анализ предыдущей позиции (сохраняя результат в кэш) и,
  // если партия продолжается, тут же запускаем фоновый анализ новой позиции.
  // Промис не ждём — это не должно блокировать отрисовку хода.
  advanceBackgroundAnalysis();
  if (isOver) return;
  resetAutoHintTimer();
  if (state.mode === 'ai' && state.game.turn() === state.aiColor) {
    setTimeout(requestAiMove, 350);
  } else if (state.mode === 'characters' && state.game.turn() === state.aiColor) {
    setTimeout(requestCharacterMove, 350);
  }
}

function trackCapture(move) {
  const capturedColor = move.color === 'w' ? 'b' : 'w';
  const glyph = capturedColor === 'w' ? WHITE_GLYPH[move.captured] : BLACK_GLYPH[move.captured];
  if (move.color === 'w') state.capturedByWhite.push(glyph);
  else state.capturedByBlack.push(glyph);
  renderCaptured();
}

function renderCaptured() {
  $id('capturedWhite').textContent = state.capturedByWhite.join(' ');
  $id('capturedBlack').textContent = state.capturedByBlack.join(' ');
}

function moveRowHtml(move, i, fenBefore) {
  const num = Math.floor(i / 2) + 1;
  const prefix = i % 2 === 0 ? `${num}.` : '';
  return `<div class="move-row" data-fen="${fenBefore}" data-san="${move.san}" data-index="${i}">
      <span class="move-num">${prefix}</span>
      <span class="move-white">${i % 2 === 0 ? move.san : ''}</span>
      <span class="move-black">${i % 2 === 1 ? move.san : ''}</span>
    </div>`;
}

function scrollMoveListToEnd() {
  const wrap = document.querySelector('.move-list-wrap');
  if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

// Полная перестройка списка ходов — только для случаев, когда история
// могла измениться целиком (новая партия, открытие/просмотр партии и т.п.)
function renderMoveList() {
  const history = state.game ? state.game.history({ verbose: true }) : [];
  const fens = state.fenHistory;
  let html = '';
  for (let i = 0; i < history.length; i++) {
    html += moveRowHtml(history[i], i, fens[i] || '');
  }
  $id('moveList').innerHTML = html;
  scrollMoveListToEnd();
}

// Добавляет в DOM только последний сыгранный ход, без пересборки всего
// списка — раньше renderMoveList() пересоздавал innerHTML целиком после
// каждого хода, что было лишней перерисовкой DOM на длинных партиях.
function appendLastMoveRow() {
  const history = state.game ? state.game.history({ verbose: true }) : [];
  if (!history.length) return;
  const i = history.length - 1;
  const fenBefore = state.fenHistory[i] || '';
  $id('moveList').insertAdjacentHTML('beforeend', moveRowHtml(history[i], i, fenBefore));
  scrollMoveListToEnd();
}

document.getElementById('moveList').addEventListener('click', function (e) {
  const row = e.target.closest('.move-row');
  if (!row) return;
  const fen = row.dataset.fen;
  const san = row.dataset.san;
  if (fen && san) openMoveDetail(fen, san);
});

function updateStatus() {
  const game = state.game;
  clearCheckHighlight();
  let text;
  const sideLabel = game.turn() === 'w' ? 'Белые' : 'Чёрные';
  if (game.in_checkmate()) {
    text = `Мат! ${sideLabel} получают мат.`;
  } else if (game.in_check()) {
    text = `${sideLabel} под шахом.`;
    const kingSq = getKingSquare(game.turn());
    if (kingSq) $(`#board .square-${kingSq}`).addClass('highlight-check');
  } else if (game.in_stalemate()) {
    text = 'Пат.';
  } else if (game.in_draw()) {
    text = 'Ничья.';
  } else {
    text = `Ход: ${sideLabel.toLowerCase()}.`;
    if (state.mode === 'ai' && game.turn() === state.aiColor) text += ' Нейросеть думает…';
    else if (state.mode === 'characters' && game.turn() === state.aiColor) {
      text += ` ${state.character ? state.character.name : 'Персонаж'} думает…`;
    }
  }
  $id('statusText').textContent = text;
  updateResignButtonLabel();
}

function updateResignButtonLabel() {
  const btn = $id('resignBtn');
  if (state.isGameOver) { btn.disabled = true; return; }
  btn.disabled = false;
  if (state.mode === 'friend') {
    const toMove = state.game.turn() === 'w' ? 'белых' : 'чёрных';
    btn.textContent = `Сдаться (за ${toMove})`;
  } else {
    btn.textContent = 'Сдаться';
  }
}

function computeMateInfo() {
  const hist = state.game.history({ verbose: true });
  const lastMove = hist[hist.length - 1];
  if (!lastMove) return {};
  const board = state.game.board();
  let bishops = 0, knights = 0;
  board.forEach(row => row.forEach(p => {
    if (p && p.color === lastMove.color) {
      if (p.type === 'b') bishops++;
      if (p.type === 'n') knights++;
    }
  }));
  return { matingPiece: lastMove.piece, matingSideBishops: bishops, matingSideKnights: knights };
}

function reportAchievementGameEnd(outcome, extra = {}) {
  if (!window.Achievements) return;
  const game = state.game;
  const mateInfo = game && game.in_checkmate() ? computeMateInfo() : {};
  const ownTimeLeft = state.timeLimited
    ? (state.playerColor === 'w' ? state.timeWhite : state.timeBlack)
    : null;
  window.Achievements.track('gameEnd', Object.assign({
    outcome,
    mode: state.mode,
    skillLevel: state.skillLevel,
    characterElo: state.character ? state.character.elo : null,
    checkmate: !!(game && game.in_checkmate()),
    stalemate: !!(game && game.in_stalemate()),
    threefold: !!(game && game.in_threefold_repetition()),
    ownTimeLeft,
  }, mateInfo, extra));
}

function checkGameOver() {
  stopTimer();
  const game = state.game;
  if (!game.game_over()) return false;
  state.isGameOver = true;
  let text;
  let outcome = 'draw';
  if (game.in_checkmate()) {
    const winnerColor = game.turn() === 'w' ? 'b' : 'w';
    const winner = winnerColor === 'w' ? 'Белые' : 'Чёрные';
    text = `Мат! Победили ${winner}.`;
    outcome = winnerColor === state.playerColor ? 'player_win' : 'character_win';
  } else if (game.in_stalemate()) {
    text = 'Пат. Ничья.';
  } else if (game.in_threefold_repetition()) {
    text = 'Ничья по троекратному повторению позиции.';
  } else if (game.insufficient_material()) {
    text = 'Ничья: недостаточно материала для мата.';
  } else if (game.in_draw()) {
    text = 'Ничья по правилу 50 ходов.';
  } else {
    text = 'Игра окончена.';
  }
  const achvOutcome = state.mode === 'friend' ? 'draw' : (outcome === 'player_win' ? 'win' : (outcome === 'character_win' ? 'loss' : 'draw'));
  reportAchievementGameEnd(achvOutcome);
  showResultModal(text, outcome);
  return true;
}

function showResultModal(text, outcome = 'draw') {
  if (outcome === 'player_win') playSound('win');
  else if (outcome === 'character_win') playSound('lose');
  $id('resultTitle').textContent = 'Игра окончена';
  $id('resultText').textContent = text;
  const charBlock = $id('characterResultBlock');
  if (state.mode === 'characters' && state.character) {
    charBlock.classList.remove('hidden');
    renderCharacterResultLoading();
    generateCharacterEndSummary(text, outcome);
  } else {
    charBlock.classList.add('hidden');
  }
  showModal('resultModal');
}

$id('resignBtn').addEventListener('click', () => {
  playSound('ui');
  if (state.isGameOver) return;
  let text;
  let outcome = 'character_win';
  if (state.mode === 'ai') {
    text = 'Вы сдались. Победила нейросеть.';
  } else if (state.mode === 'characters') {
    text = `Вы сдались. Победил(а) ${state.character ? state.character.name : 'персонаж'}.`;
  } else {
    const toMove = state.game.turn() === 'w' ? 'Белые' : 'Чёрные';
    const winner = state.game.turn() === 'w' ? 'Чёрные' : 'Белые';
    text = `${toMove} сдались. Победили ${winner}.`;
    outcome = 'draw';
  }
  state.isGameOver = true;
  updateResignButtonLabel();
  // Партия окончена сдачей — останавливаем фоновый анализ и сохраняем
  // в кэш последний накопленный результат для текущей позиции.
  stopBackgroundAnalysis();
  const achvOutcome = state.mode === 'friend' ? 'draw' : 'loss';
  reportAchievementGameEnd(achvOutcome);
  showResultModal(text, outcome);
});

/* =========================================================================
   ХОД НЕЙРОСЕТИ (STOCKFISH)
   ========================================================================= */
function pickFallbackMove() {
  const verboseMoves = state.game.moves({ verbose: true });
  const captures = verboseMoves.filter((m) => m.flags.includes('c') || m.flags.includes('e'));
  const pool = captures.length ? captures : verboseMoves;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  return state.game.move({ from: chosen.from, to: chosen.to, promotion: 'q' });
}

function setThinkingUI(isThinking) {
  $id('thinkingIndicator').classList.toggle('hidden', !isThinking);
}

async function requestAiMove() {
  if (!state.game || state.isGameOver || state.game.turn() !== state.aiColor) return;
  state.isThinking = true;
  setThinkingUI(true);
  updateStatus();

  const fenForSearch = state.game.fen();
  const movetime = movetimeForSkill(state.skillLevel);
  await waitForEngine(3000);
  const moveUci = await searchBestMove(fenForSearch, { movetime });

  let moveObj = null;
  if (moveUci) {
    const from = moveUci.substring(0, 2);
    const to = moveUci.substring(2, 4);
    const promotion = moveUci.length === 5 ? moveUci[4] : 'q';
    moveObj = state.game.move({ from, to, promotion });
  }
  if (moveObj === null) {
    moveObj = pickFallbackMove();
  }
  if (moveObj) {
    state.fenHistory.push(state.game.fen());
    onMoveMade(moveObj, false);
  }
  state.isThinking = false;
  setThinkingUI(false);
  updateStatus();
}

/* =========================================================================
   ХОД ПЕРСОНАЖА (STOCKFISH + СТИЛЬ ЛИЧНОСТИ)
   Stockfish отвечает только за качество ходов. Нейросеть НЕ ищет ход сама —
   она лишь выбирает между несколькими примерно равноценными вариантами,
   которые предложил движок, ориентируясь на характер персонажа.
   ========================================================================= */
function applyUciMove(uci) {
  if (!uci) return null;
  const from = uci.substring(0, 2);
  const to = uci.substring(2, 4);
  const promotion = uci.length === 5 ? uci[4] : 'q';
  return state.game.move({ from, to, promotion });
}

async function searchTopMoves(fen, { movetime = 900, multipv = 3 } = {}) {
  // Освобождаем движок от фонового анализа ДО постановки задачи в очередь
  // (см. подробный комментарий в searchBestMove).
  await stopBackgroundAnalysis();
  return queueEngineTask(() => new Promise((resolve) => {
    if (!stockfish || !isEngineReady) { resolve([]); return; }
    let resolved = false;
    const lines = new Map();
    const finish = () => {
      if (resolved) return;
      resolved = true;
      stockfish.removeEventListener('message', handler);
      clearTimeout(timer);
      stockfish.postMessage('setoption name MultiPV value 1');
      const arr = Array.from(lines.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => v)
        .filter(v => v && v.move);
      resolve(arr);
    };
    const handler = (e) => {
      const msg = e.data;
      if (typeof msg !== 'string') return;
      if (msg.startsWith('info') && msg.indexOf(' pv ') !== -1) {
        const parts = msg.split(' ');
        const mpvIdx = parts.indexOf('multipv');
        const scoreIdx = parts.indexOf('score');
        const pvIdx = parts.indexOf('pv');
        if (mpvIdx !== -1 && scoreIdx !== -1 && pvIdx !== -1) {
          const n = parseInt(parts[mpvIdx + 1], 10);
          let score = null;
          if (parts[scoreIdx + 1] === 'cp') {
            score = parseInt(parts[scoreIdx + 2], 10);
          } else if (parts[scoreIdx + 1] === 'mate') {
            const mateIn = parseInt(parts[scoreIdx + 2], 10);
            score = mateIn > 0 ? 100000 - mateIn : -100000 - mateIn;
          }
          const move = parts[pvIdx + 1];
          if (Number.isFinite(n) && move && score !== null) lines.set(n, { move, score });
        }
      }
      if (msg.startsWith('bestmove')) finish();
    };
    const timer = setTimeout(finish, movetime + 4000);
    stockfish.addEventListener('message', handler);
    stockfish.postMessage('position fen ' + fen);
    stockfish.postMessage(`setoption name MultiPV value ${multipv}`);
    stockfish.postMessage(`go movetime ${movetime}`);
  }));
}

function describeCandidateMoves(fen, candidates) {
  return candidates.map((cand) => {
    const g2 = new Chess(fen);
    const from = cand.move.substring(0, 2);
    const to = cand.move.substring(2, 4);
    const promotion = cand.move.length === 5 ? cand.move[4] : 'q';
    const mv = g2.move({ from, to, promotion });
    if (!mv) return null;
    const tags = [];
    if (mv.flags.includes('c') || mv.flags.includes('e')) tags.push('взятие');
    if (g2.in_check()) tags.push('шах');
    if (mv.flags.includes('k') || mv.flags.includes('q')) tags.push('рокировка');
    if (mv.flags.includes('p')) tags.push('превращение');
    return { san: mv.san, uci: cand.move, score: cand.score, tags, isCapture: mv.flags.includes('c') || mv.flags.includes('e') };
  }).filter(Boolean);
}

async function pickMoveByCharacterStyle(fen, candidates) {
  const c = state.character;
  const described = describeCandidateMoves(fen, candidates);
  if (described.length === 0) return null;

  const listText = described
    .map(d => `${d.san} (оценка ${d.score}cp${d.tags.length ? ', ' + d.tags.join(', ') : ''})`)
    .join('; ');

  const prompt = `Персонаж: ${c.name}. Стиль игры: ${c.style}
Черты характера (0-100): агрессивность ${c.aggression}, любовь к комбинациям ${c.combination}, любовь к жертвам ${c.sacrifice}, осторожность ${c.caution}, предпочтение эндшпиля ${c.endgame}, склонность к ничьим ${c.drawishness}.
В текущей позиции есть несколько примерно равноценных по оценке движка ходов: ${listText}.
Выбери ОДИН ход, который лучше всего соответствует характеру и стилю игры персонажа. Ответь СТРОГО одной нотацией хода (SAN) из списка выше, без пояснений и без знаков препинания вокруг.`;

  try {
    const raw = await provodChat([{ role: 'user', content: prompt }], { temperature: 0.7 });
    const clean = stripMarkdown(raw).trim().split(/\s+/)[0].replace(/[.,!?"']+$/g, '');
    const found = described.find(d => d.san === clean) || described.find(d => clean && clean.includes(d.san));
    if (found) return candidates.find(cd => cd.move === found.uci) || null;
  } catch (error) {
    console.error('Ошибка выбора хода по стилю персонажа:', error);
  }
  return null;
}

function detectCharacterMoveFlavor(chosenScore, topScore, moveObj) {
  state.lastMoveFlavor = null;
  if (chosenScore == null || topScore == null || !moveObj) return;
  const isTactical = moveObj.flags.includes('c') || moveObj.flags.includes('e');
  const deficit = topScore - chosenScore;
  if (deficit >= 40 && isTactical) {
    state.lastMoveFlavor = 'sacrifice';
  } else if (deficit <= 5 && isTactical && chosenScore >= 150) {
    state.lastMoveFlavor = 'goodCombo';
  }
  if (state.prevCharacterEval != null) {
    const swing = topScore - state.prevCharacterEval;
    if (swing >= 150 && !state.lastMoveFlavor) {
      state.lastMoveFlavor = 'opponentMistake';
    }
  }
  state.prevCharacterEval = topScore;
}

async function requestCharacterMove() {
  if (!state.game || state.isGameOver || state.game.turn() !== state.aiColor || !state.character) return;
  state.isThinking = true;
  setThinkingUI(true);
  updateStatus();

  const fen = state.game.fen();
  const movetime = movetimeForSkill(state.skillLevel);
  await waitForEngine(3000);
  const candidates = await searchTopMoves(fen, { movetime, multipv: 3 });

  let moveObj = null;
  let chosenScore = null;
  const topScore = candidates.length ? candidates[0].score : null;

  if (candidates.length === 1) {
    moveObj = applyUciMove(candidates[0].move);
    chosenScore = candidates[0].score;
  } else if (candidates.length > 1) {
    const threshold = 60; // centipawns — ходы в этом коридоре считаются «примерно равноценными»
    const close = candidates.filter(cd => topScore - cd.score <= threshold);
    if (close.length <= 1) {
      moveObj = applyUciMove(close[0] ? close[0].move : candidates[0].move);
      chosenScore = close[0] ? close[0].score : candidates[0].score;
    } else {
      const picked = await pickMoveByCharacterStyle(fen, close);
      const target = picked || close[0];
      moveObj = applyUciMove(target.move);
      chosenScore = target.score;
    }
  }

  if (moveObj === null) {
    moveObj = pickFallbackMove();
    chosenScore = null;
  }

  if (moveObj) {
    detectCharacterMoveFlavor(chosenScore, topScore, moveObj);
    state.fenHistory.push(state.game.fen());
    onMoveMade(moveObj, false);
  }
  state.isThinking = false;
  setThinkingUI(false);
  updateStatus();
}

/* ---- Реакции персонажа на события партии ---- */
function buildCharacterReactionPrompt() {
  const c = state.character;
  return `Ты — шахматный персонаж ${c.name} (${c.style}) внутри игрового приложения. Твой стиль: ${c.tone}. Отвечай кратко (1-2 предложения) 
  в образе, по-русски, с характером, без кавычек и разметки.`;
}

async function characterReact(context, isAuto = false) {
  if (state.mode !== 'characters' || !state.character) return;
  try {
    const messages = [
      { role: 'system', content: buildCharacterReactionPrompt() },
      { role: 'user', content: `Ситуация в партии: ${context}\nОтветь одной-двумя фразами в образе персонажа, по-русски, без кавычек и разметки.` },
    ];
    const reply = await provodChat(messages, { temperature: 1.0 });
    const clean = stripMarkdown(reply).replace(/^["«]+|["»]+$/g, '').trim();
    if (!clean) return;

    if (isAuto) {
      // проверка на дубликат среди последних 5 реплик
      if (state.lastAutoReplies.includes(clean)) return;
      state.lastAutoReplies.push(clean);
      if (state.lastAutoReplies.length > 5) state.lastAutoReplies.shift();
      state.lastAutoReplyTime = Date.now();
    }

    // добавить в историю чата (API) – для контекста
    state.chatApiHistory.push({ role: 'assistant', content: clean });
    // добавить в отображение
    appendCharacterMessage(clean);
  } catch (error) {
    console.error('Ошибка реплики персонажа:', error);
  }
}

function appendCharacterMessage(text) {
  state.chatDisplay.push({ role: 'character', text });
  const div = document.createElement('div');
  div.className = 'msg msg-character';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'msg-character-name';
  nameSpan.textContent = state.character ? state.character.name : '';
  const textSpan = document.createElement('span');
  textSpan.className = 'msg-character-text';
  textSpan.textContent = text;
  div.appendChild(nameSpan);
  div.appendChild(textSpan);
  $id('chatLog').appendChild(div);
  $id('chatLog').scrollTop = $id('chatLog').scrollHeight;
}

function triggerCharacterEvents(move, isUserMove) {
  if (state.mode !== 'characters' || !state.character) return;
  const now = Date.now();
  if (now - state.lastAutoReplyTime < 30000) return;
  const game = state.game;
  let event = null;
  if (game.in_checkmate()) {
    event = isUserMove ? 'mate_lost' : 'mate_won';
  } else if (!isUserMove && move.captured === 'q') {
    event = 'captured_queen';
  } else if (!isUserMove && state.lastMoveFlavor === 'sacrifice') {
    event = 'sacrifice';
  } else if (!isUserMove && state.lastMoveFlavor === 'goodCombo') {
    event = 'good_combo';
  } else if (!isUserMove && state.lastMoveFlavor === 'opponentMistake') {
    event = 'opponent_mistake';
  } else if (game.in_check()) {
    event = isUserMove ? 'player_gives_check' : 'character_gives_check';
  } else if (isUserMove && move.captured === 'q') {
    event = 'player_captured_queen';
  }
  state.lastMoveFlavor = null;
  if (!event) return;
  const contexts = {
    mate_won: `Вы только что поставили сопернику мат ходом ${move.san}.`,
    mate_lost: 'Соперник только что поставил вам мат.',
    captured_queen: `Вы взяли ферзя соперника ходом ${move.san}.`,
    sacrifice: `Вы пожертвовали материал ходом ${move.san}, следуя своему стилю игры.`,
    good_combo: `Вы нашли сильную тактическую комбинацию ходом ${move.san}.`,
    opponent_mistake: 'Соперник только что допустил заметную ошибку в партии.',
    character_gives_check: `Вы объявили сопернику шах ходом ${move.san}.`,
    player_gives_check: 'Соперник только что объявил вам шах.',
    player_captured_queen: 'Соперник только что взял вашего ферзя.',
  };
  if (event) {
    const context = contexts[event];
    if (context) {
      // Проверка на дублирование контекста? – можно по самому тексту, но в characterReact проверим
      characterReact(context, true); // isAuto = true
    }
  }
}

/* ---- Итоговая карточка партии против персонажа ---- */
function renderCharacterResultLoading() {
  $id('characterResultContent').innerHTML = '<p class="analysis-loading">Персонаж обдумывает партию…</p>';
}

function renderCharacterResult({ mood, favoriteMoment, comment }) {
  const c = state.character;
  $id('characterResultContent').innerHTML = `
    <div class="char-result-head">
      <span class="char-result-icon">♞</span>
      <span class="char-result-name">${escapeHtml(c ? c.name : '')}</span>
      <span class="char-result-mood">${escapeHtml(mood)}</span>
    </div>
    <div class="char-result-row"><span>Любимый момент</span><b>${escapeHtml(favoriteMoment)}</b></div>
    <p class="char-result-comment">${escapeHtml(comment)}</p>
  `;
}

async function generateCharacterEndSummary(resultText, outcome) {
  const c = state.character;
  if (!c) return;
  const pgn = state.game ? state.game.pgn() : '';
  const moodMap = { player_win: 'персонаж проиграл партию', character_win: 'персонаж выиграл партию', draw: 'партия завершилась вничью' };
  const prompt = `Персонаж: ${c.name}. Стиль игры: ${c.style}. Манера общения: ${c.tone}.
Черты характера: агрессивность ${c.aggression}/100, жертвы ${c.sacrifice}/100, эндшпиль ${c.endgame}/100, эмоциональность ${c.emotionality}/100.
Партия завершилась: ${resultText} (${moodMap[outcome] || 'результат неизвестен'}).
История партии (PGN): ${pgn || '—'}
Ответь СТРОГО валидным JSON без markdown и пояснений, в формате:
{"mood":"один эмодзи, отражающий настроение персонажа","favoriteMoment":"короткая фраза о любимом моменте партии, до 12 слов, по-русски","comment":"комментарий персонажа о партии в его манере общения, 1-2 предложения, по-русски"}`;
  try {
    const raw = await provodChat([{ role: 'user', content: prompt }], { temperature: 0.85 });
    const parsed = JSON.parse(extractJson(raw));
    renderCharacterResult({
      mood: String(parsed.mood || '🙂').trim().slice(0, 4) || '🙂',
      favoriteMoment: stripMarkdown(String(parsed.favoriteMoment || '')).trim() || 'Момент, который запомнится надолго.',
      comment: stripMarkdown(String(parsed.comment || '')).trim() || 'Хорошая была партия.',
    });
  } catch (error) {
    console.error('Ошибка итогового комментария персонажа:', error);
    const fallbackMood = outcome === 'character_win' ? '🙂' : (outcome === 'player_win' ? '😔' : '🤝');
    renderCharacterResult({ mood: fallbackMood, favoriteMoment: '—', comment: 'Комментарий персонажа сейчас недоступен.' });
  }
}

/* =========================================================================
   ЧАТ / ДИАЛОГ
   ========================================================================= */
function buildChatSystemPrompt() {
  const lengthMap = {
    short: 'Отвечай очень кратко — 1–2 предложения.',
    medium: 'Отвечай кратко и по делу (2–5 предложений, если игрок явно не просит подробнее).',
    long: 'Можешь отвечать подробно — до 8–10 предложений, если это уместно.',
  };
  const lengthRule = lengthMap[state.settings.responseLength] || lengthMap.medium;
  if (state.mode === 'characters' && state.character) {
    const c = state.character;
  return `Ты — ${c.name}, шахматный соперник. Твой стиль: ${c.style}. Манера: ${c.tone}.Тебе будут присылать позицию
  и историю ходов. Отвечай по-русски от первого лица, 
  кратко (1-3 предложения). Никогда не давай подсказок по ходам, не анализируй позицию в пользу игрока. 
  Если просят совета — откажи в характере. Без markdown.`;
}
  return `Ты — шахматный ассистент внутри приложения. Общайся с игроком по-русски. ${lengthRule}
Тебе будут присылать текущую позицию в FEN, историю ходов (PGN), готовый анализ Stockfish (лучший ход, оценку, глубину, варианты) и вопрос игрока.
Stockfish — единственный источник объективно лучшего хода и оценки позиции. Ты НЕ придумываешь и не подбираешь лучший ход самостоятельно: если в сообщении есть блок STOCKFISH, при вопросах «какой ход лучше» называй именно bestMove оттуда (или один из ALTERNATIVES) и объясняй его человеческим языком. Если блока STOCKFISH нет — прямо скажи, что анализ ещё не готов, вместо того чтобы гадать самому.
Отвечай на конкретный вопрос: подсказки по позиции, угрозы, оценка ходов, стратегические советы. Не давай длинных планов — только одну-две идеи.
Отвечай простым текстом, без markdown-разметки (никаких **, #, списков через - или цифры).`;
}

// Возвращает объективный контекст Stockfish для текущей FEN, используя ТОЛЬКО
// общий analysisCache/очередь (никакого параллельного независимого анализа —
// ТЗ п.13). Если качество кэша для этой позиции недостаточное — приоритет
// позиции в очереди поднимается, и мы дожидаемся более качественного
// результата (через analyzePosition), вместо того чтобы сразу отдавать
// слабый depth 7 как «финальный».
async function getStockfishContextForChat(fen, { wantAlternatives = false } = {}) {
  const ready = await waitForEngine(3000);
  if (!ready || !isEngineReady) return null;
  const weak = state.settings.analysisMode === 'weak';
  const minDepth = weak ? ANALYSIS_TARGET.weakChatMinDepth : ANALYSIS_TARGET.chatMinDepth;

  let entry = analysisCache.get(fen);
  // Качество считается достаточным ТОЛЬКО если и глубина, и confidence в
  // порядке (ТЗ п.4) — одного depth >= chatMinDepth недостаточно, если
  // оценка при этом нестабильна (confidence === 'low').
  const isGoodEnough = (e) => !!e && e.depth >= minDepth && e.confidence !== 'low';
  if (!isGoodEnough(entry)) {
    enqueueAnalysisTask(fen, PRIORITY.CURRENT, minDepth);
    entry = await analyzePosition(fen, { minDepth, movetime: 700 });
    // analyzePosition гарантирует depth >= minDepth, но confidence мог
    // остаться low (нестабильная оценка на этой глубине) — в этом случае
    // доуглубляем ещё немного и используем то, что получилось, не блокируя
    // ответ чата бесконечно.
    if (entry && entry.confidence === 'low') {
      entry = await analyzePosition(fen, { minDepth: minDepth + 4, movetime: 700 });
    }
  }

  let alternatives = [];
  if (wantAlternatives && entry) {
    const candidates = await searchTopMoves(fen, { movetime: 700, multipv: 3 });
    if (candidates.length) {
      // Обновляем ту же запись кэша данными top-1 из MultiPV — не создаём
      // отдельную независимую структуру для чата.
      mergeAnalysisResult(fen, { ...entry, bestMove: candidates[0].move, score: candidates[0].score, multipv: candidates.length });
      entry = analysisCache.get(fen);
    }
    alternatives = describeCandidateMoves(fen, candidates);
  }
  return { entry, alternatives };
}

// Форматирует блок STOCKFISH/ALTERNATIVES для промпта нейросети (ТЗ п.12).
function formatStockfishContextBlock(fen, sf) {
  if (!sf || !sf.entry || sf.entry.score == null) {
    return '\nSTOCKFISH: анализ этой позиции ещё не готов (недостаточная глубина).';
  }
  const { entry, alternatives } = sf;
  let bestSan = entry.bestMove;
  try {
    const g = new Chess(fen);
    const from = entry.bestMove.substring(0, 2);
    const to = entry.bestMove.substring(2, 4);
    const promotion = entry.bestMove.length === 5 ? entry.bestMove[4] : 'q';
    const mv = g.move({ from, to, promotion });
    if (mv) bestSan = mv.san;
  } catch (e) { /* оставляем UCI, если не распарсилось */ }

  let block = `\nSTOCKFISH:\nBest move: ${bestSan}\nEvaluation (centipawns, с точки зрения хода в этой FEN): ${entry.score}\nDepth: ${entry.depth}${entry.seldepth ? ` (seldepth ${entry.seldepth})` : ''}\nPV: ${entry.pv || '—'}`;
  if (alternatives && alternatives.length) {
    block += `\nALTERNATIVES:\n${alternatives.map((a, i) => `${i + 1}. ${a.san} (${a.score})`).join('\n')}`;
  }
  return block;
}

async function buildChatContextMessage(question) {
  const game = state.game;
  const fen = game.fen();
  const sideLabel = game.turn() === 'w' ? 'белые' : 'чёрные';
  const pgn = game.pgn() || '—';
  const isCharacterMode = state.mode === 'characters';
  const asksForMove = /куда|какой ход|сходить|посоветуй ход|что делать|мой ход|подскажи|совет|как сыграть/i.test(question);
  let extra = '';
  let sfBlock = '';
  let lastMoveLossBlock = '';

  if (!isCharacterMode) {
    // Персонажи (п.12) — соперник, а не помощник, поэтому Stockfish-контекст
    // ему намеренно не передаём (как и раньше — никаких подсказок).
    const sf = await getStockfishContextForChat(fen, { wantAlternatives: asksForMove });
    sfBlock = formatStockfishContextBlock(fen, sf);

    const history = game.history({ verbose: true });
    const lastMove = history[history.length - 1];
    if (lastMove && state.fenHistory.length >= 2) {
      const beforeFen = state.fenHistory[state.fenHistory.length - 2];
      const beforeEntry = analysisCache.get(beforeFen);
      const afterEntry = analysisCache.get(fen);
      const weak = state.settings.analysisMode === 'weak';
      const minDepth = weak ? ANALYSIS_TARGET.weakChatMinDepth : ANALYSIS_TARGET.chatMinDepth;
      if (!beforeEntry || beforeEntry.depth < minDepth) {
        // Не блокируем текущий ответ — просто повышаем приоритет этой
        // позиции в общей очереди, чтобы в следующий раз CPL был точнее.
        enqueueAnalysisTask(beforeFen, PRIORITY.LAST_PLAYER_MOVE, minDepth);
      }
      const beforeAbs = scoreAbsoluteWhite(beforeEntry, beforeFen);
      const afterAbs = scoreAbsoluteWhite(afterEntry, fen);
      if (beforeAbs != null && afterAbs != null) {
        const deltaAbs = afterAbs - beforeAbs;
        const loss = Math.max(0, lastMove.color === 'w' ? -deltaAbs : deltaAbs);
        lastMoveLossBlock = `\nPLAYER'S LAST MOVE: ${lastMove.san}\nLAST MOVE LOSS: ${Math.round(loss)} CPL`;
      }
    }
  }

  if (asksForMove && !isCharacterMode) {
    const moves = game.moves();
    extra = `\nСписок допустимых ходов в этой позиции (SAN): ${moves.join(', ')}. 
Игрок просит конкретный совет по ходу. Называй ход из блока STOCKFISH (Best move) или из ALTERNATIVES и объясни коротко, почему он хорош.`;
  } else if (asksForMove && isCharacterMode) {
    extra = `\nИгрок просит подсказать ход, совет или оценку позиции. Помни своё строгое правило: ты соперник, а не помощник — откажи в своей манере, не называя ходов и не оценивая позицию в его пользу.`;
  }
  return `CURRENT POSITION:
FEN: ${fen}
Сейчас ходят: ${sideLabel}
GAME HISTORY (PGN): ${pgn}${sfBlock}${lastMoveLossBlock}
PLAYER QUESTION: ${question}${extra}`;
}

function trimHistory(history, maxEntries = 12) {
  return history.slice(-maxEntries);
}

function appendChatMessage(role, text, { typewriter = false } = {}) {
  state.chatDisplay.push({ role, text });
  const div = document.createElement('div');
  div.className = `msg msg-${role}`;
  $id('chatLog').appendChild(div);
  $id('chatLog').scrollTop = $id('chatLog').scrollHeight;
  playSound('notification');

  if (!typewriter) {
    div.textContent = text;
    return;
  }

  let i = 0;
  const speed = 18;
  const chatLog = $id('chatLog');
  const step = () => {
    i += 1;
    div.textContent = text.slice(0, i);
    if (i % 3 === 0) chatLog.scrollTop = chatLog.scrollHeight;
    if (i < text.length) {
      setTimeout(step, speed);
    } else {
      chatLog.scrollTop = chatLog.scrollHeight;
    }
  };
  step();
}

function logSystemChat(text) {
  appendChatMessage('system', text);
}

function setAskLoading(isLoading) {
  state.isAsking = isLoading;
  $id('askBtn').disabled = isLoading || $id('chatInput').value.trim().length === 0;
  $id('askBtn').textContent = isLoading ? 'Думаю…' : 'Спросить';
}

async function handleAsk() {
  const input = $id('chatInput');
  const question = input.value.trim();
  if (!question || state.isAsking || !state.game) return;
  input.value = '';
  appendChatMessage('user', question);
  setAskLoading(true);

  const contextualUser = await buildChatContextMessage(question);
  state.chatApiHistory.push({ role: 'user', content: contextualUser });

  try {
    const messages = [
      { role: 'system', content: buildChatSystemPrompt() },
      ...trimHistory(state.chatApiHistory)
    ];
    const temperature = state.settings.temperature / 10;
  const reply = await provodChat(messages, { temperature });  
    const cleanReply = stripMarkdown(reply);
    state.chatApiHistory.push({ role: 'assistant', content: reply });
    appendChatMessage('assistant', cleanReply || '(пустой ответ модели)', { typewriter: true });
    hideConnectionBanner();
  } catch (error) {
    console.error('Ошибка чата:', error);
    appendChatMessage('system', 'Не удалось связаться с Provod.ai. Проверьте API-ключ и баланс.');
    showConnectionBanner(`Ошибка Provod.ai: ${error.message}`);
  } finally {
    setAskLoading(false);
  }
}

$id('askBtn').addEventListener('click', () => {
  playSound('ui');
  handleAsk();
});
$id('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleAsk();
  }
});
$id('chatInput').addEventListener('input', () => {
  const hasText = $id('chatInput').value.trim().length > 0;
  $id('askBtn').classList.toggle('btn-primary-active', hasText);
  $id('askBtn').disabled = !hasText;
});
$id('askBtn').disabled = $id('chatInput').value.trim().length === 0;

$id('retryAiBtn').addEventListener('click', () => {
  hideConnectionBanner();
  if (state.mode === 'ai' && state.game.turn() === state.aiColor) {
    requestAiMove();
  } else if (state.mode === 'characters' && state.game.turn() === state.aiColor) {
    requestCharacterMove();
  }
});

/* =========================================================================
   ДЕТАЛИ ХОДА (мини-доска + анализ)
   ========================================================================= */
let moveDetailBoard = null;

async function openMoveDetail(fen, san, label) {
  const modal = document.getElementById('moveDetailModal');
  const title = document.getElementById('moveDetailTitle');
  const sanEl = document.getElementById('moveDetailSan');
  const badgeEl = document.getElementById('moveDetailBadge');
  const commentEl = document.getElementById('moveDetailComment');
  const loadingEl = document.getElementById('moveDetailLoading');
  const arrowSvg = document.getElementById('moveDetailArrow');

  title.textContent = 'Анализ хода';
  sanEl.textContent = `Ход: ${san}`;
  commentEl.innerHTML = '';
  loadingEl.classList.remove('hidden');
  modal.classList.remove('hidden');
  arrowSvg.innerHTML = '';

  badgeEl.className = 'move-detail-badge';
  if (label === 'best') {
    badgeEl.textContent = '🟢 Лучший ход партии';
    badgeEl.classList.add('is-visible', 'is-best');
  } else if (label === 'worst') {
    badgeEl.textContent = '🔴 Худший ход партии';
    badgeEl.classList.add('is-visible', 'is-worst');
  }

  if (!moveDetailBoard) {
    moveDetailBoard = Chessboard('moveDetailBoard', {
      position: fen,
      draggable: false,
      pieceTheme: pieceThemeFn,
      showNotation: true,
    });
    window.addEventListener('resize', () => moveDetailBoard && moveDetailBoard.resize());
  } else {
    moveDetailBoard.position(fen, false);
  }
  const tempGame = new Chess(fen);
  const playedMove = tempGame.move(san);
  if (!playedMove) {
    console.warn('Не удалось выполнить ход из SAN:', san);
  } else {
    const fromSq = playedMove.from;
    const toSq = playedMove.to;
    setTimeout(() => {
      if (moveDetailBoard) {
        moveDetailBoard.resize();
        moveDetailBoard.position(tempGame.fen());
      }
      drawArrow(fromSq, toSq, arrowSvg);
    }, 400);
  }

  try {
    const result = await analyzePosition(fen, { movetime: 600 });
    const bestMoveUci = result.bestMove;
    const score = result.score;

    let bestMoveSan = bestMoveUci;
    if (bestMoveUci) {
      const tg2 = new Chess(fen);
      const from = bestMoveUci.substring(0, 2);
      const to = bestMoveUci.substring(2, 4);
      const promotion = bestMoveUci.length === 5 ? bestMoveUci[4] : 'q';
      const moveObj = tg2.move({ from, to, promotion });
      if (moveObj) bestMoveSan = moveObj.san;
    }

    const prompt = `
Позиция (FEN): ${fen}
Фактический ход: ${san}
Лучший ход по мнению Stockfish (движка): ${bestMoveSan} (UCI: ${bestMoveUci})
Оценка позиции (в центах, положительная — перевес белых): ${score !== null ? score : 'неизвестно'}

Сравни фактический ход с лучшим. Объясни, почему ход ${san} был хорош или плох. Укажи, какие угрозы он создаёт или не создаёт. Дай краткий комментарий (2-3 предложения) на русском языке простым текстом, без markdown.
`;
    const messages = [{ role: 'user', content: prompt }];
    const reply = await provodChat(messages, { temperature: 0.4 });
    commentEl.textContent = stripMarkdown(reply) || 'Не удалось получить комментарий.';
  } catch (error) {
    commentEl.textContent = 'Ошибка при анализе: ' + error.message;
  } finally {
    loadingEl.classList.add('hidden');
  }
}

function drawArrow(from, to, svgElement) {
  svgElement.innerHTML = '';
  const ns = 'http://www.w3.org/2000/svg';
  const files = 'abcdefgh';
  const fromCol = files.indexOf(from[0]) + 0.5;
  const fromRow = 8 - parseInt(from[1], 10) + 0.5;
  const toCol = files.indexOf(to[0]) + 0.5;
  const toRow = 8 - parseInt(to[1], 10) + 0.5;
  const x1 = (fromCol / 8) * 100;
  const y1 = (fromRow / 8) * 100;
  const x2 = (toCol / 8) * 100;
  const y2 = (toRow / 8) * 100;

  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = 6.2;
  const headSpread = 0.48;
  // укорачиваем хвост стрелки, чтобы наконечник не "утопал" в линии
  const shaftEndX = x2 - headLen * 0.8 * Math.cos(angle);
  const shaftEndY = y2 - headLen * 0.8 * Math.sin(angle);

  const shaft = document.createElementNS(ns, 'line');
  shaft.setAttribute('x1', x1);
  shaft.setAttribute('y1', y1);
  shaft.setAttribute('x2', shaftEndX);
  shaft.setAttribute('y2', shaftEndY);
  shaft.setAttribute('stroke', 'var(--accent)');
  shaft.setAttribute('stroke-width', '3.2');
  shaft.setAttribute('stroke-linecap', 'round');
  shaft.setAttribute('opacity', '0.92');
  svgElement.appendChild(shaft);

  const hx1 = x2 - headLen * Math.cos(angle - headSpread);
  const hy1 = y2 - headLen * Math.sin(angle - headSpread);
  const hx2 = x2 - headLen * Math.cos(angle + headSpread);
  const hy2 = y2 - headLen * Math.sin(angle + headSpread);
  const head = document.createElementNS(ns, 'polygon');
  head.setAttribute('points', `${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}`);
  head.setAttribute('fill', 'var(--accent)');
  svgElement.appendChild(head);
}

/* =========================================================================
   АНАЛИЗ ПАРТИИ
   ========================================================================= */
let progressLabelEl = null;
const progressContainer = document.createElement('div');
progressContainer.id = 'fakeProgress';
progressContainer.style.cssText = `
  width: 100%;
  height: 8px;
  background: var(--bg-alt);
  border-radius: 8px;
  overflow: hidden;
  margin: 10px 0;
  box-shadow: var(--inset-sm);
`;
const progressBar = document.createElement('div');
progressBar.style.cssText = `
  width: 0%;
  height: 100%;
  background: var(--gold);
  transition: width 0.3s ease;
  border-radius: 8px;
`;
progressContainer.appendChild(progressBar);

function ensureProgressUi() {
  const loadingEl = $id('analysisLoading');
  if (!document.getElementById('fakeProgress')) {
    loadingEl.parentNode.insertBefore(progressContainer, loadingEl.nextSibling);
  }
  if (!progressLabelEl || !progressLabelEl.parentNode) {
    progressLabelEl = document.createElement('div');
    progressLabelEl.id = 'analysisProgressLabel';
    progressLabelEl.className = 'analysis-progress-label';
    progressContainer.parentNode.insertBefore(progressLabelEl, progressContainer.nextSibling);
  }
}
function startProgress() {
  ensureProgressUi();
  progressBar.style.width = '0%';
  progressLabelEl.textContent = 'Подготовка анализа…';
}
function updateProgress(step, total, san) {
  const percent = Math.round((step / total) * 100);
  progressBar.style.width = percent + '%';
  progressLabelEl.textContent = san
    ? `Проверка хода: ${san} (${percent}%)`
    : `Анализ начальной позиции… (${percent}%)`;
}
function stopProgress(success = true) {
  if (success) {
    progressBar.style.width = '100%';
    if (progressLabelEl) progressLabelEl.textContent = 'Готово';
  }
  setTimeout(() => {
    if (progressContainer.parentNode) progressContainer.remove();
    if (progressLabelEl && progressLabelEl.parentNode) progressLabelEl.remove();
  }, success ? 500 : 0);
}

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function accuracyFromCpl(cpl) { return clamp(103.1668 * Math.exp(-0.04354 * cpl) - 3.1669, 0, 100); }
function eloFromCpl(cpl) { return Math.round(clamp(2882 - 30 * cpl, 600, 2900)); }

// Пороги качества хода в centipawn loss (ТЗ п.7/8).
const CPL_INACCURACY = 50;
const CPL_MISTAKE = 120;
const CPL_BLUNDER = 250;

function classifyLoss(loss) {
  if (loss >= CPL_BLUNDER) return 'blunder';
  if (loss >= CPL_MISTAKE) return 'mistake';
  if (loss >= CPL_INACCURACY) return 'inaccuracy';
  return 'ok';
}

// Более информативная Accuracy: сочетание среднего/медианного/максимального
// CPL плюс штраф за грубые ошибки с убывающей отдачей (sqrt), чтобы один
// blunder заметно влиял, но не «убивал» точность всей партии (ТЗ п.8).
function computeAccuracyV2({ avgCpl, medianCpl, maxCpl, blunders, mistakes, inaccuracies }) {
  const base = accuracyFromCpl(avgCpl) * 0.55
    + accuracyFromCpl(medianCpl) * 0.35
    + accuracyFromCpl(maxCpl) * 0.10;
  const penalty = Math.sqrt(blunders) * 6 + Math.sqrt(mistakes) * 2.5 + Math.sqrt(inaccuracies) * 0.8;
  return clamp(base - penalty, 0, 100);
}

// Приблизительный Elo — качество игры В ЭТОЙ партии, не реальный рейтинг
// (ТЗ п.9). Строится на прежней линейной базе от avgCpl, скорректированной
// количеством серьёзных ошибок и итоговой Accuracy.
function computeEloV2({ avgCpl, accuracy, blunders, mistakes }) {
  let elo = eloFromCpl(avgCpl);
  elo -= blunders * 40 + mistakes * 15;
  elo += (accuracy - 70) * 3;
  return Math.round(clamp(elo, 600, 2900));
}

// Счётчик запусков Review Analysis — если пользователь запустил новый анализ
// (или он же — «Обновить анализ») пока предыдущий ещё фоново уточнялся,
// старое фоновое уточнение узнаёт об этом (runId !== analysisRunId) и
// прекращает себя, не затирая уже более новый результат.
let analysisRunId = 0;

// Считает moveAnalysis + агрегированную статистику (Accuracy/CPL/Elo/…) по
// уже имеющемуся набору evaluations. Чистая функция без обращений к
// Stockfish — используется и для быстрого предварительного прохода, и для
// уточнённого результата после фонового доуглубления (ТЗ п.2).
function computeGameStats(fens, moves, evaluations) {
  const moveAnalysis = [];
  for (let j = 0; j < moves.length; j++) {
    const before = evaluations[j];
    const after = evaluations[j + 1];
    if (!before) continue;
    // Оценки Stockfish (score cp) относительны к стороне, чей ход в данной
    // FEN — прежде чем сравнивать «до» и «после», переводим обе в единую
    // шкалу «с точки зрения белых» (ТЗ п.6: корректный учёт цвета/направления).
    const evalBeforeAbs = scoreAbsoluteWhite(before, fens[j]);
    const evalAfterAbs = scoreAbsoluteWhite(after, fens[j + 1]);
    let loss = 0;
    if (evalBeforeAbs != null && evalAfterAbs != null) {
      const deltaAbs = evalAfterAbs - evalBeforeAbs; // положительно = сдвиг к белым
      loss = Math.max(0, moves[j].color === 'w' ? -deltaAbs : deltaAbs);
    }
    const evalBeforeMover = evalBeforeAbs != null ? (moves[j].color === 'w' ? evalBeforeAbs : -evalBeforeAbs) : null;
    const evalAfterMover = evalAfterAbs != null ? (moves[j].color === 'w' ? evalAfterAbs : -evalAfterAbs) : null;
    moveAnalysis.push({
      move: moves[j],
      fenBefore: fens[j],
      fenAfter: fens[j + 1],
      bestMove: before.bestMove || null,
      playedMove: moves[j].san,
      evalBefore: evalBeforeMover,
      evalAfter: evalAfterMover,
      depth: before.depth || 0,
      pv: before.pv || null,
      loss,
      delta: moves[j].color === 'w' ? -loss : loss, // сохранено для обратной совместимости
      classification: classifyLoss(loss),
      critical: classifyLoss(loss) === 'mistake' || classifyLoss(loss) === 'blunder',
    });
  }

  const whiteLosses = moveAnalysis.filter(m => m.move.color === 'w').map(m => m.loss);
  const blackLosses = moveAnalysis.filter(m => m.move.color === 'b').map(m => m.loss);

  const avgCplWhite = avg(whiteLosses);
  const avgCplBlack = avg(blackLosses);
  const medianCplWhite = median(whiteLosses);
  const medianCplBlack = median(blackLosses);
  const maxCplWhite = whiteLosses.length ? Math.max(...whiteLosses) : 0;
  const maxCplBlack = blackLosses.length ? Math.max(...blackLosses) : 0;

  const countByClass = (items, color, cls) => items.filter(m => m.move.color === color && m.classification === cls).length;
  const statsWhite = {
    inaccuracies: countByClass(moveAnalysis, 'w', 'inaccuracy'),
    mistakes: countByClass(moveAnalysis, 'w', 'mistake'),
    blunders: countByClass(moveAnalysis, 'w', 'blunder'),
  };
  const statsBlack = {
    inaccuracies: countByClass(moveAnalysis, 'b', 'inaccuracy'),
    mistakes: countByClass(moveAnalysis, 'b', 'mistake'),
    blunders: countByClass(moveAnalysis, 'b', 'blunder'),
  };

  const accuracyWhite = computeAccuracyV2({ avgCpl: avgCplWhite, medianCpl: medianCplWhite, maxCpl: maxCplWhite, ...statsWhite });
  const accuracyBlack = computeAccuracyV2({ avgCpl: avgCplBlack, medianCpl: medianCplBlack, maxCpl: maxCplBlack, ...statsBlack });
  const eloWhite = computeEloV2({ avgCpl: avgCplWhite, accuracy: accuracyWhite, ...statsWhite });
  const eloBlack = computeEloV2({ avgCpl: avgCplBlack, accuracy: accuracyBlack, ...statsBlack });

  let bestMoveObj = null, worstMoveObj = null;
  let bestLoss = Infinity, worstLoss = -Infinity;
  for (const item of moveAnalysis) {
    const loss = item.loss;
    if (loss < bestLoss) { bestLoss = loss; bestMoveObj = item; }
    if (loss > worstLoss && loss > 10) { worstLoss = loss; worstMoveObj = item; }
  }

  return {
    moveAnalysis, avgCplWhite, avgCplBlack, medianCplWhite, medianCplBlack,
    maxCplWhite, maxCplBlack, statsWhite, statsBlack,
    accuracyWhite, accuracyBlack, eloWhite, eloBlack, bestMoveObj, worstMoveObj,
  };
}
async function requestAnalysis() {
  const btn = $id('requestAnalysisBtn');
  const loading = $id('analysisLoading');
  const content = $id('analysisContent');
  const block = $id('analysisBlock');

  block.classList.remove('hidden');
  loading.classList.remove('hidden');
  content.innerHTML = '';
  btn.disabled = true;

  startProgress();

  const runId = ++analysisRunId;

  try {
    const fens = state.fenHistory;
    const moves = state.game.history({ verbose: true });
    if (fens.length < 2) throw new Error('Недостаточно ходов для анализа.');

    await waitForEngine(3000);
    if (!isEngineReady) throw new Error('Движок Stockfish не готов. Обновите страницу и попробуйте снова.');

    // Если последняя позиция партии всё ещё анализируется в фоне (Infinite
    // Analysis) — останавливаем и сохраняем в кэш то, что уже накоплено.
    await stopBackgroundAnalysis();

    const weakPc = state.settings.analysisMode === 'weak';
    const baseDepth = weakPc ? ANALYSIS_TARGET.weakReviewBaseDepth : ANALYSIS_TARGET.reviewBaseDepth;
    const criticalDepth = weakPc ? ANALYSIS_TARGET.weakReviewCriticalDepth : ANALYSIS_TARGET.reviewCriticalDepth;

    // ФАЗА 1 (быстрая, ТЗ п.2): НЕ ждём baseDepth/criticalDepth по каждой
    // позиции — берём то, что уже накоплено в общем кэше (в т.ч. частично из
    // Live Analysis прямо во время партии), и только для полностью
    // непроанализированных позиций делаем короткий разовый скан, чтобы
    // результат вообще был. Это даёт мгновенный предварительный
    // Accuracy/CPL без «обязательного глубокого анализа всей партии».
    const total = fens.length;
    const prelimEvaluations = [];
    for (let i = 0; i < fens.length; i++) {
      const result = analysisCache.get(fens[i]) || await analyzePosition(fens[i], { movetime: 250 });
      prelimEvaluations.push(result);
      updateProgress(i + 1, total, moves[i] ? moves[i].san : null);
    }

    const prelimStats = computeGameStats(fens, moves, prelimEvaluations);
    stopProgress(true);
    renderAnalysis({
      totalPly: moves.length,
      totalFullMoves: Math.ceil(moves.length / 2),
      accuracyWhite: prelimStats.accuracyWhite, accuracyBlack: prelimStats.accuracyBlack,
      eloWhite: prelimStats.eloWhite, eloBlack: prelimStats.eloBlack,
      avgCplWhite: prelimStats.avgCplWhite, avgCplBlack: prelimStats.avgCplBlack,
      bestMoveObj: prelimStats.bestMoveObj, worstMoveObj: prelimStats.worstMoveObj,
      comment: 'Уточняю анализ партии в фоне…',
    }, { refining: true });
    hideConnectionBanner();

    // ФАЗА 2 (фоновая, ТЗ п.2): обычные позиции доуглубляются до baseDepth,
    // критические — до criticalDepth с MultiPV 2–3; когда результат готов,
    // Accuracy/CPL/Elo пересчитываются и отображение обновляется. Не ждём
    // (не await) — интерфейс уже разблокирован в finally ниже.
    refineGameAnalysis(runId, fens, moves, weakPc, baseDepth, criticalDepth);
  } catch (error) {
    console.error('Ошибка анализа:', error);
    stopProgress(false);
    content.innerHTML = `<p class="analysis-error">Не удалось получить анализ. ${escapeHtml(error.message)}</p>`;
    showConnectionBanner(`Ошибка: ${error.message}`);
  } finally {
    loading.classList.add('hidden');
    btn.disabled = false;
    btn.textContent = 'Обновить анализ';
  }
}

// Фоновое углубление уже показанного предварительного результата (ТЗ п.2).
// Ничего не блокирует — интерфейс к этому моменту уже разблокирован в
// requestAnalysis. Проверяет runId на каждом шаге, чтобы не затереть более
// новый запуск анализа, если пользователь нажал «Обновить анализ» повторно.
async function refineGameAnalysis(runId, fens, moves, weakPc, baseDepth, criticalDepth) {
  try {
    // Дренируем то, что уже накопилось в приоритетной очереди отложенного
    // анализа (быстрые ходы партии) — подтягиваем их к базовой глубине.
    while (analysisQueue.length) {
      if (runId !== analysisRunId) return;
      await processAnalysisQueueOnce();
    }
    if (runId !== analysisRunId) return;

    const evaluations = [];
    for (let i = 0; i < fens.length; i++) {
      if (runId !== analysisRunId) return;
      const result = await analyzePosition(fens[i], { minDepth: baseDepth });
      evaluations.push(result);
    }
    if (runId !== analysisRunId) return;

    let stats = computeGameStats(fens, moves, evaluations);

    // Критические ходы (ТЗ п.5/11): доанализируем позицию ДО хода глубже и
    // с MultiPV 2-3. Ограничиваем число доанализов, чтобы не перегрузить
    // слабый ПК.
    const criticalItems = stats.moveAnalysis.filter(m => m.critical).sort((a, b) => b.loss - a.loss).slice(0, weakPc ? 3 : 8);
    for (const item of criticalItems) {
      if (runId !== analysisRunId) return;
      try {
        const deep = await analyzePosition(item.fenBefore, { minDepth: criticalDepth });
        if (deep) { item.depth = deep.depth; item.bestMove = deep.bestMove; item.pv = deep.pv; }
        const candidates = await searchTopMoves(item.fenBefore, { movetime: weakPc ? 500 : 900, multipv: weakPc ? 2 : 3 });
        item.alternatives = describeCandidateMoves(item.fenBefore, candidates);
      } catch (e) { /* если доанализ не удался — оставляем базовый результат */ }
    }
    if (runId !== analysisRunId) return;

    // Пересчитываем финальную статистику на доуглублённых evaluations и
    // переносим уточнённые depth/bestMove/PV/alternatives критических ходов.
    stats = computeGameStats(fens, moves, evaluations);
    stats.moveAnalysis.forEach((m) => {
      const refined = criticalItems.find(c => c.fenBefore === m.fenBefore && c.move.san === m.move.san);
      if (refined) { m.depth = refined.depth; m.bestMove = refined.bestMove; m.pv = refined.pv; m.alternatives = refined.alternatives; }
    });

    const pgn = state.game.pgn();
    let comment = 'Комментарий недоступен.';
    try {
      const prompt = `Партия в шахматы (PGN): ${pgn}
Точность белых (расчёт движка): ${stats.accuracyWhite.toFixed(1)}%, средняя потеря centipawn: ${stats.avgCplWhite.toFixed(0)}.
Точность чёрных: ${stats.accuracyBlack.toFixed(1)}%, средняя потеря centipawn: ${stats.avgCplBlack.toFixed(0)}.
Лучший ход партии: ${stats.bestMoveObj ? stats.bestMoveObj.move.san : '—'}.
Худший ход партии: ${stats.worstMoveObj ? stats.worstMoveObj.move.san : '—'}.
Дай короткий (2-3 предложения) комментарий о партии простым текстом, без markdown-разметки.`;
      const raw = await provodChat([{ role: 'user', content: prompt }], { temperature: 0.4 });
      comment = stripMarkdown(raw) || comment;
    } catch (e) {
      console.error('Ошибка комментария ИИ:', e);
    }

    if (runId !== analysisRunId) return; // пользователь успел запустить новый анализ — не затираем его результат

    renderAnalysis({
      totalPly: moves.length,
      totalFullMoves: Math.ceil(moves.length / 2),
      accuracyWhite: stats.accuracyWhite, accuracyBlack: stats.accuracyBlack,
      eloWhite: stats.eloWhite, eloBlack: stats.eloBlack,
      avgCplWhite: stats.avgCplWhite, avgCplBlack: stats.avgCplBlack,
      bestMoveObj: stats.bestMoveObj, worstMoveObj: stats.worstMoveObj,
      comment,
    });

    if (window.Achievements) {
      const evaluationsAbsoluteWhite = fens.map((fen, i) => scoreAbsoluteWhite(evaluations[i], fen));
      window.Achievements.trackAnalysis({
        accuracyWhite: stats.accuracyWhite, accuracyBlack: stats.accuracyBlack,
        eloWhite: stats.eloWhite, eloBlack: stats.eloBlack,
        moveAnalysis: stats.moveAnalysis, evaluationsAbsoluteWhite,
      });
    }
    updateAccountEloFromGame(state.playerColor === 'w' ? stats.eloWhite : stats.eloBlack);
  } catch (error) {
    console.error('Ошибка фонового уточнения анализа:', error);
  }
}

function renderAnalysis(data, { refining = false } = {}) {
  const {
    totalPly, totalFullMoves, accuracyWhite, accuracyBlack,
    eloWhite, eloBlack, avgCplWhite, avgCplBlack, bestMoveObj, worstMoveObj, comment,
  } = data;
  const content = $id('analysisContent');
  let html = `<div class="analysis-stat"><span>Всего ходов</span><b>${totalFullMoves} <span class="muted">(${totalPly} полуходов)</span></b></div>`;
  html += `<div class="analysis-stat"><span>Точность белых</span><b>${accuracyWhite.toFixed(1)}% <span class="muted">(CPL ${avgCplWhite.toFixed(0)})</span></b></div>`;
  html += `<div class="analysis-stat"><span>Точность чёрных</span><b>${accuracyBlack.toFixed(1)}% <span class="muted">(CPL ${avgCplBlack.toFixed(0)})</span></b></div>`;
  html += `<div class="analysis-stat"><span>Оценка уровня (белые)</span><b>~${eloWhite} Elo</b></div>`;
  html += `<div class="analysis-stat"><span>Оценка уровня (чёрные)</span><b>~${eloBlack} Elo</b></div>`;

  if (bestMoveObj) {
    html += `<div class="move-card move-card-best" data-fen="${escapeHtml(bestMoveObj.fenBefore)}" data-san="${escapeHtml(bestMoveObj.move.san)}">
      <span class="move-card-label">🟢 Лучший ход</span><span class="move-card-san">${escapeHtml(bestMoveObj.move.san)}</span>
    </div>`;
  }
  if (worstMoveObj) {
    html += `<div class="move-card move-card-worst" data-fen="${escapeHtml(worstMoveObj.fenBefore)}" data-san="${escapeHtml(worstMoveObj.move.san)}">
      <span class="move-card-label">🔴 Худший ход</span><span class="move-card-san">${escapeHtml(worstMoveObj.move.san)}</span>
    </div>`;
  }

  html += `<p class="analysis-comment">${escapeHtml(comment)}</p>`;
  if (refining) {
    // Предварительный результат (ТЗ п.2) — сообщаем, что цифры ещё уточняются
    // в фоне; переиспользуем существующий класс, новых стилей не требуется.
    html += `<p class="analysis-disclaimer">⏳ Быстрый предварительный результат — Stockfish продолжает углублять анализ в фоне, значения скоро уточнятся.</p>`;
  }
  html += `<p class="analysis-disclaimer">Точность, CPL и Elo рассчитаны Stockfish; Elo — грубая оценка, не официальный рейтинг.</p>`;
  content.innerHTML = html;

  content.querySelectorAll('.move-card').forEach(card => {
    card.addEventListener('click', () => {
      const label = card.classList.contains('move-card-best') ? 'best'
        : card.classList.contains('move-card-worst') ? 'worst' : null;
      openMoveDetail(card.dataset.fen, card.dataset.san, label);
      if (card.classList.contains('move-card-best') && window.Achievements) {
        window.Achievements.trackBestMoveView();
      }
    });
  });
}

$id('requestAnalysisBtn').addEventListener('click', requestAnalysis);

/* =========================================================================
   АНИМАЦИИ
   ========================================================================= */
function highlightLastMoveFade(from, to) {
  $('#board .last-move-src, #board .last-move-dst').removeClass('last-move-src last-move-dst is-fading');
  const $from = $(`#board .square-${from}`).addClass('last-move-src');
  const $to = $(`#board .square-${to}`).addClass('last-move-dst');
  setTimeout(() => { $from.addClass('is-fading'); $to.addClass('is-fading'); }, 650);
  setTimeout(() => {
    $from.removeClass('last-move-src is-fading');
    $to.removeClass('last-move-dst is-fading');
  }, 2200);
}

function animateCapture(square, color = 'red') {
  const $sq = $(`#board .square-${square}`);
  const cls = color === 'green' ? 'capture-flash-green' : 'capture-flash-red';
  $sq.addClass(cls);
  setTimeout(() => $sq.removeClass(cls), 800);
}

/* =========================================================================
   ЗВУК (аудиофайлы из assests/)
   ========================================================================= */
// Соответствие событий и файлов из папки assests:
//   step.wav  — ход/взятие фигуры
//   check.wav — шах
//   win.wav   — победа игрока
//   lose.wav  — поражение игрока
//   error.wav — ошибка (неверный ход, сбой сети, неверный ввод)
//   click.wav — клик по интерфейсу
//   ach.wav   — получено достижение
const SOUND_FILES = {
  move: 'assests/step.wav',
  capture: 'assests/step.wav',
  check: 'assests/check.wav',
  win: 'assests/win.wav',
  lose: 'assests/lose.wav',
  error: 'assests/error.wav',
  ui: 'assests/click.wav',
  achievement: 'assests/ach.wav',
  notification: 'assests/notif.wav',
};
const soundElCache = {};
function getSoundTemplate(kind) {
  const src = SOUND_FILES[kind];
  if (!src) return null;
  if (!soundElCache[kind]) {
    const audio = new Audio(src);
    audio.preload = 'auto';
    soundElCache[kind] = audio;
  }
  return soundElCache[kind];
}
// Какая настройка отвечает за какую категорию звука:
//   soundMoves    — звук хода (step)
//   soundCaptures — звук взятия (step)
//   soundCheck    — звук шаха (check)
//   soundMate     — звуки победы/поражения (win/lose)
//   soundUi       — звуки интерфейса: клики, ошибки, достижения (click/error/ach)
function isSoundKindEnabled(kind) {
  const s = state.settings;
  if (kind === 'move') return s.soundMoves;
  if (kind === 'capture') return s.soundCaptures;
  if (kind === 'check') return s.soundCheck;
  if (kind === 'win' || kind === 'lose') return s.soundMate;
  if (kind === 'ui' || kind === 'error' || kind === 'achievement' || kind === 'ach') return s.soundUi;
  if (kind === 'notification') return s.soundUi;
  return false;
}
function playSound(kind) {
  if (kind === 'ach') kind = 'achievement';
  if (!isSoundKindEnabled(kind)) return;
  const template = getSoundTemplate(kind);
  if (!template) return;
  try {
    const node = template.cloneNode(true);
    node.volume = clamp(state.settings.volume / 100, 0, 1);
    const playPromise = node.play();
    if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
  } catch (e) { /* тихо игнорируем */ }
}
window.playChessSound = playSound;

/* =========================================================================
   ПАНЕЛЬ НАСТРОЕК
   ========================================================================= */
function syncAutoHintAvailability() {
  const row = $id('autoHintRow');
  const delayRow = $id('autoHintDelayRow');
  const note = $id('autoHintCharacterNote');
  if (!row || !delayRow || !note) return;
  const isCharacterMode = state.mode === 'characters';
  row.classList.toggle('hidden', isCharacterMode);
  note.classList.toggle('hidden', !isCharacterMode);
  delayRow.classList.toggle('hidden', isCharacterMode || !state.settings.autoHint);
}

/* Настройки — это view внутри общей боковой Side Panel (см. блок навигации
   ниже), а не отдельный overlay. Эти функции сохранены как совместимый
   тонкий алиас поверх единого navigateTo()/navigateBack(), т.к. на них
   могут быть внешние ссылки; вся реальная логика — в navigationState. */
function openSettingsPanel() {
  if (!$id('menuOverlay')) {
    console.error('Боковая панель (menuOverlay) не найдена');
    return;
  }
  if (!$id('menuOverlay').classList.contains('open')) openSidePanel();
  navigateTo('settings');
}
function closeSettingsPanel() {
  if (typeof getCurrentView === 'function' && getCurrentView() === 'settings') navigateBack();
}

function applyAccent(name) {
  document.documentElement.setAttribute('data-accent', name);
  localStorage.setItem('chessAccent', name);
  state.settings.accent = name;
  document.querySelectorAll('.accent-swatch').forEach(el => {
    el.classList.toggle('is-active', el.dataset.accent === name);
  });
  const knightImg = $id('homeKnightImg');
  if (knightImg) {
    const knightSrcMap = {
      gold: 'assests/knight.png',
      maroon: 'assests/knight red.png',
      blue: 'assests/knight blue.png',
      green: 'assests/knight green.png',
    };
    knightImg.src = knightSrcMap[name] || 'assests/knight.png';
  }
}

function applyBoardStyle(name) {
  document.documentElement.setAttribute('data-board-style', name);
  localStorage.setItem('chessBoardStyle', name);
  state.settings.boardStyle = name;
  document.querySelectorAll('#boardStyleRow .board-style-btn').forEach(el => {
    el.classList.toggle('is-active', el.dataset.boardStyle === name);
  });
}

function applyGlow(on) {
  document.documentElement.classList.toggle('no-glow', !on);
  localStorage.setItem('chessGlow', on ? '1' : '0');
  state.settings.perfGlow = on;
}

function applyHomeEnemies(on) {
  state.settings.homeEnemies = on;
  localStorage.setItem('chess_homeEnemies', on ? '1' : '0');
  if (on) {
    if (figureState && homePageVisible) startEnemySpawner();
  } else {
    stopEnemySpawner();
    if (figureState) {
      figureState.enemies.forEach(enemy => enemy.el.remove());
      figureState.enemies = [];
    }
  }
}

function applyPerfMode() {
  const lowPerf = !state.settings.perfHighFps || !state.settings.perfSmoothAnim;
  document.documentElement.classList.toggle('perf-low', lowPerf);
}

/* ---- Режим анализа («Стандартный» / «Слабый ПК») ---- */
function applyAnalysisMode(mode) {
  const value = mode === 'weak' ? 'weak' : 'standard';
  state.settings.analysisMode = value;
  localStorage.setItem('chess_analysisMode', value);
  document.querySelectorAll('#analysisModeRow .board-style-btn').forEach(el => {
    el.classList.toggle('is-active', el.dataset.analysisMode === value);
  });
  const desc = $id('analysisModeDesc');
  if (desc) {
    desc.textContent = value === 'weak'
      ? 'После каждого хода — короткий анализ (глубина ~12), затем движок полностью останавливается. Минимальная нагрузка на процессор.'
      : 'Infinite Analysis: пока вы думаете над ходом, движок непрерывно анализирует позицию в фоне. Итоговый анализ партии строится почти мгновенно, но нагрузка на процессор повышена.';
  }
}

// Настройку режима анализа нельзя менять во время партии — блокируем
// переключатель и показываем подсказку, пока идёт партия.
function syncAnalysisModeLock() {
  const row = $id('analysisModeRow');
  const note = $id('analysisModeLockNote');
  if (!row || !note) return;
  const locked = !!state.game && !state.isGameOver;
  row.classList.toggle('is-disabled', locked);
  note.classList.toggle('hidden', !locked);
  row.querySelectorAll('.board-style-btn').forEach(btn => { btn.disabled = locked; });
}

function resetAutoHintTimer() {
  clearTimeout(autoHintTimer);
  if (state.mode === 'characters') return;
  if (!state.settings.autoHint || !state.game || state.isGameOver) return;
  if (state.game.turn() !== state.playerColor) return;
  autoHintTimer = setTimeout(() => {
    if (!state.isAsking) {
      $id('chatInput').value = 'Дай короткую подсказку по текущей позиции.';
      handleAsk();
    }
  }, state.settings.autoHintDelay * 1000);
}

/* initSettingsPanel() отвечает ТОЛЬКО за внутренние контролы настроек
   (тема/акцент/доска/время/звук/ИИ/автоподсказки/производительность).
   Открытие/закрытие и место настроек в навигации — забота Side Panel
   (см. initMenuPanel() и navigateTo('settings') ниже). Раньше здесь же
   навешивался обработчик на appSettingsBtn, из-за чего кнопка ☰ в игре
   открывала Settings напрямую, в обход меню, — источник "часть кнопок
   работает непредсказуемо". Убрано: кнопка ☰ всегда открывает Side Panel. */
function initSettingsPanel() {
  // Тема
  $id('settingsThemeToggle').addEventListener('click', () => { toggleTheme(); playSound('ui'); });

  // Акцент
  applyAccent(state.settings.accent);
  document.querySelectorAll('.accent-swatch').forEach(el => {
    el.addEventListener('click', () => { applyAccent(el.dataset.accent); playSound('ui'); });
  });

  // Оформление доски
  applyBoardStyle(state.settings.boardStyle);
  document.querySelectorAll('#boardStyleRow .board-style-btn').forEach(el => {
    el.addEventListener('click', () => { applyBoardStyle(el.dataset.boardStyle); playSound('ui'); });
  });

  // Режим анализа (заблокирован во время партии — см. syncAnalysisModeLock)
  applyAnalysisMode(state.settings.analysisMode);
  document.querySelectorAll('#analysisModeRow .board-style-btn').forEach(el => {
    el.addEventListener('click', () => {
      if (el.disabled) return;
      applyAnalysisMode(el.dataset.analysisMode);
      playSound('ui');
    });
  });
  syncAnalysisModeLock();
  // ---- Время партии ----
  const timeLimitedToggle = $id('timeLimitedToggle');
  const timeControlRow = $id('timeControlRow');
  const timeSlider = $id('timeControlSlider');

  timeLimitedToggle.checked = state.settings.timeLimited;
  timeControlRow.classList.toggle('hidden', !state.settings.timeLimited);

  timeLimitedToggle.addEventListener('change', () => {
    state.settings.timeLimited = timeLimitedToggle.checked;
    localStorage.setItem('chessTimeLimited', timeLimitedToggle.checked ? '1' : '0');
    timeControlRow.classList.toggle('hidden', !timeLimitedToggle.checked);
    playSound('ui');
    if (state.game && !state.isGameOver) {
      resetTimers();
      startTimer();
    }
  });

  timeSlider.value = state.settings.timeControl;
  $id('timeControlValue').textContent = state.settings.timeControl;
  timeSlider.addEventListener('input', () => {
    state.settings.timeControl = parseInt(timeSlider.value, 10);
    $id('timeControlValue').textContent = timeSlider.value;
    localStorage.setItem('chessTimeControl', timeSlider.value);
    if (state.game && !state.isGameOver) {
      resetTimers();
      startTimer();
    }
});

  // Звук: чекбоксы
  const soundIds = ['soundMoves', 'soundCaptures', 'soundCheck', 'soundMate', 'soundUi'];
  const soundKindMap = {
    soundMoves: 'move',
    soundCaptures: 'capture',
    soundCheck: 'check',
    soundMate: 'win',
    soundUi: 'ui'
  };
  soundIds.forEach(id => {
    const el = $id(id);
    el.checked = state.settings[id];
    el.addEventListener('change', () => {
      state.settings[id] = el.checked;
      localStorage.setItem('chess_' + id, el.checked ? '1' : '0');
      const kind = soundKindMap[id];
      if (kind) {
        // playSound сам проверит, включён ли этот звук в настройках
        playSound(kind);
      }
    });
  });

  const volumeSlider = $id('volumeSlider');
  volumeSlider.value = state.settings.volume;
  $id('volumeValue').textContent = state.settings.volume;
  volumeSlider.addEventListener('input', () => {
    state.settings.volume = parseInt(volumeSlider.value, 10);
    $id('volumeValue').textContent = volumeSlider.value;
    localStorage.setItem('chessVolume', volumeSlider.value);
  });
  volumeSlider.addEventListener('change', () => playSound('ui'));

  // ИИ: температура
  const tempSlider = $id('temperatureSlider');
  tempSlider.value = state.settings.temperature;
  $id('temperatureValue').textContent = state.settings.temperature;
  tempSlider.addEventListener('input', () => {
    state.settings.temperature = parseInt(tempSlider.value, 10);
    $id('temperatureValue').textContent = state.settings.temperature;
    localStorage.setItem('chessTemperature', String(tempSlider.value));
  });

  // ИИ: длина ответа
  const respSelect = $id('responseLengthSelect');
  respSelect.value = state.settings.responseLength;
  respSelect.addEventListener('change', () => {
    state.settings.responseLength = respSelect.value;
    localStorage.setItem('chessResponseLength', respSelect.value);
  });

  // Автоподсказки
  const autoHintToggle = $id('autoHintToggle');
  const autoHintDelayRow = $id('autoHintDelayRow');
  const autoHintDelaySlider = $id('autoHintDelaySlider');
  autoHintToggle.checked = state.settings.autoHint;
  autoHintDelayRow.classList.toggle('hidden', !state.settings.autoHint);
  autoHintToggle.addEventListener('change', () => {
    state.settings.autoHint = autoHintToggle.checked;
    localStorage.setItem('chessAutoHint', autoHintToggle.checked ? '1' : '0');
    autoHintDelayRow.classList.toggle('hidden', !autoHintToggle.checked);
    resetAutoHintTimer();
  });
  autoHintDelaySlider.value = state.settings.autoHintDelay;
  $id('autoHintDelayValue').textContent = state.settings.autoHintDelay;
  autoHintDelaySlider.addEventListener('input', () => {
    state.settings.autoHintDelay = parseInt(autoHintDelaySlider.value, 10);
    $id('autoHintDelayValue').textContent = autoHintDelaySlider.value;
    localStorage.setItem('chessAutoHintDelay', autoHintDelaySlider.value);
  });

  // Производительность
  const perfIds = ['perfHardware', 'perfHighFps', 'perfSmoothAnim'];
  perfIds.forEach(id => {
    const el = $id(id);
    el.checked = state.settings[id];
    el.addEventListener('change', () => {
      state.settings[id] = el.checked;
      localStorage.setItem('chess_' + id, el.checked ? '1' : '0');
      applyPerfMode();
    });
  });
  applyPerfMode();

  // Эффекты свечения
  const glowToggle = $id('perfGlow');
  glowToggle.checked = state.settings.perfGlow;
  applyGlow(glowToggle.checked);
  glowToggle.addEventListener('change', () => applyGlow(glowToggle.checked));

  // Вражеские пешки на главном экране
  const homeEnemiesToggle = $id('homeEnemiesToggle');
  if (homeEnemiesToggle) {
    homeEnemiesToggle.checked = state.settings.homeEnemies;
    homeEnemiesToggle.addEventListener('change', () => {
      applyHomeEnemies(homeEnemiesToggle.checked);
      playSound('ui');
    });
  }

  // О программе
  $id('aboutLicensesLink').addEventListener('click', (e) => {
    e.preventDefault();
    showToast('chessboard.js, chess.js и Stockfish распространяются по своим open-source лицензиям (MIT/GPL)');
  });
}

/* =========================================================================
   АККАУНТ
   -------------------------------------------------------------------------
   getAccount/saveAccount/clearAccount — локальный кэш в localStorage,
   нужен для мгновенной отрисовки профиля без ожидания сети. Источник
   истины — таблица profiles в Supabase; после логина/загрузки сессии
   кэш синхронизируется через fetchProfileFromSupabase().
   ========================================================================= */
const ACCOUNT_STORAGE_KEY = 'chessAccount';

function getAccount() {
  try {
    const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function saveAccount(acc) {
  try { localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(acc)); } catch (e) {}
}
function clearAccount() {
  try { localStorage.removeItem(ACCOUNT_STORAGE_KEY); } catch (e) {}
}

// Подтягивает профиль пользователя из таблицы profiles и обновляет локальный кэш.
async function fetchProfileFromSupabase(userId) {
  const { data, error } = await sb
    .from('profiles')
    .select('name, avatar, elo')
    .eq('id', userId)
    .single();
  if (error || !data) return null;
  const acc = { name: data.name, avatar: data.avatar || '♟', elo: data.elo ?? 1200 };
  saveAccount(acc);
  return acc;
}

// Записывает изменения профиля (например, новый Elo) в Supabase и локальный кэш.
async function syncProfileToSupabase(userId, patch) {
  const { error } = await sb
    .from('profiles')
    .update(patch)
    .eq('id', userId);
  if (error) console.error('Не удалось сохранить профиль в Supabase:', error);
}

const ELO_HISTORY_LIMIT = 200;

// Гарантирует наличие eloHistory у старых аккаунтов (первая точка = стартовый Elo).
function ensureEloHistory(acc) {
  if (!Array.isArray(acc.eloHistory) || !acc.eloHistory.length) {
    acc.eloHistory = [{ n: 0, elo: Number.isFinite(acc.elo) ? acc.elo : 1200, delta: 0, ts: Date.now() }];
  }
  return acc.eloHistory;
}

// Обновляем рейтинг аккаунта после анализа партии (плавное скользящее среднее)
async function updateAccountEloFromGame(playerElo) {
  // «На одном ПК» (friend) не участвует в рейтинге: не начисляем и не пишем в историю.
  if (state.mode === 'friend') return;

  const acc = getAccount();
  if (!acc || !Number.isFinite(playerElo)) return;

  const history = ensureEloHistory(acc);

  // Защита от дублей: повторный вызов для той же партии (например, повторное
  // «Обновить анализ») не должен добавлять вторую точку в историю.
  const gameKey = (state.game && typeof state.game.pgn === 'function') ? state.game.pgn() : null;
  if (gameKey && acc.lastEloGameKey === gameKey) return;

  const base = Number.isFinite(acc.elo) ? acc.elo : 1200;
  const newElo = Math.round(base * 0.7 + playerElo * 0.3);
  const delta = newElo - base;
  acc.elo = newElo;

  const lastPoint = history[history.length - 1];
  history.push({ n: lastPoint.n + 1, elo: newElo, delta, ts: Date.now() });
  if (history.length > ELO_HISTORY_LIMIT) {
    acc.eloHistory = [history[0], ...history.slice(-(ELO_HISTORY_LIMIT - 1))];
  }
  if (gameKey) acc.lastEloGameKey = gameKey;

  saveAccount(acc);
  renderMenuProfile();
  if (getCurrentView() === 'stats') renderStatsView();

  const { data: { user } } = await sb.auth.getUser();
  if (user) syncProfileToSupabase(user.id, { elo: acc.elo });
}

function renderMenuProfile() {
  const avatarEl = $id('menuAvatar');
  const nameEl = $id('menuProfileName');
  const eloEl = $id('menuProfileElo');
  const authBtn = $id('menuAuthBtn');
  const cardEl = $id('menuProfileCard');
  if (!avatarEl || !nameEl || !eloEl || !authBtn || !cardEl) return;

  const acc = getAccount();
  if (acc) {
    avatarEl.textContent = acc.avatar || '♟';
    nameEl.textContent = acc.name || 'Игрок';
    eloEl.textContent = `${Number.isFinite(acc.elo) ? acc.elo : 1200} Elo`;
    eloEl.classList.remove('hidden');
    authBtn.classList.add('hidden');
    cardEl.classList.remove('is-guest');
  } else {
    avatarEl.textContent = '♟';
    nameEl.textContent = 'Гость';
    eloEl.classList.add('hidden');
    authBtn.classList.remove('hidden');
    cardEl.classList.add('is-guest');
  }
}

/* ---- Мок-авторизация (полностью локальная, без сервера) ----
   Вход — короткое самостоятельное действие, поэтому остаётся обычной
   модалкой (см. правило: модалки — только для коротких действий),
   а не view боковой панели. */
function openAuthModal() {
  ['authLoginEmail', 'authLoginPassword', 'authRegisterName', 'authRegisterEmail', 'authRegisterPassword', 'authRegisterPassword2'].forEach((id) => {
    const el = $id(id);
    if (el) el.value = '';
  });
  clearAuthErrors();
  updatePasswordStrength('');
  showModal('authModal');
  setTimeout(() => { const el = $id('authLoginEmail'); if (el) el.focus(); }, 50);
}
async function handleLogout() {
  await sb.auth.signOut();
  clearAccount();
  renderMenuProfile();
  if (typeof getCurrentView === 'function' && getCurrentView() === 'profile') renderProfileView();
  showToast('Вы вышли из аккаунта');
}

/* =========================================================================
   ПРАВАЯ БОКОВАЯ ПАНЕЛЬ (SIDE PANEL) — ЕДИНАЯ СИСТЕМА НАВИГАЦИИ
   -------------------------------------------------------------------------
   Вся навигация приложения (Профиль / Настройки / Достижения / Статистика /
   О приложении) проходит через один navigation stack, а не через набор
   независимых пар open.../close... и showModal()/hideModal() для каждого
   раздела. Кнопка "Назад" ничего не угадывает — она просто снимает верхний
   элемент стека. Экран, соответствующий текущему верхнему элементу стека,
   получает класс .is-active; все остальные .side-view скрыты (display:none).
   ========================================================================= */
const SIDE_VIEWS = ['menu', 'profile', 'profile-edit', 'settings', 'achievements', 'stats', 'about'];
const SIDE_VIEW_TITLES = {
  menu: '',
  profile: 'Профиль',
  'profile-edit': 'Редактирование',
  settings: 'Настройки',
  achievements: 'Достижения',
  stats: 'Статистика',
  about: 'О приложении',
};

const navigationState = { stack: ['menu'] };

function getCurrentView() {
  return navigationState.stack[navigationState.stack.length - 1];
}

// Применяет текущий верхний view стека к DOM: показывает нужный .side-view,
// обновляет заголовок и кнопку "Назад/Закрыть", и вызывает hook раздела
// (заполнение реальными данными — профиль/статистика/достижения).
function renderSideView() {
  const view = getCurrentView();
  const panel = document.querySelector('.settings-panel');
  if (panel) {
    panel.classList.toggle('panel-expanded', view === 'achievements');
  }
  document.querySelectorAll('.side-view').forEach(el => {
    el.classList.toggle('is-active', el.id === `view-${view}`);
  });

  const titleEl = $id('sidePanelTitle');
  if (titleEl) titleEl.textContent = SIDE_VIEW_TITLES[view] || '';

  const backBtn = $id('menuBackBtn');
  if (backBtn) {
    const isRoot = navigationState.stack.length <= 1;
    backBtn.textContent = isRoot ? '✕' : '←';
    backBtn.setAttribute('aria-label', isRoot ? 'Закрыть' : 'Назад');
  }

  if (view === 'menu') renderMenuProfile();
  else if (view === 'profile') renderProfileView();
  else if (view === 'settings') { syncAutoHintAvailability(); syncAnalysisModeLock(); }
  else if (view === 'achievements') renderAchievementsGrid();
  else if (view === 'stats') renderStatsView();
}
function renderAchievementsGrid() {
  const container = document.getElementById('achievementsGridContainer');
  const summaryEl = document.getElementById('achievementsViewSummary');
  const barEl = document.getElementById('achievementsViewBar');
  if (!container) return;

  if (!window.Achievements || typeof window.Achievements.getAchievements !== 'function') {
    container.innerHTML = '<p class="modal-sub">Модуль достижений недоступен.</p>';
    const cards = container.querySelectorAll('.achv-card');
    cards.forEach((card, index) => {
      card.style.opacity = '0';
      card.style.transform = 'translateY(20px) scale(0.95)';
      card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      setTimeout(() => {
        card.style.opacity = '1';
        card.style.transform = 'translateY(0) scale(1)';
      }, 100 + index * 60);
    });
    return;
  }

  const list = window.Achievements.getAchievements();
  const stats = window.Achievements.getStats();
  const unlockedCount = list.filter(a => window.Achievements.isUnlocked(a.id)).length;
  const total = list.length;

  if (summaryEl) summaryEl.textContent = `${unlockedCount} / ${total}`;
  if (barEl) {
    const pct = total > 0 ? Math.round((unlockedCount / total) * 100) : 0;
    barEl.style.width = pct + '%';
  }

  // Сортируем: открытые сверху
  const sorted = list.slice().sort((a, b) => {
    const ua = window.Achievements.isUnlocked(a.id);
    const ub = window.Achievements.isUnlocked(b.id);
    return (ua === ub) ? 0 : (ua ? -1 : 1);
  });

  container.innerHTML = sorted.map(def => {
    const unlocked = window.Achievements.isUnlocked(def.id);
    const hideInfo = def.secret && !unlocked;
    const name = hideInfo ? '???' : def.name;
    const desc = hideInfo ? 'Секретное достижение' : def.desc;
    const icon = hideInfo ? '🔒' : def.icon;
    const dateStr = unlocked ? new Date(window.Achievements.getUnlockDate(def.id)).toLocaleDateString('ru-RU') : '';
    let progressHtml = '';
    if (def.progress && !hideInfo) {
      const p = def.progress(stats);
      const pct = Math.min(100, Math.round((p.current / p.goal) * 100));
      progressHtml = `<div class="achv-progress"><div class="achv-progress-bar" style="width:${pct}%"></div></div>
        <div class="achv-progress-label">${Math.min(p.current, p.goal)} / ${p.goal}</div>`;
    }
    return `<div class="achv-card ${unlocked ? 'is-unlocked' : 'is-locked'} ${def.secret ? 'is-secret' : ''}">
      <div class="achv-card-icon">${icon}</div>
      <div class="achv-card-name">${escapeHtml(name)}</div>
      <div class="achv-card-desc">${escapeHtml(desc)}</div>
      ${progressHtml}
      ${unlocked ? `<div class="achv-card-date">Получено: ${dateStr}</div>` : ''}
    </div>`;
  }).join('');

  // Применяем эффект "колеса" сразу же, не дожидаясь первого скролла —
  // ждём кадр отрисовки, чтобы карточки успели встать на свои места.
  if (typeof applySpinEffect === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(applySpinEffect));
  }
}
// Переход вперёд — кладём новый view на вершину стека.
function navigateTo(view) {
  if (!SIDE_VIEWS.includes(view)) { console.warn('Неизвестный view боковой панели:', view); return; }
  if (getCurrentView() !== view) {
    navigationState.stack.push(view);
    playSound('ui');
  }
  renderSideView();
}

// Кнопка "Назад" (и Escape) — ЕДИНСТВЕННЫЙ способ вернуться назад.
// Никаких if(profileOpen)/else if(settingsOpen) — просто pop() стека.
// Если мы уже в корне (menu) — закрываем панель целиком.
function navigateBack() {
  if (navigationState.stack.length > 1) {
    navigationState.stack.pop();
    renderSideView();
  } else {
    closeSidePanel();
  }
}

function resetNavigation() {
  navigationState.stack = ['menu'];
  renderSideView();
}

function openSidePanel() {
  resetNavigation(); // панель всегда открывается с корневого экрана — Menu
  const overlay = $id('menuOverlay');
  if (!overlay) { console.error('menuOverlay не найден'); return; }
  overlay.classList.add('open');
  playSound('ui');
}
function closeSidePanel() {
  const overlay = $id('menuOverlay');
  if (overlay) overlay.classList.remove('open');
  // Стек намеренно не сбрасываем здесь — иначе смена view "мигала" бы прямо
  // во время анимации закрытия. Сброс происходит в openSidePanel() при
  // следующем открытии (см. resetNavigation()).
}

// Обратно совместимые алиасы — те же имена, что были в проекте раньше,
// чтобы не плодить дубликаты функций с другими названиями.
function openMenuPanel() { openSidePanel(); }
function closeMenuPanel() { closeSidePanel(); }

/* ---- Единый обработчик навигации меню ----
   Значения data-menu-action у пунктов меню ('profile', 'settings',
   'achievements', 'stats', 'about') совпадают с именами view — поэтому
   обработчик сводится к одному вызову navigateTo(). */
function handleMenuAction(action) {
  navigateTo(action);
}

/* ---- Профиль ----
   openProfileModal()/openProfileEditModal() — сохранённые имена старых
   функций, теперь просто переключают view внутри панели вместо
   showModal('profileModal')/showModal('profileEditModal'). */
function openProfileModal() {
  navigateTo('profile');
}
function renderProfileView() {
  const acc = getAccount();
  const avatarEl = $id('profileViewAvatar');
  const nameEl = $id('profileViewName');
  const eloEl = $id('profileViewElo');
  const statsEl = $id('profileViewStats');
  const guestEl = $id('profileViewGuest');
  const editBtn = $id('profileEditBtn');
  const logoutBtn = $id('profileLogoutBtn');
  if (!avatarEl || !nameEl || !eloEl) return;

  if (acc) {
    avatarEl.textContent = acc.avatar || '♟';
    nameEl.textContent = acc.name || 'Игрок';
    eloEl.textContent = `${Number.isFinite(acc.elo) ? acc.elo : 1200} Elo`;
    eloEl.classList.remove('hidden');
    if (guestEl) guestEl.classList.add('hidden');
    if (statsEl) statsEl.classList.remove('hidden');
    if (editBtn) editBtn.classList.remove('hidden');
    if (logoutBtn) logoutBtn.classList.remove('hidden');

    // Реальные данные из существующей системы достижений — без выдуманных значений.
    const stats = window.Achievements?.getStats?.();
    const eloStatEl = $id('profileStatElo');
    const winsEl = $id('profileStatWins');
    const gamesEl = $id('profileStatGames');
    if (eloStatEl) eloStatEl.textContent = Number.isFinite(acc.elo) ? acc.elo : 1200;
    if (winsEl) winsEl.textContent = stats && Number.isFinite(stats.winsTotal) ? stats.winsTotal : '—';
    if (gamesEl) gamesEl.textContent = stats && Number.isFinite(stats.gamesPlayed) ? stats.gamesPlayed : '—';
  } else {
    avatarEl.textContent = '♟';
    nameEl.textContent = 'Гость';
    eloEl.classList.add('hidden');
    if (statsEl) statsEl.classList.add('hidden');
    if (editBtn) editBtn.classList.add('hidden');
    if (logoutBtn) logoutBtn.classList.add('hidden');
    if (guestEl) guestEl.classList.remove('hidden');
  }
}

function openProfileEditModal() {
  const acc = getAccount() || { name: '', avatar: '♟', elo: 1200 };
  $id('profileEditNameInput').value = acc.name || '';
  document.querySelectorAll('#profileAvatarPicker .avatar-choice-btn').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.avatar === (acc.avatar || '♟'));
  });
  navigateTo('profile-edit');
}
function handleProfileEditSave() {
  const acc = getAccount() || { elo: 1200 };
  const name = ($id('profileEditNameInput').value || '').trim().slice(0, 24) || 'Игрок';
  const activeAvatarBtn = document.querySelector('#profileAvatarPicker .avatar-choice-btn.is-active');
  acc.name = name;
  acc.avatar = activeAvatarBtn ? activeAvatarBtn.dataset.avatar : (acc.avatar || '♟');
  if (!Number.isFinite(acc.elo)) acc.elo = 1200;
  saveAccount(acc);
  navigateBack(); // Save -> возвращаемся в Profile (renderProfileView вызовется сам)
  renderMenuProfile();
  showToast('Профиль обновлён');
}

/* ---- Достижения ----
   Полный список достижений с категориями/прогрессом/секретками рендерится
   через renderAchievementsGrid() (см. renderSideView()) напрямую из
   существующей системы window.Achievements — единственная система
   отображения достижений в приложении. */
function openAchievementsFromMenu() {
  navigateTo('achievements');
}

/* ---- Статистика ---- */
function openStatsFromMenu() {
  navigateTo('stats');
}
function renderStatsView() {
  const eloEl = $id('statsViewElo');
  const body = $id('statsViewBody');
  const acc = getAccount();
  if (eloEl) eloEl.textContent = acc && Number.isFinite(acc.elo) ? acc.elo : '—';
  renderEloChartCard(acc);
  if (body) {
    const stats = window.Achievements?.getStats?.();
    // getStats() всегда возвращает объект с нулевыми значениями по умолчанию,
    // поэтому "нет данных" определяем по gamesPlayed, а не по наличию stats.
    const hasPlayed = stats && Number.isFinite(stats.gamesPlayed) && stats.gamesPlayed > 0;
    body.innerHTML = hasPlayed
      ? renderStatsAsList(stats)
      : '<p class="modal-sub">Пока нет статистики — сыграйте первую партию, чтобы увидеть свой прогресс.</p>';
  }
}

const STAT_LABELS_RU = {
  gamesPlayed: 'Сыграно партий',
  winsTotal: 'Побед всего',
  currentWinStreak: 'Текущая серия побед',
  bestWinStreak: 'Лучшая серия побед',
  analysesCount: 'Проведено анализов партий',
  charactersPlayed: 'Персонажей сыграно',
  aiWinStreak: 'Побед подряд над Stockfish',
  modesPlayed: 'Опробовано режимов игры',
  checkTypesGiven: 'Видов шаха объявлено',
  homeEnemiesKilled: 'Побеждено на главном экране',
};
function humanizeStatKey(key) {
  if (STAT_LABELS_RU[key]) return STAT_LABELS_RU[key];
  const spaced = key.replace(/([A-Z])/g, ' $1').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
function renderStatsAsList(stats) {
  const rows = [];
  Object.keys(stats).forEach(key => {
    const val = stats[key];
    if (Array.isArray(val)) {
      rows.push(`<div class="settings-row"><span class="settings-row-label">${escapeHtml(humanizeStatKey(key))}</span><span>${val.length}</span></div>`);
    } else if (val !== null && typeof val === 'object') {
      // сложные вложенные объекты пропускаем — им нужен отдельный экран
    } else if (val !== undefined) {
      rows.push(`<div class="settings-row"><span class="settings-row-label">${escapeHtml(humanizeStatKey(key))}</span><span>${escapeHtml(String(val))}</span></div>`);
    }
  });
  return rows.length ? rows.join('') : '<p class="modal-sub">Пока нет данных.</p>';
}

/* ---- Мини-график Elo (SVG, раскрывается под ELO-хиро) ---- */
function buildEloChartSvg(history) {
  const W = 300, H = 120, padX = 10, padY = 14;
  const elos = history.map(p => p.elo);
  let min = Math.min(...elos), max = Math.max(...elos);
  if (min === max) { min -= 10; max += 10; }
  const span = max - min;
  const stepX = history.length > 1 ? (W - padX * 2) / (history.length - 1) : 0;

  const points = history.map((p, i) => ({
    ...p,
    x: padX + i * stepX,
    y: padY + (H - padY * 2) * (1 - (p.elo - min) / span),
  }));

  const linePoints = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const dots = points.map(p => `
    <g class="elo-point" tabindex="0" data-n="${p.n}" data-elo="${p.elo}" data-delta="${p.delta}"
       transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
      <circle class="elo-point-hit" r="9"></circle>
      <circle class="elo-point-dot" r="3"></circle>
    </g>`).join('');

  return `<svg class="stats-elo-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <polyline class="elo-line" points="${linePoints}" fill="none"></polyline>
    ${dots}
  </svg>`;
}

function renderEloChartCard(acc) {
  const wrap = $id('statsEloChartInner');
  if (!wrap) return;
  const history = acc ? ensureEloHistory(acc) : null;
  if (!history || history.length < 2) {
    wrap.innerHTML = '<p class="modal-sub stats-elo-chart-empty">График появится после первой рейтинговой партии.</p>';
    return;
  }
  wrap.innerHTML = buildEloChartSvg(history) + '<div class="elo-tooltip" id="statsEloTooltip" hidden></div>';
}

/* ---- О приложении ---- */
function openAboutFromMenu() {
  navigateTo('about');
}

/* =========================================================================
   ИНИЦИАЛИЗАЦИЯ РАЗДЕЛОВ БОКОВОЙ ПАНЕЛИ
   Каждый раздел инициализируется отдельно и один раз (флаг *Initialized
   защищает от повторного навешивания обработчиков при повторных вызовах).
   initMenuPanel() отвечает ТОЛЬКО за открытие/закрытие панели, backdrop,
   Escape и клики по пунктам меню — ничего больше.
   ========================================================================= */
let menuPanelInitialized = false;
function initMenuPanel() {
  if (menuPanelInitialized) return;
  menuPanelInitialized = true;

  const homeBtn = $id('homeSettingsBtn');
  const appBtn = $id('appSettingsBtn');
  const backBtn = $id('menuBackBtn');
  const backdrop = $id('menuBackdrop');

  // ☰ (и справа на главном экране, и справа в игре) — ВСЕГДА открывает
  // Side Panel и ничего больше.
  if (homeBtn) homeBtn.addEventListener('click', openSidePanel);
  if (appBtn) appBtn.addEventListener('click', openSidePanel);

  // Одна кнопка в шапке панели — она же "Назад", она же "Закрыть" (см.
  // renderSideView: на корневом view показывает ✕, на остальных — ←).
  if (backBtn) backBtn.addEventListener('click', navigateBack);
  if (backdrop) backdrop.addEventListener('click', closeSidePanel);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($id('menuOverlay')?.classList.contains('open')) navigateBack();
  });

  document.querySelectorAll('.menu-nav-item[data-menu-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      try {
        handleMenuAction(btn.dataset.menuAction);
      } catch (e) {
        console.error('Ошибка навигации меню:', e);
      }
    });
  });

  const authBtn = $id('menuAuthBtn');
  if (authBtn) authBtn.addEventListener('click', () => { closeSidePanel(); openAuthModal(); });

  renderMenuProfile();
}

/* ---- Авторизация (пока локально; структура готова под замену на Supabase) ---- */
let authInitialized = false;
function initAuth() {
  if (authInitialized) return;
  authInitialized = true;

  const closeBtn = $id('authCloseBtn');
  const googleBtn = $id('authGoogleBtn');
  const vkBtn = $id('authVkBtn');
  const tabLogin = $id('authTabLogin');
  const tabRegister = $id('authTabRegister');
  const loginForm = $id('authLoginForm');
  const registerForm = $id('authRegisterForm');

  const switchAuthTab = (tab) => {
    const isLogin = tab === 'login';
    tabLogin.classList.toggle('is-active', isLogin);
    tabRegister.classList.toggle('is-active', !isLogin);
    tabLogin.setAttribute('aria-selected', String(isLogin));
    tabRegister.setAttribute('aria-selected', String(!isLogin));
    loginForm.classList.toggle('hidden', !isLogin);
    registerForm.classList.toggle('hidden', isLogin);
    $id('authModalTitle').textContent = isLogin ? 'Вход в аккаунт' : 'Регистрация';
    clearAuthErrors();
  };

  if (tabLogin) tabLogin.addEventListener('click', () => switchAuthTab('login'));
  if (tabRegister) tabRegister.addEventListener('click', () => switchAuthTab('register'));

  if (closeBtn) closeBtn.addEventListener('click', () => hideModal('authModal'));
  $id('authLoginCancelBtn').addEventListener('click', () => hideModal('authModal'));
  $id('authRegisterCancelBtn').addEventListener('click', () => hideModal('authModal'));

  // Показать/скрыть пароль
  document.querySelectorAll('.auth-password-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $id(btn.dataset.target);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.classList.toggle('is-visible', show);
    });
  });

  // Индикатор надёжности пароля при регистрации
  const regPassword = $id('authRegisterPassword');
  if (regPassword) regPassword.addEventListener('input', () => updatePasswordStrength(regPassword.value));

  // Отправка форм
  if (loginForm) loginForm.addEventListener('submit', (e) => { e.preventDefault(); handleLoginSubmit(); });
  if (registerForm) registerForm.addEventListener('submit', (e) => { e.preventDefault(); handleRegisterSubmit(); });

  $id('authForgotBtn').addEventListener('click', () => {
    showToast('Восстановление пароля скоро будет доступно');
  });

  // Вход через Google/VK пока не реализован — заглушка с уведомлением.
  if (googleBtn) googleBtn.addEventListener('click', () => signInWithOAuthProvider('google'));
  if (vkBtn) vkBtn.addEventListener('click', () => signInWithOAuthProvider('custom:vk')); // 'vk' — slug вашего Custom Provider в Supabase

  // Клик по фону (вне .modal) закрывает модалку, как обычный modal-overlay.
  const overlay = $id('authModal');
  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) hideModal('authModal'); });

  // Escape закрывает authModal, если она открыта.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!overlay || overlay.classList.contains('hidden')) return;
    hideModal('authModal');
  });

  // Открываем модалку всегда на вкладке "Вход"
  switchAuthTab('login');
}

// Проверка текущей сессии Supabase при загрузке страницы + подписка на её изменения
async function initSupabaseSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await fetchProfileFromSupabase(session.user.id);
    renderMenuProfile();
  }

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      await fetchProfileFromSupabase(session.user.id);
    } else if (event === 'SIGNED_OUT') {
      clearAccount();
    }
    renderMenuProfile();
    if (typeof getCurrentView === 'function' && getCurrentView() === 'profile') renderProfileView();
  });
}

// Вход через OAuth-провайдера (Google — встроенный провайдер Supabase,
// VK — подключается как Custom OAuth/OIDC Provider, provider: 'vk' — это
// slug, который вы зададите при настройке в Supabase Dashboard).
// Supabase сам перенаправит на страницу провайдера и обратно; после
// редиректа сработает initSupabaseSession()/onAuthStateChange, который
// подтянет профиль — здесь ничего дополнительно обрабатывать не нужно.
async function signInWithOAuthProvider(provider) {
  const { error } = await sb.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.href.split('#')[0].split('?')[0] } // полный текущий путь, а не только домен — важно для GitHub Pages, где сайт живёт в подпапке /reponame/
  });
  if (error) showToast('Не удалось начать вход через ' + provider);
}

function clearAuthErrors() {
  document.querySelectorAll('.auth-field-error').forEach((el) => { el.textContent = ''; });
  document.querySelectorAll('.auth-field .menu-text-input').forEach((el) => el.classList.remove('is-invalid'));
}

function setFieldError(inputId, errorId, message) {
  const input = $id(inputId);
  const error = $id(errorId);
  if (input) input.classList.toggle('is-invalid', Boolean(message));
  if (error) error.textContent = message || '';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function updatePasswordStrength(pass) {
  const wrap = $id('authPasswordStrength');
  if (!wrap) return;
  const bar = wrap.querySelector('span');
  let score = 0;
  if (pass.length >= 8) score++;
  if (pass.length >= 12) score++;
  if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) score++;
  if (/\d/.test(pass)) score++;
  if (/[^A-Za-z0-9]/.test(pass)) score++;
  const levels = ['weak', 'weak', 'medium', 'medium', 'strong', 'strong'];
  wrap.dataset.level = pass ? levels[score] : '';
  bar.style.width = pass ? `${Math.min(score, 5) * 20}%` : '0%';
}

async function handleLoginSubmit() {
  clearAuthErrors();
  const email = $id('authLoginEmail').value.trim();
  const password = $id('authLoginPassword').value;
  let valid = true;

  if (!email || !EMAIL_RE.test(email)) {
    setFieldError('authLoginEmail', 'authLoginEmailError', 'Введите корректный email');
    valid = false;
  }
  if (!password) {
    setFieldError('authLoginPassword', 'authLoginPasswordError', 'Введите пароль');
    valid = false;
  }
  if (!valid) return;

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { setFieldError('authLoginPassword', 'authLoginPasswordError', 'Неверный email или пароль'); return; }

  const acc = await fetchProfileFromSupabase(data.user.id);
  hideModal('authModal');
  renderMenuProfile();
  if (typeof getCurrentView === 'function' && getCurrentView() === 'profile') renderProfileView();
  showToast(`С возвращением, ${acc ? acc.name : ''}!`);
}

async function handleRegisterSubmit() {
  clearAuthErrors();
  const name = $id('authRegisterName').value.trim().slice(0, 24);
  const email = $id('authRegisterEmail').value.trim();
  const password = $id('authRegisterPassword').value;
  const password2 = $id('authRegisterPassword2').value;
  let valid = true;

  if (!name) {
    setFieldError('authRegisterName', 'authRegisterNameError', 'Введите имя');
    valid = false;
  }
  if (!email || !EMAIL_RE.test(email)) {
    setFieldError('authRegisterEmail', 'authRegisterEmailError', 'Введите корректный email');
    valid = false;
  }
  if (!password || password.length < 8) {
    setFieldError('authRegisterPassword', 'authRegisterPasswordError', 'Минимум 8 символов');
    valid = false;
  }
  if (password2 !== password || !password2) {
    setFieldError('authRegisterPassword2', 'authRegisterPassword2Error', 'Пароли не совпадают');
    valid = false;
  }
  if (!valid) return;

  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { name } } // попадёт в user_metadata, подхватится триггером handle_new_user
  });
  if (error) { setFieldError('authRegisterEmail', 'authRegisterEmailError', error.message); return; }

  // Профиль создаётся триггером на стороне БД; кэшируем то, что уже знаем.
  saveAccount({ name, avatar: '♟', elo: 1200 });
  hideModal('authModal');
  renderMenuProfile();
  if (typeof getCurrentView === 'function' && getCurrentView() === 'profile') renderProfileView();
  showToast(`Добро пожаловать, ${name}!`);
}

/* ---- Профиль (view внутри панели) ---- */
let profileInitialized = false;
function initProfileView() {
  if (profileInitialized) return;
  profileInitialized = true;

  const editBtn = $id('profileEditBtn');
  const logoutBtn = $id('profileLogoutBtn');
  const guestAuthBtn = $id('profileViewAuthBtn');

  if (editBtn) editBtn.addEventListener('click', openProfileEditModal);
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
  if (guestAuthBtn) guestAuthBtn.addEventListener('click', () => { closeSidePanel(); openAuthModal(); });
}

/* ---- Редактирование профиля (view внутри панели) ---- */
let profileEditInitialized = false;
function initProfileEditView() {
  if (profileEditInitialized) return;
  profileEditInitialized = true;

  document.querySelectorAll('#profileAvatarPicker .avatar-choice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#profileAvatarPicker .avatar-choice-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
    });
  });

  const saveBtn = $id('profileEditSaveBtn');
  const cancelBtn = $id('profileEditCancelBtn');

  if (saveBtn) saveBtn.addEventListener('click', handleProfileEditSave);
  // Cancel -> Profile, через тот же navigateBack(), что и кнопка "←" в шапке.
  if (cancelBtn) cancelBtn.addEventListener('click', () => navigateBack());
}

/* ---- Достижения (view внутри панели) ---- */
function initAchievementsView() { /* без собственных обработчиков — только рендер данных в renderAchievementsGrid() */ }

/* ---- Статистика (view внутри панели) ---- */
function initStatsView() {
  const hero = $id('statsEloHero');
  const wrap = $id('statsEloChartWrap');
  if (!hero || !wrap || hero.dataset.bound) return;
  hero.dataset.bound = '1';

  const toggleChart = () => {
    const isOpen = wrap.classList.toggle('is-open');
    hero.classList.toggle('is-open', isOpen);
    hero.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    wrap.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  };
  hero.addEventListener('click', toggleChart);
  hero.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleChart(); }
  });

  // Делегирование событий на точки графика: hover — для десктопа,
  // click/touch — для мобильных устройств (без зависимости от hover).
  const inner = $id('statsEloChartInner');
  if (!inner) return;
  const showTip = (pointEl) => {
    const tip = $id('statsEloTooltip');
    const svg = pointEl.closest('svg');
    if (!tip || !svg) return;
    const { n, elo, delta } = pointEl.dataset;
    const d = Number(delta);
    const sign = d > 0 ? '+' : (d < 0 ? '' : '±');
    tip.innerHTML = `Партия #${n}<br>${elo} Elo<br>${sign}${d}`;
    tip.hidden = false;
    const match = pointEl.getAttribute('transform').match(/[-\d.]+/g);
    const cx = parseFloat(match[0]);
    const ratio = svg.clientWidth / 300;
    tip.style.left = `${cx * ratio}px`;
  };
  const hideTip = () => { const tip = $id('statsEloTooltip'); if (tip) tip.hidden = true; };

  inner.addEventListener('mouseover', (e) => {
    const pt = e.target.closest('.elo-point');
    if (pt) showTip(pt);
  });
  inner.addEventListener('mouseleave', hideTip);
  inner.addEventListener('click', (e) => {
    const pt = e.target.closest('.elo-point');
    if (pt) { showTip(pt); e.stopPropagation(); } else { hideTip(); }
  });
}

/* ---- Обратная связь (модалка поверх Side Panel, insert в Supabase) ---- */
let feedbackModalInitialized = false;
let feedbackSubmitting = false;
let feedbackReturnFocusEl = null;
const FEEDBACK_TYPES = ['bug', 'suggestion', 'question', 'other'];

// Только неигровые/нечувствительные данные — без FEN, истории партии или чата.
function collectFeedbackMetadata() {
  return {
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    language: 'ru',
    accent: state.settings.accent,
    boardStyle: state.settings.boardStyle,
    mode: state.mode || null,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
  };
}

function clearFeedbackErrors() {
  ['feedbackMessageError', 'feedbackContactError'].forEach((id) => {
    const el = $id(id);
    if (el) el.textContent = '';
  });
  const formErr = $id('feedbackFormError');
  if (formErr) { formErr.hidden = true; formErr.textContent = ''; }
}

function showFeedbackError(message) {
  const formErr = $id('feedbackFormError');
  if (formErr) { formErr.textContent = message; formErr.hidden = false; }
}

function setFeedbackLoading(loading) {
  feedbackSubmitting = loading;
  const btn = $id('feedbackSubmitBtn');
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? 'Отправка…' : 'Отправить';
}

function resetFeedbackForm() {
  const form = $id('feedbackForm');
  if (form) form.reset();
  clearFeedbackErrors();
  const counter = $id('feedbackMessageCounter');
  if (counter) counter.textContent = '0 / 2000';
  const fieldsGroup = $id('feedbackFieldsGroup');
  const success = $id('feedbackSuccess');
  if (fieldsGroup) fieldsGroup.classList.remove('hidden');
  if (success) success.classList.add('hidden');
  setFeedbackLoading(false);
}

function openFeedbackModal() {
  feedbackReturnFocusEl = document.activeElement;
  resetFeedbackForm();
  showModal('feedbackModal');
  const typeSelect = $id('feedbackType');
  if (typeSelect) typeSelect.focus();
}

function closeFeedbackModal() {
  if (feedbackSubmitting) return; // не закрываем модалку посреди отправки
  hideModal('feedbackModal');
  if (feedbackReturnFocusEl && typeof feedbackReturnFocusEl.focus === 'function') {
    feedbackReturnFocusEl.focus();
  }
  feedbackReturnFocusEl = null;
}

async function submitFeedback() {
  if (feedbackSubmitting) return; // защита от двойной отправки
  clearFeedbackErrors();

  const typeEl = $id('feedbackType');
  const messageEl = $id('feedbackMessage');
  const contactEl = $id('feedbackContact');
  if (!typeEl || !messageEl || !contactEl) return;

  const type = FEEDBACK_TYPES.includes(typeEl.value) ? typeEl.value : 'other';
  const message = (messageEl.value || '').trim();
  const contact = (contactEl.value || '').trim();

  if (!message) {
    showFeedbackFieldError('feedbackMessageError', 'Опишите проблему, предложение или вопрос.');
    messageEl.focus();
    return;
  }
  if (message.length > 2000) {
    showFeedbackFieldError('feedbackMessageError', 'Сообщение слишком длинное (максимум 2000 символов).');
    messageEl.focus();
    return;
  }
  if (contact.length > 120) {
    showFeedbackFieldError('feedbackContactError', 'Слишком длинный контакт (максимум 120 символов).');
    contactEl.focus();
    return;
  }

  setFeedbackLoading(true);
  try {
    const { data: { user } } = await sb.auth.getUser();
    const { error } = await sb.from('feedback').insert({
      user_id: user ? user.id : null,
      type,
      message,
      contact: contact || null,
      app_version: APP_VERSION,
      metadata: collectFeedbackMetadata(),
    });
    if (error) throw error;

    const fieldsGroup = $id('feedbackFieldsGroup');
    const success = $id('feedbackSuccess');
    if (fieldsGroup) fieldsGroup.classList.add('hidden');
    if (success) success.classList.remove('hidden');
    setFeedbackLoading(false);

    setTimeout(() => {
      const overlay = $id('feedbackModal');
      if (overlay && !overlay.classList.contains('hidden')) closeFeedbackModal();
    }, 3000);
  } catch (err) {
    console.error('Не удалось отправить обратную связь:', err);
    showFeedbackError('Не удалось отправить сообщение. Попробуйте ещё раз.');
    setFeedbackLoading(false);
  }
}
function showFeedbackFieldError(id, message) {
  const el = $id(id);
  if (el) el.textContent = message;
}

function initFeedbackModal() {
  if (feedbackModalInitialized) return;
  feedbackModalInitialized = true;

  const overlay = $id('feedbackModal');
  const form = $id('feedbackForm');
  const closeBtn = $id('feedbackCloseBtn');
  const cancelBtn = $id('feedbackCancelBtn');
  const successCloseBtn = $id('feedbackSuccessCloseBtn');
  const messageEl = $id('feedbackMessage');
  const counter = $id('feedbackMessageCounter');

  if (form) form.addEventListener('submit', (e) => { e.preventDefault(); submitFeedback(); });
  if (closeBtn) closeBtn.addEventListener('click', () => closeFeedbackModal());
  if (cancelBtn) cancelBtn.addEventListener('click', () => closeFeedbackModal());
  if (successCloseBtn) successCloseBtn.addEventListener('click', () => closeFeedbackModal());

  if (messageEl && counter) {
    messageEl.addEventListener('input', () => {
      counter.textContent = `${messageEl.value.length} / 2000`;
    });
  }

  // Клик по фону (вне .modal) закрывает модалку — как у остальных modal-overlay.
  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFeedbackModal(); });

  // Escape закрывает feedbackModal, если она открыта.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!overlay || overlay.classList.contains('hidden')) return;
    closeFeedbackModal();
  });
}

/* ---- О приложении (view внутри панели) ---- */
let aboutViewInitialized = false;
function initAboutView() {
  if (aboutViewInitialized) return;
  aboutViewInitialized = true;

  const versionEl = $id('aboutHeroVersion');
  if (versionEl) versionEl.textContent = `v${APP_VERSION}`;

  const licensesLink = $id('aboutLicensesLinkMenu');
  if (licensesLink) {
    licensesLink.addEventListener('click', (e) => {
      e.preventDefault();
      showToast('chessboard.js, chess.js и Stockfish распространяются по своим open-source лицензиям (MIT/GPL)');
    });
  }

  const feedbackBtn = $id('aboutFeedbackBtn');
  if (feedbackBtn) {
    feedbackBtn.addEventListener('click', () => openFeedbackModal());
  }
}

/* =========================================================================
   ИНИЦИАЛИЗАЦИЯ
   ========================================================================= */
document.addEventListener('visibilitychange', onHomeVisibilityChange);
document.addEventListener('DOMContentLoaded', () => {
  initStockfish();
  updateModeIcon('ai');
  initSettingsPanel();
  initMenuPanel();
  initAuth();
  initProfileView();
  initProfileEditView();
  initAchievementsView();
  initStatsView();
  initAboutView();
  initFeedbackModal();
  showHomeScreen();
  initSupabaseSession();
  if (window.Achievements) window.Achievements.init();
});
// Регистрируем ресайз доски партии один раз на весь жизненный цикл страницы
window.addEventListener('resize', () => state.board && state.board.resize());
/* =========================================================================
   ТАЙМЕР
   ========================================================================= */
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateTimerDisplay() {
  const w = $id('timerWhite');
  const b = $id('timerBlack');
  if (w) w.textContent = `♔ ${formatTime(state.timeWhite)}`;
  if (b) b.textContent = `♚ ${formatTime(state.timeBlack)}`;
  // Активный игрок
  const turn = state.game ? state.game.turn() : null;
  [w, b].forEach(el => {
    if (!el) return;
    el.classList.remove('active', 'warning');
    const player = el.dataset.player;
    if (player === turn) {
      el.classList.add('active');
      const time = player === 'w' ? state.timeWhite : state.timeBlack;
      if (time <= 10) el.classList.add('warning');
    }
  });
}

function stopTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  state.timerRunning = false;
}

function startTimer() {
  stopTimer();
  if (!state.game || state.isGameOver) return;
  if (!state.timeLimited) {
    updateTimerDisplay();
    return;
  }
  const turn = state.game.turn();
  const timeLeft = turn === 'w' ? state.timeWhite : state.timeBlack;
  if (timeLeft <= 0) {
    handleTimeOut(turn);
    return;
  }
  state.timerRunning = true;
  updateTimerDisplay();
  state.timerInterval = setInterval(() => {
    if (!state.game || state.isGameOver) {
      stopTimer();
      return;
    }
    const turnNow = state.game.turn();
    if (turnNow === 'w') {
      state.timeWhite = Math.max(0, state.timeWhite - 1);
    } else {
      state.timeBlack = Math.max(0, state.timeBlack - 1);
    }
    updateTimerDisplay();
    const left = turnNow === 'w' ? state.timeWhite : state.timeBlack;
    if (left <= 0) {
      stopTimer();
      handleTimeOut(turnNow);
    }
  }, 1000);
}

function handleTimeOut(color) {
  if (state.isGameOver) return;
  const loser = color === 'w' ? 'Белые' : 'Чёрные';
  let text;
  let outcome = 'draw';
  if (state.mode === 'friend') {
    const winner = color === 'w' ? 'Чёрные' : 'Белые';
    text = `${loser} проиграли по времени. Победили ${winner}.`;
    outcome = 'character_win';
  } else {
    const playerColor = state.playerColor;
    if (color === playerColor) {
      text = `Вы проиграли по времени. Победил соперник.`;
      outcome = 'character_win';
    } else {
      text = `Время вышло у соперника. Ничья?`;
      outcome = 'draw';
    }
  }
  state.isGameOver = true;
  stopTimer();
  updateResignButtonLabel();
  const achvOutcome = state.mode === 'friend' ? 'draw' : (outcome === 'character_win' ? 'loss' : 'draw');
  reportAchievementGameEnd(achvOutcome);
  showResultModal(text, outcome);
}

function resetTimers() {
  stopTimer();
  const minutes = state.settings.timeControl || 10;
  state.timeWhite = minutes * 60;
  state.timeBlack = minutes * 60;
  updateTimerDisplay();
  if (state.timeLimited && state.game && !state.isGameOver) {
    startTimer();
  }
}
const container = document.querySelector('.achv-grid-container');

function applySpinEffect() {
  const rect = container.getBoundingClientRect();
  const containerCenter = rect.top + rect.height / 2;
  const halfHeight = rect.height / 2;

  const cards = container.querySelectorAll('.achv-card');
  cards.forEach(card => {
    const cardRect = card.getBoundingClientRect();
    const cardCenter = cardRect.top + cardRect.height / 2;
    const offset = (cardCenter - containerCenter) / halfHeight;
    const clamped = Math.min(1, Math.max(-1, offset));

    // ---- НОВЫЙ КОД С МЁРТВОЙ ЗОНОЙ И ПЛАВНЫМ СТАРТОМ ----
    const DEAD_ZONE = 0.4;          // настройте под себя
    const MAX_ANGLE = 35;           // градусы

    let factor = 0;
    if (Math.abs(clamped) > DEAD_ZONE) {
      const rawFactor = (Math.abs(clamped) - DEAD_ZONE) / (1 - DEAD_ZONE);
      factor = Math.sign(clamped) * (rawFactor * rawFactor); // плавный вход
    }

    const angle = -factor * MAX_ANGLE;     // знак «минус» — чтобы наклонялись «наоборот»
    const opacity = 1 - Math.abs(factor) * 0.35;
    const scale = 1 - Math.abs(factor) * 0.03;

    card.style.transform = `rotateX(${angle}deg) scale(${scale})`;
    card.style.opacity = opacity;
  });
}

// Обработчик прокрутки с throttle
let ticking = false;
container.addEventListener('scroll', () => {
  if (!ticking) {
    window.requestAnimationFrame(() => {
      applySpinEffect();
      ticking = false;
    });
    ticking = true;
  }
});

// Первый расчёт
applySpinEffect();