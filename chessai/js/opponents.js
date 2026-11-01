// Ходы соперника: Stockfish и персонажи, их реакции и итоговая карточка партии.
'use strict';

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
    const raw = await provodChat([{ role: 'user', content: prompt }], { temperature: 0.7, kind: 'game' });
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
  в образе, ${AI_LANGUAGE}, с характером, без кавычек и разметки.`;
}

const CHARACTER_REPLY_COOLDOWN_MS = 30000;
const CHARACTER_QUIET_PLIES = 12;    // столько полуходов тишины, прежде чем персонаж может заговорить сам
const CHARACTER_QUIET_CHANCE = 0.5;  // чтобы реплики не звучали строго по расписанию

async function characterReact(context, isAuto = false) {
  if (state.mode !== 'characters' || !state.character) return;
  const gameStartedAt = state.gameStartedAt;
  if (isAuto) {
    // Отмечаем сразу, а не после ответа: иначе за время запроса уйдёт второй
    state.autoReplyPending = true;
    state.lastAutoReplyTime = Date.now();
    state.pliesSinceCharacterSpoke = 0;
  }
  try {
    const messages = [
      { role: 'system', content: buildCharacterReactionPrompt() },
      { role: 'user', content: `Ситуация в партии: ${context}\nОтветь одной-двумя фразами в образе персонажа, ${AI_LANGUAGE}, без кавычек и разметки.` },
    ];
    const reply = await provodChat(messages, { temperature: 1.0, kind: 'game' });
    const clean = stripMarkdown(reply).replace(/^["«]+|["»]+$/g, '').trim();
    // Пока шёл запрос, игрок начал новую партию — реплика уже не к месту
    if (!clean || gameStartedAt !== state.gameStartedAt) return;

    if (isAuto) {
      // проверка на дубликат среди последних 5 реплик
      if (state.lastAutoReplies.includes(clean)) return;
      state.lastAutoReplies.push(clean);
      if (state.lastAutoReplies.length > 5) state.lastAutoReplies.shift();
    }

    // добавить в историю чата (API) – для контекста
    state.chatApiHistory.push({ role: 'assistant', content: clean });
    // добавить в отображение
    appendChatMessage('character', clean, { typewriter: true });
  } catch (error) {
    console.error('Ошибка реплики персонажа:', error);
    if (error.code === 'GAME_LIMIT_REACHED' && !state.gameLimitNotified && gameStartedAt === state.gameStartedAt) {
      state.gameLimitNotified = true;
      logSystemChat(chatErrorMessage(error));
    }
  } finally {
    if (isAuto && gameStartedAt === state.gameStartedAt) state.autoReplyPending = false;
  }
}

function triggerCharacterEvents(move, isUserMove) {
  if (state.mode !== 'characters' || !state.character) return;
  state.pliesSinceCharacterSpoke++;
  const flavor = state.lastMoveFlavor;
  state.lastMoveFlavor = null;
  const game = state.game;
  const isMate = game.in_checkmate();
  // Мат звучит всегда, остальное — не чаще раза в CHARACTER_REPLY_COOLDOWN_MS
  const isBusy = state.autoReplyPending || Date.now() - state.lastAutoReplyTime < CHARACTER_REPLY_COOLDOWN_MS;
  if (!isMate && isBusy) return;
  let event = null;
  if (isMate) {
    event = isUserMove ? 'mate_lost' : 'mate_won';
  } else if (!isUserMove && move.captured === 'q') {
    event = 'captured_queen';
  } else if (isUserMove && move.captured === 'q') {
    event = 'player_captured_queen';
  } else if (!isUserMove && flavor === 'sacrifice') {
    event = 'sacrifice';
  } else if (!isUserMove && flavor === 'goodCombo') {
    event = 'good_combo';
  } else if (!isUserMove && flavor === 'opponentMistake') {
    event = 'opponent_mistake';
  } else if (game.in_check()) {
    event = isUserMove ? 'player_gives_check' : 'character_gives_check';
  } else if (!isUserMove && state.pliesSinceCharacterSpoke >= CHARACTER_QUIET_PLIES && Math.random() < CHARACTER_QUIET_CHANCE) {
    event = 'quiet';
  }
  if (!event) return;
  const contexts = {
    mate_won: `Вы только что поставили сопернику мат ходом ${move.san}.`,
    mate_lost: 'Соперник только что поставил вам мат.',
    captured_queen: `Вы взяли ферзя соперника ходом ${move.san}.`,
    sacrifice: `Вы сделали рискованное взятие ходом ${move.san}, следуя своему стилю игры.`,
    good_combo: `Вы нашли сильную тактическую комбинацию ходом ${move.san}.`,
    opponent_mistake: 'Соперник только что допустил заметную ошибку в партии.',
    character_gives_check: `Вы объявили сопернику шах ходом ${move.san}.`,
    player_gives_check: 'Соперник только что объявил вам шах.',
    player_captured_queen: 'Соперник только что взял вашего ферзя.',
    quiet: `Партия идёт спокойно, вы только что сыграли ${move.san}. Скажите сопернику что-нибудь в своём образе: подколите, поделитесь мыслью или настроением.`,
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
  $id('characterResultContent').innerHTML = `<p class="analysis-loading">${t('Персонаж обдумывает партию…')}</p>`;
}

function renderCharacterResult({ mood, favoriteMoment, comment }) {
  const c = state.character;
  $id('characterResultContent').innerHTML = `
    <div class="char-result-head">
      <span class="char-result-icon">♞</span>
      <span class="char-result-name">${escapeHtml(c ? c.name : '')}</span>
      <span class="char-result-mood">${escapeHtml(mood)}</span>
    </div>
    <div class="char-result-row"><span>${t('Любимый момент')}</span><b>${escapeHtml(favoriteMoment)}</b></div>
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
{"mood":"один эмодзи, отражающий настроение персонажа","favoriteMoment":"короткая фраза о любимом моменте партии, до 12 слов, ${AI_LANGUAGE}","comment":"комментарий персонажа о партии в его манере общения, 1-2 предложения, ${AI_LANGUAGE}"}`;
  try {
    const raw = await provodChat([{ role: 'user', content: prompt }], { temperature: 0.85, kind: 'game' });
    const parsed = JSON.parse(extractJson(raw));
    renderCharacterResult({
      mood: String(parsed.mood || '🙂').trim().slice(0, 4) || '🙂',
      favoriteMoment: stripMarkdown(String(parsed.favoriteMoment || '')).trim() || t('Момент, который запомнится надолго.'),
      comment: stripMarkdown(String(parsed.comment || '')).trim() || t('Хорошая была партия.'),
    });
  } catch (error) {
    console.error('Ошибка итогового комментария персонажа:', error);
    const fallbackMood = outcome === 'character_win' ? '🙂' : (outcome === 'player_win' ? '😔' : '🤝');
    renderCharacterResult({ mood: fallbackMood, favoriteMoment: '—', comment: t('Комментарий персонажа сейчас недоступен.') });
  }
}
