// Детали хода (мини-доска) и разбор партии.
'use strict';

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

    if (!chatSignedIn) {
      commentEl.textContent = `Лучший ход по Stockfish: ${bestMoveSan || '—'}. Объяснение от нейросети доступно после входа в аккаунт.`;
      return;
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
    commentEl.textContent = chatErrorMessage(error);
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
    let comment = chatSignedIn ? 'Комментарий недоступен.' : 'Комментарий нейросети к партии появится после входа в аккаунт.';
    if (chatSignedIn) try {
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
