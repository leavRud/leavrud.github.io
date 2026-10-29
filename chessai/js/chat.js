// Чат с нейросетью и вкладки «Ходы / Чат» на узких экранах.
'use strict';

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

/* ---- Вкладки «Ходы / Чат» под доской (видны только на узких экранах) ---- */
function setMobileTab(name) {
  document.querySelector('.layout').dataset.mobileTab = name;
  document.querySelectorAll('.mobile-tab').forEach(tab => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    if (active) tab.classList.remove('has-unread');
  });
}
document.querySelectorAll('.mobile-tab').forEach(tab => {
  tab.addEventListener('click', () => { playSound('ui'); setMobileTab(tab.dataset.tab); });
});

function appendChatMessage(role, text, { typewriter = false } = {}) {
  state.chatDisplay.push({ role, text });
  if (role === 'assistant' && document.querySelector('.layout').dataset.mobileTab !== 'chat') {
    document.querySelector('.mobile-tab[data-tab="chat"]').classList.add('has-unread');
  }
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
  if (!chatSignedIn) {
    logSystemChat(chatErrorMessage({ code: 'AUTH_REQUIRED' }));
    openAuthModal();
    return;
  }
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
    // Вопрос без ответа не должен оставаться в истории, которая уходит модели.
    state.chatApiHistory.pop();
    appendChatMessage('system', chatErrorMessage(error));
    if (error.code === 'AUTH_REQUIRED') { chatSignedIn = false; renderChatQuota(null); openAuthModal(); }
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
