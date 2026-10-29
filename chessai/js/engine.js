// Stockfish: воркер, кэш анализа позиций и фоновый анализ.
'use strict';

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
