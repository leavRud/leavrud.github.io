// Партия: запуск, ходы на доске (перетаскивание и тапы), обработка хода.
'use strict';

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
// «Ещё раз» — новая партия с теми же режимом, цветом и сложностью.
$id('rematchBtn').addEventListener('click', () => {
  playSound('ui');
  hideModal('resultModal');
  initGame();
});
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
  $id('requestAnalysisBtn').textContent = 'Разобрать партию';
  hideModal('resultModal');
  hideConnectionBanner();
  state.gameStartedAt = Date.now();
  renderPlayerBars();
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
  tapSelectedSquare = null;
  $('#board').off('click.tap').on('click.tap', '.square-55d63', onSquareTap);

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
// Кроме перетаскивания ход можно сделать двумя нажатиями: фигура → клетка.
// На телефоне это основной способ. Выбранная фигура хранится здесь.
let tapSelectedSquare = null;

function canUserMoveNow() {
  if (!state.game || state.isGameOver || state.isThinking) return false;
  if ((state.mode === 'ai' || state.mode === 'characters') && state.game.turn() !== state.playerColor) return false;
  return true;
}

function onDragStart(source, piece) {
  if (!canUserMoveNow()) return false;
  const turn = state.game.turn();
  const isPieceWhite = piece.search(/^w/) !== -1;
  if ((turn === 'w' && !isPieceWhite) || (turn === 'b' && isPieceWhite)) return false;
  highlightLegalMoves(source);
}

function onDrop(source, target) {
  // Отпустили на той же клетке — это нажатие, а не перетаскивание:
  // выбираем фигуру (или снимаем выбор при повторном нажатии).
  if (source === target) {
    if (tapSelectedSquare === source) {
      tapSelectedSquare = null;
      clearHighlights();
    } else {
      tapSelectedSquare = source;
      highlightLegalMoves(source);
    }
    return 'snapback';
  }
  tapSelectedSquare = null;
  clearHighlights();
  if (!tryUserMove(source, target)) return 'snapback';
}

// Нажатие на клетку без своей фигуры: пустую или с фигурой соперника.
// Нажатия на свои фигуры обрабатывает onDrop (source === target).
function onSquareTap(e) {
  if (!tapSelectedSquare || !canUserMoveNow()) return;
  const square = $(e.currentTarget).attr('data-square');
  const piece = state.game.get(square);
  if (piece && piece.color === state.game.turn()) return;
  const from = tapSelectedSquare;
  tapSelectedSquare = null;
  clearHighlights();
  const isLegal = state.game.moves({ square: from, verbose: true }).some((m) => m.to === square);
  if (isLegal) tryUserMove(from, square);
}

function tryUserMove(from, to) {
  const move = state.game.move({ from, to, promotion: 'q' });
  if (move === null) {
    playSound('error');
    return false;
  }
  state.fenHistory.push(state.game.fen());
  const isUserMove = ((state.mode === 'ai' || state.mode === 'characters') && move.color === state.playerColor) || state.mode === 'friend';
  onMoveMade(move, isUserMove);
  return true;
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
  tapSelectedSquare = null;
  clearHighlights();
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

const GLYPH_VALUE = { '♙': 1, '♟': 1, '♘': 3, '♞': 3, '♗': 3, '♝': 3, '♖': 5, '♜': 5, '♕': 9, '♛': 9 };

function renderCaptured() {
  $id('capturedWhite').textContent = state.capturedByWhite.join('');
  $id('capturedBlack').textContent = state.capturedByBlack.join('');
  // Перевес по материалу показываем у того, кто впереди: «+2».
  const sum = (list) => list.reduce((n, g) => n + (GLYPH_VALUE[g] || 0), 0);
  const diff = sum(state.capturedByWhite) - sum(state.capturedByBlack);
  document.querySelectorAll('.player-bar').forEach(bar => {
    const adv = bar.dataset.side === 'w' ? diff : -diff;
    bar.querySelector('.pb-advantage').textContent = adv > 0 ? `+${adv}` : '';
  });
}

// Примерный рейтинг уровня Stockfish — та же шкала, что в eloToSkillLevel().
function skillLevelToElo(level) {
  return Math.round((500 + ((clamp(level, 1, 20) - 1) / 19) * 2400) / 50) * 50;
}

// Сверху — соперник, снизу — тот, за кого играют (в режиме «вдвоём» — белые).
// Таймер и взятые фигуры каждой стороны переезжают в строку этой стороны.
function renderPlayerBars() {
  const bottomSide = state.mode === 'friend' ? 'w' : state.playerColor;
  const topSide = bottomSide === 'w' ? 'b' : 'w';
  const acc = getAccount();
  const describe = (side) => {
    const king = side === 'w' ? '♔' : '♚';
    if (state.mode === 'friend') {
      return { king, name: side === 'w' ? 'Белые' : 'Чёрные', meta: side === 'w' ? 'Игрок 1' : 'Игрок 2' };
    }
    if (side === state.playerColor) {
      return { king, name: acc?.name || 'Вы', meta: acc ? `Рейтинг ${acc.elo ?? 1200}` : 'Гость' };
    }
    if (state.mode === 'characters' && state.character) {
      return { king, name: state.character.name, meta: `≈${state.character.elo} Эло` };
    }
    const label = LEVEL_LABEL[state.skillLevel] || 'уровень ' + state.skillLevel;
    return { king, name: 'Stockfish', meta: `${label[0].toUpperCase() + label.slice(1)} · ≈${skillLevelToElo(state.skillLevel)}` };
  };
  [[$id('playerBarTop'), topSide], [$id('playerBarBottom'), bottomSide]].forEach(([bar, side]) => {
    const info = describe(side);
    bar.dataset.side = side;
    bar.querySelector('.pb-avatar').textContent = info.king;
    bar.querySelector('.pb-name-text').textContent = info.name;
    bar.querySelector('.pb-meta').textContent = info.meta;
    bar.querySelector('.pb-material').prepend($id(side === 'w' ? 'capturedWhite' : 'capturedBlack'));
    bar.appendChild($id(side === 'w' ? 'timerWhite' : 'timerBlack'));
  });
  renderCaptured();
  updateTimerDisplay();
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
  updateTimerDisplay();
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

function resultTitleFor(text, outcome) {
  if (/Ничья|Пат/.test(text)) return 'Ничья';
  if (state.mode === 'friend') return 'Партия окончена';
  if (outcome === 'player_win') return 'Победа!';
  if (outcome === 'character_win') return 'Поражение';
  return 'Партия окончена';
}

// Цифры для итога: число ходов, сколько шла партия и сколько фигур взял игрок.
function renderResultStats(text) {
  const plies = state.game ? state.game.history().length : 0;
  const fullMoves = Math.ceil(plies / 2);
  const seconds = state.gameStartedAt ? Math.round((Date.now() - state.gameStartedAt) / 1000) : 0;
  const myCaptures = state.mode === 'friend'
    ? state.capturedByWhite.length + state.capturedByBlack.length
    : (state.playerColor === 'w' ? state.capturedByWhite : state.capturedByBlack).length;

  let reason = 'Партия окончена';
  if (/^Мат/.test(text)) reason = 'Мат';
  else if (/сдал/.test(text)) reason = 'Сдача';
  else if (/по времени|Время вышло/.test(text)) reason = 'Время вышло';
  else if (/Пат/.test(text)) reason = 'Пат';
  else if (/Ничья/.test(text)) reason = 'Ничья';
  $id('resultEyebrow').textContent = `${reason} · ${fullMoves}-й ход`;
  $id('resultStatMoves').textContent = String(fullMoves);
  $id('resultStatMoves').nextElementSibling.textContent = pluralRu(fullMoves, 'ход', 'хода', 'ходов');
  $id('resultStatTime').textContent = formatTime(seconds);
  $id('resultStatCaptured').textContent = String(myCaptures);
  const pieces = pluralRu(myCaptures, 'фигура', 'фигуры', 'фигур');
  $id('resultStatCaptured').nextElementSibling.textContent = state.mode === 'friend' ? `${pieces} взято` : `${pieces} взяли вы`;
}

// 1 ход, 2 хода, 5 ходов
function pluralRu(n, one, few, many) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

function showResultModal(text, outcome = 'draw') {
  if (outcome === 'player_win') playSound('win');
  else if (outcome === 'character_win') playSound('lose');
  $id('resultTitle').textContent = resultTitleFor(text, outcome);
  $id('resultText').textContent = text;
  renderResultStats(text);
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
