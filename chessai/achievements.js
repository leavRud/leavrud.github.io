'use strict';
/* =========================================================================
   МОДУЛЬ ДОСТИЖЕНИЙ (Achievements)
   Полностью самодостаточный, расширяемый модуль.
   Чтобы добавить новое достижение — просто добавьте один объект в массив
   ACHIEVEMENTS ниже. Никакой другой логики менять не нужно.
   ========================================================================= */
const Achievements = (function () {

  const STORAGE_KEY = 'chess_achievements_v1';
  const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

  /* ---------------------------------------------------------------------
     КАТЕГОРИИ
     --------------------------------------------------------------------- */
  const CATEGORIES = [
    { id: 'progress', icon: '♟', label: 'Прогресс' },
    { id: 'wins', icon: '⚔', label: 'Победы' },
    { id: 'tactics', icon: '🧠', label: 'Тактика' },
    { id: 'king', icon: '👑', label: 'Король' },
    { id: 'pawns', icon: '♟', label: 'Пешки' },
    { id: 'stockfish', icon: '🤖', label: 'Против Stockfish' },
    { id: 'characters', icon: '🎭', label: 'Персонажи' },
    { id: 'analysis', icon: '🔍', label: 'Анализ партий' },
    { id: 'time', icon: '⏱', label: 'Время' },
    { id: 'secret', icon: '🎲', label: 'Секретные' },
  ];

  /* ---------------------------------------------------------------------
     ХРАНИЛИЩЕ
     --------------------------------------------------------------------- */
  function defaultData() {
    return {
      unlocked: {},   // id -> { date: ISOString }
      stats: {
        gamesPlayed: 0,
        winsTotal: 0,
        currentWinStreak: 0,
        bestWinStreak: 0,
        analysesCount: 0,
        charactersPlayed: [],   // имена персонажей
        aiWinStreak: 0,         // подряд побед над Stockfish (режим ai)
        modesPlayed: [],        // какие режимы игры уже пробовали
        checkTypesGiven: [],    // какими типами фигур игрок уже давал шах (по всем партиям)
        homeEnemiesKilled: 0,   // сколько вражеских фигур убито на главном экране
      },
    };
  }

  let data = loadData();

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      const parsed = JSON.parse(raw);
      const base = defaultData();
      return {
        unlocked: parsed.unlocked || {},
        stats: Object.assign(base.stats, parsed.stats || {}),
      };
    } catch (e) {
      return defaultData();
    }
  }

  function saveData() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
  }

  function isUnlocked(id) { return !!data.unlocked[id]; }

  /* ---------------------------------------------------------------------
     СЕССИЯ ТЕКУЩЕЙ ПАРТИИ (сбрасывается при каждой новой игре)
     --------------------------------------------------------------------- */
  let session = freshSession();
  function freshSession() {
    return {
      mode: null,
      playerColor: 'w',
      startTime: null,
      moveCount: 0,           // полуходы
      playerPiecesLost: 0,
      queenLostByPlayer: false,
      sacrificeFlag: false,
      lastUserMove: null,     // { to, piece }
      kingMoves: 0,
      kingWalked: false,
      castled: false,
      playerMoveChecks: [],   // история "дал ли шах" для каждого хода игрока
      firstLossPly: null,     // на каком полуходе игрок впервые потерял фигуру

      // --- новые поля для дополнительных достижений ---
      opponentPiecesLost: 0,       // сколько фигур соперника взял игрок
      capturePieceStreak: 0,       // подряд идущие ходы-взятия игрока ("Снайпер")
      samePieceStreak: 0,          // одна и та же фигура берёт подряд ("Один за всех")
      samePieceSquare: null,
      fastMoveStreak: 0,           // подряд идущие быстрые ходы игрока ("Скорость света")
      lastPlayerMoveTs: null,
      promotedToKnight: false,     // была ли в партии замена пешки на коня
      queenEverMoved: false,       // ходил ли игрок ферзём хоть раз
      castlePly: null,             // на каком полуходе игрок сделал рокировку
      castleFullMove: null,        // на каком полном ходу игрок сделал рокировку
      playerHasCapturedAny: false, // брал ли игрок хоть одну фигуру
      enteredEndgame: false,       // достигнута ли позиция-эндшпиль (мало фигур на доске)
      enteredEndgameNoCapture: false,
      allPawnsAdvanced: false,     // все пешки игрока дошли хотя бы до 4-й горизонтали
      forkCount: 0,                // сколько вилок сделал игрок за партию
      playerRooksLost: 0,          // сколько своих ладей потерял игрок
    };
  }

  function resetSession(payload) {
    session = freshSession();
    session.mode = payload.mode;
    session.playerColor = payload.playerColor || 'w';
    session.startTime = Date.now();
  }

  /* ---------------------------------------------------------------------
     ТАКТИЧЕСКИЕ ЭВРИСТИКИ
     --------------------------------------------------------------------- */
  function rcOf(square) {
    const c = square.charCodeAt(0) - 97;
    const r = 8 - parseInt(square[1], 10);
    return [r, c];
  }
  function sqName(r, c) {
    if (r < 0 || r > 7 || c < 0 || c > 7) return null;
    return 'abcdefgh'[c] + (8 - r);
  }
  const SLIDE_DIRS = {
    b: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
    r: [[-1, 0], [1, 0], [0, -1], [0, 1]],
    q: [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]],
  };
  const KNIGHT_OFFS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KING_OFFS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  // Возвращает список клеток, атакуемых фигурой piece цвета color, стоящей на square (псевдо-легально)
  function attackedSquares(board, square, piece, color) {
    const [r, c] = rcOf(square);
    const out = [];
    if (piece === 'n') {
      KNIGHT_OFFS.forEach(([dr, dc]) => {
        const s = sqName(r + dr, c + dc);
        if (s) out.push(s);
      });
    } else if (piece === 'k') {
      KING_OFFS.forEach(([dr, dc]) => {
        const s = sqName(r + dr, c + dc);
        if (s) out.push(s);
      });
    } else if (piece === 'p') {
      const dr = color === 'w' ? -1 : 1;
      [c - 1, c + 1].forEach((cc) => {
        const s = sqName(r + dr, cc);
        if (s) out.push(s);
      });
    } else if (SLIDE_DIRS[piece]) {
      SLIDE_DIRS[piece].forEach(([dr, dc]) => {
        let rr = r + dr, cc = c + dc;
        while (rr >= 0 && rr <= 7 && cc >= 0 && cc <= 7) {
          const s = sqName(rr, cc);
          out.push(s);
          if (board[rr][cc]) break; // луч останавливается на первой фигуре
          rr += dr; cc += dc;
        }
      });
    }
    return out;
  }

  // Ищет вилку/двойной удар: фигура атакует >=2 чужие фигуры одним ходом
  function detectForkAndDouble(board, square, piece, color) {
    const targets = attackedSquares(board, square, piece, color);
    let valuableHits = 0, anyHits = 0;
    targets.forEach((s) => {
      const [r, c] = rcOf(s);
      const p = board[r][c];
      if (p && p.color !== color) {
        anyHits++;
        if (PIECE_VALUE[p.type] >= 3) valuableHits++;
      }
    });
    return { fork: valuableHits >= 2, doubleAttack: anyHits >= 2 };
  }

  // Ищет связку/шампур вдоль лучей слайдера
  function detectPinAndSkewer(board, square, piece, color) {
    if (!SLIDE_DIRS[piece]) return { pin: false, skewer: false };
    const [r, c] = rcOf(square);
    let pin = false, skewer = false;
    SLIDE_DIRS[piece].forEach(([dr, dc]) => {
      let rr = r + dr, cc = c + dc;
      let first = null;
      while (rr >= 0 && rr <= 7 && cc >= 0 && cc <= 7) {
        const p = board[rr][cc];
        if (p) {
          if (!first) {
            if (p.color !== color && p.type !== 'k') first = p;
            else return; // своя фигура или король первой — луч бесполезен
          } else {
            if (p.color !== color) {
              if (p.type === 'k') pin = true;
              else if (PIECE_VALUE[first.type] <= PIECE_VALUE[p.type]) skewer = true;
            }
            return;
          }
        }
        rr += dr; cc += dc;
      }
    });
    return { pin, skewer };
  }

  // Считает все фигуры на доске (обе стороны)
  function countPieces(board) {
    let n = 0;
    board.forEach(row => row.forEach(p => { if (p) n++; }));
    return n;
  }

  // Проверяет, что все оставшиеся пешки цвета color стоят хотя бы на 4-й горизонтали
  // (считая от своей стороны доски)
  function checkAllPawnsAdvanced(board, color) {
    let anyPawn = false;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p && p.type === 'p' && p.color === color) {
          anyPawn = true;
          const ok = color === 'w' ? r <= 4 : r >= 3;
          if (!ok) return false;
        }
      }
    }
    return anyPawn;
  }

  /* ---------------------------------------------------------------------
     СПИСОК ДОСТИЖЕНИЙ
     Каждое: id, category, icon, name, desc, secret?, events[], check(ctx)
     ctx = { payload, session, stats }
     progress(stats) -> {current, goal}  (необязательно, для прогресс-бара)
     --------------------------------------------------------------------- */
  const ACHIEVEMENTS = [
    // ===== Прогресс =====
    { id: 'first_game', category: 'progress', icon: '♟', name: 'Первые шаги', desc: 'Сыграть первую партию.',
      events: ['gameStart'], progress: s => ({ current: s.gamesPlayed, goal: 1 }),
      check: ({ stats }) => stats.gamesPlayed >= 1 },
    { id: 'return_10', category: 'progress', icon: '🎯', name: 'Возвращение', desc: 'Сыграть 10 партий.',
      events: ['gameStart'], progress: s => ({ current: s.gamesPlayed, goal: 10 }),
      check: ({ stats }) => stats.gamesPlayed >= 10 },
    { id: 'veteran_100', category: 'progress', icon: '♛', name: 'Ветеран', desc: 'Сыграть 100 партий.',
      events: ['gameStart'], progress: s => ({ current: s.gamesPlayed, goal: 100 }),
      check: ({ stats }) => stats.gamesPlayed >= 100 },
    { id: 'legend_1000', category: 'progress', icon: '👑', name: 'Легенда', desc: 'Сыграть 1000 партий.',
      events: ['gameStart'], progress: s => ({ current: s.gamesPlayed, goal: 1000 }),
      check: ({ stats }) => stats.gamesPlayed >= 1000 },

    // ===== Победы =====
    { id: 'first_win', category: 'wins', icon: '🥇', name: 'Первая победа', desc: 'Выиграть первую партию.',
      events: ['gameEnd'], check: ({ stats }) => stats.winsTotal >= 1 },
    { id: 'streak_3', category: 'wins', icon: '🔥', name: 'Серия', desc: 'Выиграть 3 партии подряд.',
      events: ['gameEnd'], progress: s => ({ current: s.bestWinStreak, goal: 3 }),
      check: ({ stats }) => stats.currentWinStreak >= 3 },
    { id: 'streak_10', category: 'wins', icon: '🔥🔥', name: 'Неудержимый', desc: 'Выиграть 10 партий подряд.',
      events: ['gameEnd'], progress: s => ({ current: s.bestWinStreak, goal: 10 }),
      check: ({ stats }) => stats.currentWinStreak >= 10 },
    { id: 'ruthless', category: 'wins', icon: '💀', name: 'Безжалостный', desc: 'Выиграть без потери фигур.',
      events: ['gameEnd'], check: ({ payload, session }) => payload.outcome === 'win' && session.playerPiecesLost === 0 },
    { id: 'speed_blitz', category: 'wins', icon: '⚡', name: 'Блиц', desc: 'Победить менее чем за 30 ходов.',
      events: ['gameEnd'], check: ({ payload }) => payload.outcome === 'win' && payload.totalFullMoves != null && payload.totalFullMoves < 30 },
    { id: 'iron_defense', category: 'wins', icon: '🧱', name: 'Железная защита', desc: 'Не потерять ни одной фигуры до 20-го хода.',
      events: ['move'], check: ({ session }) => session.moveCount >= 40 && session.playerPiecesLost === 0 },

    // ===== Тактика =====
    { id: 'fork', category: 'tactics', icon: '🍴', name: 'Вилка', desc: 'Выполнить вилку.', events: ['tactic'],
      check: ({ payload }) => !!payload.fork },
    { id: 'pin', category: 'tactics', icon: '📌', name: 'Связка', desc: 'Выиграть фигуру благодаря связке.', events: ['tactic'],
      check: ({ payload }) => !!payload.pin },
    { id: 'skewer', category: 'tactics', icon: '⚔', name: 'Шампур', desc: 'Выполнить шампур.', events: ['tactic'],
      check: ({ payload }) => !!payload.skewer },
    { id: 'double_attack', category: 'tactics', icon: '🎯', name: 'Двойной удар', desc: 'Выполнить двойную атаку.', events: ['tactic'],
      check: ({ payload }) => !!payload.doubleAttack },
    { id: 'sacrifice', category: 'tactics', icon: '💣', name: 'Жертва', desc: 'Пожертвовать фигуру и выиграть партию.',
      events: ['gameEnd'], check: ({ payload, session }) => payload.outcome === 'win' && session.sacrificeFlag },
    { id: 'mate_2', category: 'tactics', icon: '🚀', name: 'Мат в два хода', desc: 'Поставить мат в два хода.',
      events: ['gameEnd'], check: ({ payload, session }) => payload.checkmate &&
        session.playerMoveChecks.length >= 2 && session.playerMoveChecks[session.playerMoveChecks.length - 2] === true },
    { id: 'mate_queen', category: 'tactics', icon: '👑', name: 'Мат ферзём', desc: 'Поставить мат ферзём.',
      events: ['gameEnd'], check: ({ payload }) => payload.checkmate && payload.matingPiece === 'q' },
    { id: 'mate_knight', category: 'tactics', icon: '🐴', name: 'Мат конём', desc: 'Поставить мат конём.',
      events: ['gameEnd'], check: ({ payload }) => payload.checkmate && payload.matingPiece === 'n' },
    { id: 'mate_rook', category: 'tactics', icon: '🏰', name: 'Мат ладьёй', desc: 'Поставить мат ладьёй.',
      events: ['gameEnd'], check: ({ payload }) => payload.checkmate && payload.matingPiece === 'r' },
    { id: 'mate_two_bishops', category: 'tactics', icon: '♝', name: 'Мат двумя слонами', desc: 'Поставить мат, имея на доске обоих слонов.',
      events: ['gameEnd'], check: ({ payload }) => payload.checkmate && payload.matingPiece === 'b' && payload.matingSideBishops >= 2 },
    { id: 'mate_two_knights', category: 'tactics', icon: '🤝', name: 'Мат двумя конями', desc: 'Поставить мат, когда на доске оба ваших коня.', secret: true,
      events: ['gameEnd'], check: ({ payload }) => payload.checkmate && payload.matingPiece === 'n' && payload.matingSideKnights >= 2 },

    // ===== Король =====
    { id: 'castle', category: 'king', icon: '🛡', name: 'Рокировка', desc: 'Сделать рокировку.', events: ['move'],
      check: ({ session }) => session.castled },
    { id: 'king_warrior', category: 'king', icon: '⚔', name: 'Король-воин', desc: 'Сделать 10 ходов королём за партию.',
      events: ['move'], check: ({ session }) => session.kingMoves >= 10 },
    { id: 'king_walk', category: 'king', icon: '👑', name: 'Королевская прогулка', desc: 'Победить после длинного похода королём через половину доски.',
      events: ['gameEnd'], check: ({ payload, session }) => payload.outcome === 'win' && session.kingWalked },

    // ===== Пешки =====
    { id: 'queen_promo', category: 'pawns', icon: '👑', name: 'Да здравствует ферзь', desc: 'Провести пешку в ферзя.',
      events: ['move'], check: ({ payload }) => payload.promotion === 'q' },
    { id: 'underpromotion', category: 'pawns', icon: '🐴', name: 'Необычный выбор', desc: 'Превратить пешку не в ферзя.',
      events: ['move'], check: ({ payload }) => !!payload.promotion && payload.promotion !== 'q' },
    { id: 'en_passant', category: 'pawns', icon: '🚶', name: 'А вы знали?', desc: 'Взять пешкой на проходе.',
      events: ['move'], check: ({ payload }) => !!payload.enPassant },

    // ===== Против Stockfish =====
    { id: 'beat_easy', category: 'stockfish', icon: '🟢', name: 'Лёгкий уровень', desc: 'Победить лёгкий уровень.',
      events: ['gameEnd'], check: ({ payload }) => payload.mode === 'ai' && payload.outcome === 'win' && payload.skillLevel <= 8 },
    { id: 'beat_medium', category: 'stockfish', icon: '🟡', name: 'Средний уровень', desc: 'Победить средний уровень.',
      events: ['gameEnd'], check: ({ payload }) => payload.mode === 'ai' && payload.outcome === 'win' && payload.skillLevel > 8 && payload.skillLevel < 20 },
    { id: 'beat_hard', category: 'stockfish', icon: '🔴', name: 'Сложный уровень', desc: 'Победить сложный уровень.',
      events: ['gameEnd'], check: ({ payload }) => payload.mode === 'ai' && payload.outcome === 'win' && payload.skillLevel >= 20 },
    { id: 'rating_1500', category: 'stockfish', icon: '📈', name: 'Рейтинг', desc: 'Достичь предполагаемого Elo 1500.',
      events: ['analysis'], check: ({ payload }) => payload.playerElo >= 1500 },
    { id: 'perfect_game', category: 'stockfish', icon: '💎', name: 'Идеальная партия', desc: 'Качество партии выше 95%.',
      events: ['analysis'], check: ({ payload }) => payload.playerAccuracy >= 95 },

    // ===== Персонажи =====
    { id: 'first_character', category: 'characters', icon: '🎨', name: 'Первый персонаж', desc: 'Сыграть с первым персонажем.',
      events: ['gameStart'], check: ({ stats }) => stats.charactersPlayed.length >= 1 },
    { id: 'collector', category: 'characters', icon: '🎭', name: 'Коллекционер', desc: 'Сыграть против 10 разных персонажей.',
      events: ['gameStart'], progress: s => ({ current: s.charactersPlayed.length, goal: 10 }),
      check: ({ stats }) => stats.charactersPlayed.length >= 10 },
    { id: 'legend_beater', category: 'characters', icon: '🧙', name: 'Победитель легенд', desc: 'Победить персонажа с Elo выше 2500.',
      events: ['gameEnd'], check: ({ payload }) => payload.mode === 'characters' && payload.outcome === 'win' && payload.characterElo > 2500 },

    // ===== Анализ партий =====
    { id: 'first_analysis', category: 'analysis', icon: '📊', name: 'Первый анализ', desc: 'Проанализировать первую партию.',
      events: ['analysis'], progress: s => ({ current: s.analysesCount, goal: 1 }),
      check: ({ stats }) => stats.analysesCount >= 1 },
    { id: 'analyst_50', category: 'analysis', icon: '📚', name: 'Аналитик', desc: 'Проанализировать 50 партий.',
      events: ['analysis'], progress: s => ({ current: s.analysesCount, goal: 50 }),
      check: ({ stats }) => stats.analysesCount >= 50 },
    { id: 'best_move_view', category: 'analysis', icon: '🎯', name: 'Лучший ход', desc: 'Посмотреть лучший ход в анализе партии.',
      events: ['bestMoveView'], check: () => true },

    // ===== Время =====
    { id: 'bullet_win', category: 'time', icon: '⚡', name: 'Пуля', desc: 'Победить менее чем за минуту.',
      events: ['gameEnd'], check: ({ payload }) => payload.outcome === 'win' && payload.elapsedMs != null && payload.elapsedMs < 60000 },
    { id: 'patient', category: 'time', icon: '🕰', name: 'Терпеливый', desc: 'Сыграть партию длительностью более часа.',
      events: ['gameEnd'], check: ({ payload }) => payload.elapsedMs != null && payload.elapsedMs > 3600000 },
    { id: 'last_second', category: 'time', icon: '⌛', name: 'Последняя секунда', desc: 'Победить, имея менее 5 секунд на часах.',
      events: ['gameEnd'], check: ({ payload }) => payload.outcome === 'win' && payload.ownTimeLeft != null && payload.ownTimeLeft < 5 },

    // ===== Секретные =====
    { id: 'stalemate', category: 'secret', icon: '🦆', name: 'Пат', desc: 'Закончить партию патом.', secret: true,
      events: ['gameEnd'], check: ({ payload }) => !!payload.stalemate },
    { id: 'threefold', category: 'secret', icon: '♻', name: 'Троекратное повторение', desc: 'Закончить партию троекратным повторением позиции.', secret: true,
      events: ['gameEnd'], check: ({ payload }) => !!payload.threefold },
    { id: 'queen_sac', category: 'secret', icon: '😈', name: 'Жертва ферзя', desc: 'Выиграть партию, потеряв своего ферзя.', secret: true,
      events: ['gameEnd'], check: ({ payload, session }) => payload.outcome === 'win' && session.queenLostByPlayer },
    { id: 'comeback', category: 'secret', icon: '💀', name: 'Камбэк', desc: 'Выиграть партию, в которой ваша оценка позиции опускалась ниже -8.', secret: true,
      events: ['analysis'], check: ({ payload }) => payload.outcome === 'win' && payload.minPlayerEval != null && payload.minPlayerEval < -800 },
    { id: 'flawless', category: 'secret', icon: '🎯', name: 'Безошибочная партия', desc: 'Пройти анализ партии без единой ошибки.', secret: true,
      events: ['analysis'], check: ({ payload }) => payload.playerHasMistake === false },

    // ===== Новые достижения =====
    { id: 'machine', category: 'analysis', icon: '🖥', name: 'Машина', desc: 'Сыграть партию с точностью 95% и выше.',
      events: ['analysis'], check: ({ payload }) => payload.playerAccuracy >= 95 },
    { id: 'grandmaster_acc', category: 'analysis', icon: '🎓', name: 'Гроссмейстер', desc: 'Сыграть партию с точностью 98% и выше.',
      events: ['analysis'], check: ({ payload }) => payload.playerAccuracy >= 98 },
    { id: 'opening_prep', category: 'analysis', icon: '📖', name: 'Идеальная дебютная подготовка',
      desc: 'Первые 15 ходов партии совпали с лучшей линией движка.',
      events: ['analysis'], check: ({ payload }) => !!payload.openingPerfect },
    { id: 'on_the_edge', category: 'analysis', icon: '🧵', name: 'На волоске',
      desc: 'Победить в партии, где оценка позиции опускалась до -7 или хуже.',
      events: ['analysis'], check: ({ payload }) => payload.outcome === 'win' && payload.minPlayerEval != null && payload.minPlayerEval <= -700 },

    { id: 'predator', category: 'tactics', icon: '🦈', name: 'Хищник', desc: 'Съесть все фигуры соперника, кроме короля.',
      events: ['move'], check: ({ session }) => session.opponentPiecesLost >= 15 },
    { id: 'one_for_all', category: 'tactics', icon: '🎖', name: 'Один за всех', desc: 'Одной фигурой взять 5 фигур соперника подряд.',
      events: ['move'], check: ({ session }) => session.samePieceStreak >= 5 },
    { id: 'speed_of_light', category: 'time', icon: '💫', name: 'Скорость света', desc: 'Сделать 20 ходов подряд быстрее чем за 0.5 секунды.',
      events: ['move'], check: ({ session }) => session.fastMoveStreak >= 20 },
    { id: 'terminator', category: 'stockfish', icon: '🦾', name: 'Терминатор', desc: 'Выиграть 20 партий подряд против Stockfish.',
      events: ['gameEnd'], progress: s => ({ current: s.aiWinStreak, goal: 20 }),
      check: ({ stats }) => stats.aiWinStreak >= 20 },
    { id: 'invisible_threat', category: 'tactics', icon: '👻', name: 'Невидимая угроза',
      desc: 'Поставить мат, не давая ни одного шаха до самого последнего хода.',
      events: ['gameEnd'], check: ({ payload, session }) => {
        if (payload.outcome !== 'win' || !payload.checkmate) return false;
        const checks = session.playerMoveChecks;
        if (!checks.length) return false;
        return checks[checks.length - 1] === true && checks.slice(0, -1).every(c => c === false);
      } },
    { id: 'domination', category: 'wins', icon: '🏆', name: 'Доминация', desc: 'Закончить партию победой, имея все свои фигуры.',
      events: ['gameEnd'], check: ({ payload, session }) => payload.outcome === 'win' && session.playerPiecesLost === 0 },
    { id: 'sniper', category: 'tactics', icon: '🏹', name: 'Снайпер', desc: 'Сделать минимум 8 ходов подряд — и каждый со взятием.',
      events: ['move'], check: ({ session }) => session.capturePieceStreak >= 8 },

    { id: 'meta_25', category: 'progress', icon: '🥉', name: 'Коллекционер (25%)', desc: 'Открыть 25% всех достижений.',
      events: ['meta'], check: () => (baseUnlockedCount() / baseAchievementsCount()) >= 0.25 },
    { id: 'meta_50', category: 'progress', icon: '🥈', name: 'Коллекционер (50%)', desc: 'Открыть 50% всех достижений.',
      events: ['meta'], check: () => (baseUnlockedCount() / baseAchievementsCount()) >= 0.5 },
    { id: 'meta_100', category: 'progress', icon: '🥇', name: 'Коллекционер (100%)', desc: 'Открыть 100% всех достижений.',
      events: ['meta'], check: () => (baseUnlockedCount() / baseAchievementsCount()) >= 1 },

    { id: 'explorer', category: 'progress', icon: '🧭', name: 'Исследователь', desc: 'Попробовать все режимы игры.',
      events: ['gameStart'], progress: s => ({ current: s.modesPlayed.length, goal: 3 }),
      check: ({ stats }) => stats.modesPlayed.length >= 3 },
    { id: 'crowd_favorite', category: 'characters', icon: '🌟', name: 'Любимец публики', desc: 'Сыграть против 25 разных персонажей.',
      events: ['gameStart'], progress: s => ({ current: s.charactersPlayed.length, goal: 25 }),
      check: ({ stats }) => stats.charactersPlayed.length >= 25 },

    // ===== Секретные (дополнительные) =====
    { id: 'pawn_mate', category: 'secret', icon: '♟', name: 'Мат пешкой', desc: 'Поставить мат пешкой.', secret: true,
      events: ['gameEnd'], check: ({ payload }) => payload.checkmate && payload.matingPiece === 'p' },
    { id: 'humble_hero', category: 'secret', icon: '🐴', name: 'Скромный герой', desc: 'Выиграть партию, превратив пешку в коня.', secret: true,
      events: ['gameEnd'], check: ({ payload, session }) => payload.outcome === 'win' && session.promotedToKnight },
    { id: 'instant_justice', category: 'secret', icon: '🗡', name: 'Мгновенная расправа', desc: 'Поставить мат сразу через ход после рокировки.', secret: true,
      events: ['gameEnd'], check: ({ payload, session }) => payload.outcome === 'win' && payload.checkmate &&
        session.castlePly != null && (session.moveCount - session.castlePly === 2) },
    { id: 'queenless_win', category: 'secret', icon: '🚫', name: 'Без ферзя', desc: 'Выиграть партию, ни разу не сходив ферзём.', secret: true,
      events: ['gameEnd'], check: ({ payload, session }) => payload.outcome === 'win' && !session.queenEverMoved },
    { id: 'early_castle', category: 'secret', icon: '🏰', name: 'Ранняя рокировка', desc: 'Сделать рокировку на 5-м ходу.', secret: true,
      events: ['move'], check: ({ session }) => session.castleFullMove === 5 },
    { id: 'quiet_game', category: 'secret', icon: '🤫', name: 'Тихая игра', desc: 'Выиграть партию, дойдя до эндшпиля без единого взятия.', secret: true,
      events: ['gameEnd'], check: ({ payload, session }) => payload.outcome === 'win' && session.enteredEndgame && session.enteredEndgameNoCapture },
    { id: 'pawn_wave', category: 'secret', icon: '⛰', name: 'Пешечный прорыв', desc: 'Продвинуть все свои пешки вперёд за одну партию.', secret: true,
      events: ['move'], check: ({ session }) => session.allPawnsAdvanced },
    { id: 'triple_fork', category: 'secret', icon: '🔱', name: 'Тройная вилка', desc: 'Выполнить вилку трижды за одну партию.', secret: true,
      events: ['tactic'], check: ({ session }) => session.forkCount >= 3 },
    { id: 'universal_threat', category: 'secret', icon: '🌈', name: 'Универсальная угроза', desc: 'Объявить шах пятью разными типами фигур (за все партии).', secret: true,
      events: ['move'], check: ({ stats }) => stats.checkTypesGiven.length >= 5 },
    { id: 'rook_sacrifice', category: 'secret', icon: '🗼', name: 'Ладейная жертва', desc: 'Выиграть партию, потеряв обе ладьи.', secret: true,
      events: ['gameEnd'], check: ({ payload, session }) => payload.outcome === 'win' && session.playerRooksLost >= 2 },
    { id: 'char_naruto', category: 'secret', icon: '🍥', name: 'Верю в тебя!', desc: 'Сыграть партию против персонажа Наруто.', secret: true,
      events: ['gameStart'], check: ({ payload }) => !!(payload.character && /наруто|naruto/i.test(payload.character.name || '')) },
    { id: 'char_walter', category: 'secret', icon: '🧪', name: 'Скажи моё имя', desc: 'Сыграть партию против персонажа Уолтера Уайта.', secret: true,
      events: ['gameStart'], check: ({ payload }) => !!(payload.character && /уолтер\s*уайт|walter\s*white|гейзенберг|heisenberg/i.test(payload.character.name || '')) },
    { id: 'char_einstein', category: 'secret', icon: '🧠', name: 'Теория относительности', desc: 'Сыграть партию против персонажа Эйнштейна.', secret: true,
      events: ['gameStart'], check: ({ payload }) => !!(payload.character && /эйнштейн|einstein/i.test(payload.character.name || '')) },
    { id: 'home_enemy_slayer1', category: 'secret', icon: '👹', name: 'Убийца', desc: 'Убить 10 вражеских фигур на главном экране конями.', secret: true,
      events: ['homeEnemyKill'], check: ({ stats }) => stats.homeEnemiesKilled >= 10 },
    { id: 'home_enemy_slayer2', category: 'secret', icon: '👹👹', name: 'Пожиратель врагов', desc: 'Убить 1000 вражеских фигур на главном экране конями.', secret: true,
      events: ['homeEnemyKill'], check: ({ stats }) => stats.homeEnemiesKilled >= 1000 },
  ];

  // Число достижений/открытых достижений без учёта мета-достижений "Коллекционер" —
  // иначе они не смогли бы разблокироваться сами от себя.
  function baseAchievementsCount() { return ACHIEVEMENTS.filter(a => !a.id.startsWith('meta_')).length; }
  function baseUnlockedCount() { return Object.keys(data.unlocked).filter(id => !id.startsWith('meta_')).length; }

  /* ---------------------------------------------------------------------
     ЛОГИКА РАЗБЛОКИРОВКИ
     --------------------------------------------------------------------- */
  const toastQueue = [];
  let toastShowing = false;

  function unlock(def) {
    if (isUnlocked(def.id)) return;
    data.unlocked[def.id] = { date: new Date().toISOString() };
    saveData();
    syncAchievementToSupabase(def.id);
    toastQueue.push(def);
    processToastQueue();
    // Пересчитываем процентные ("Коллекционер") достижения при каждой новой разблокировке
    if (!def.id.startsWith('meta_')) runChecks('meta', {});
  }

  // Записывает разблокированное достижение в таблицу achievements Supabase.
  // Работает только для залогиненных пользователей — для гостей остаётся
  // только локальный прогресс (data.unlocked через saveData()).
  async function syncAchievementToSupabase(achievementKey) {
    if (typeof sb === 'undefined') return;
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    const { error } = await sb
      .from('achievements')
      .upsert({ user_id: user.id, achievement_key: achievementKey });
    if (error) console.error('Не удалось синхронизировать достижение с Supabase:', error);
  }

  function processToastQueue() {
    if (toastShowing || !toastQueue.length) return;
    const def = toastQueue.shift();
    toastShowing = true;
    const container = ensureToastContainer();
    const el = document.createElement('div');
    el.className = 'achv-toast';
    el.innerHTML = `
      <div class="achv-toast-icon">${def.icon}</div>
      <div class="achv-toast-body">
        <div class="achv-toast-title">🏆 Новое достижение</div>
        <div class="achv-toast-name">${escapeHtmlLocal(def.name)}</div>
        <div class="achv-toast-desc">${escapeHtmlLocal(def.secret ? 'Секретное достижение открыто' : def.desc)}</div>
      </div>`;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      el.classList.add('hide');
      setTimeout(() => {
        el.remove();
        toastShowing = false;
        processToastQueue();
      }, 350);
    }, 3400);
  }

  function ensureToastContainer() {
    let c = document.getElementById('achvToastContainer');
    if (!c) {
      c = document.createElement('div');
      c.id = 'achvToastContainer';
      document.body.appendChild(c);
    }
    return c;
  }

  function escapeHtmlLocal(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function runChecks(eventName, payload) {
    ACHIEVEMENTS.forEach((def) => {
      if (!def.events.includes(eventName)) return;
      if (isUnlocked(def.id)) return;
      try {
        if (def.check({ payload: payload || {}, session, stats: data.stats })) unlock(def);
      } catch (e) { /* достижение не должно ломать приложение */ }
    });
  }

  /* ---------------------------------------------------------------------
     ОБРАБОТКА СОБЫТИЙ ИЗ ПРИЛОЖЕНИЯ
     --------------------------------------------------------------------- */
  function track(eventName, payload = {}) {
    switch (eventName) {
      case 'gameStart': {
        resetSession(payload);
        data.stats.gamesPlayed++;
        if (payload.mode === 'characters' && payload.character && payload.character.name) {
          const set = new Set(data.stats.charactersPlayed);
          set.add(payload.character.name);
          data.stats.charactersPlayed = Array.from(set);
        }
        if (payload.mode) {
          const modes = new Set(data.stats.modesPlayed);
          modes.add(payload.mode);
          data.stats.modesPlayed = Array.from(modes);
        }
        saveData();
        break;
      }
      case 'move': {
        handleMove(payload);
        break;
      }
      case 'gameEnd': {
        handleGameEnd(payload);
        break;
      }
      case 'analysis': {
        data.stats.analysesCount++;
        saveData();
        break;
      }
      case 'homeEnemyKill': {
        data.stats.homeEnemiesKilled = (data.stats.homeEnemiesKilled || 0) + 1;
        saveData();
        break;
      }
      default: break;
    }
    runChecks(eventName, payload);
  }

  function handleMove(payload) {
    const move = payload.move;
    const isPlayerSide = payload.mode === 'friend' ? true : (move.color === payload.playerColor);
    session.moveCount++;

    // Рокировка
    if (move.flags && (move.flags.includes('k') || move.flags.includes('q')) && isPlayerSide) {
      session.castled = true;
    }
    // Король
    if (move.piece === 'k' && !(move.flags && (move.flags.includes('k') || move.flags.includes('q')))) {
      if (isPlayerSide) {
        session.kingMoves++;
        const [r2] = rcOf(move.to);
        const homeRank = payload.playerColor === 'w' ? 7 : 0;
        if (Math.abs(r2 - homeRank) >= 4) session.kingWalked = true;
      }
    }
    // Превращение
    if (move.flags && move.flags.includes('p')) {
      payload.promotion = move.promotion;
      if (isPlayerSide && move.promotion === 'n') session.promotedToKnight = true;
    }
    // Взятие на проходе
    if (move.flags && move.flags.includes('e')) {
      payload.enPassant = true;
    }
    // Ферзь игрока хоть раз сходил
    if (isPlayerSide && move.piece === 'q') session.queenEverMoved = true;
    // Рокировка: запоминаем момент (для "мгновенной расправы" и "ранней рокировки")
    if (isPlayerSide && move.flags && (move.flags.includes('k') || move.flags.includes('q'))) {
      session.castlePly = session.moveCount;
      session.castleFullMove = Math.ceil(session.moveCount / 2);
    }
    // Потеря фигур игроком
    if (move.captured && isPlayerSide === false && payload.mode !== 'friend') {
      session.playerPiecesLost++;
      if (move.captured === 'q') session.queenLostByPlayer = true;
      if (move.captured === 'r') session.playerRooksLost++;
    }
    // Взятия, сделанные игроком: "Хищник", "Снайпер", "Один за всех"
    if (isPlayerSide && move.captured) {
      session.opponentPiecesLost++;
      session.playerHasCapturedAny = true;
      session.capturePieceStreak++;
      if (session.samePieceSquare && move.from === session.samePieceSquare) {
        session.samePieceStreak++;
      } else {
        session.samePieceStreak = 1;
      }
      session.samePieceSquare = move.to;
    } else if (isPlayerSide) {
      session.capturePieceStreak = 0;
      if (session.samePieceSquare && move.from === session.samePieceSquare) {
        session.samePieceSquare = null;
        session.samePieceStreak = 0;
      }
    }
    // Скорость ходов игрока подряд ("Скорость света")
    if (isPlayerSide) {
      const now = Date.now();
      if (session.lastPlayerMoveTs != null && (now - session.lastPlayerMoveTs) < 500) {
        session.fastMoveStreak++;
      } else {
        session.fastMoveStreak = 1;
      }
      session.lastPlayerMoveTs = now;
    }
    // Жертва: игрок только что сходил на клетку, где фигуру только что взяли
    if (isPlayerSide && payload.mode !== 'friend') {
      session.lastUserMove = { to: move.to, piece: move.piece };
    } else if (move.captured && session.lastUserMove && move.to === session.lastUserMove.to
      && PIECE_VALUE[session.lastUserMove.piece] >= 3) {
      session.sacrificeFlag = true;
    }
    // История шахов игрока (для "мат в два хода" и "невидимой угрозы")
    if (isPlayerSide) {
      session.playerMoveChecks.push(!!payload.givesCheck);
    }
    // Типы фигур, которыми игрок когда-либо давал шах (по всем партиям)
    if (isPlayerSide && payload.givesCheck && move.piece !== 'k' && !data.stats.checkTypesGiven.includes(move.piece)) {
      data.stats.checkTypesGiven = data.stats.checkTypesGiven.concat(move.piece);
      saveData();
    }
    // Состояние доски: эндшпиль и продвижение пешек
    if (payload.board) {
      if (!session.enteredEndgame && countPieces(payload.board) <= 12) {
        session.enteredEndgame = true;
        session.enteredEndgameNoCapture = !session.playerHasCapturedAny;
      }
      if (!session.allPawnsAdvanced && checkAllPawnsAdvanced(payload.board, session.playerColor)) {
        session.allPawnsAdvanced = true;
      }
    }
    // Тактика
    if (isPlayerSide && payload.board) {
      const forkRes = detectForkAndDouble(payload.board, move.to, move.piece, move.color);
      const pinRes = detectPinAndSkewer(payload.board, move.to, move.piece, move.color);
      if (forkRes.fork) session.forkCount++;
      if (forkRes.fork || forkRes.doubleAttack || pinRes.pin || pinRes.skewer) {
        runChecks('tactic', {
          fork: forkRes.fork, doubleAttack: forkRes.doubleAttack, pin: pinRes.pin, skewer: pinRes.skewer,
        });
      }
    }
  }

  function handleGameEnd(payload) {
    const elapsedMs = session.startTime ? Date.now() - session.startTime : null;
    payload.elapsedMs = elapsedMs;
    payload.totalFullMoves = payload.totalFullMoves != null ? payload.totalFullMoves : Math.ceil(session.moveCount / 2);

    if (payload.outcome === 'win') {
      data.stats.winsTotal++;
      data.stats.currentWinStreak++;
      data.stats.bestWinStreak = Math.max(data.stats.bestWinStreak, data.stats.currentWinStreak);
    } else if (payload.outcome === 'loss' || payload.outcome === 'draw') {
      // Серию прерывают и поражение, и ничья — bestWinStreak сохраняет исторический максимум.
      data.stats.currentWinStreak = 0;
    }
    // Серия побед подряд именно против Stockfish ("Терминатор")
    if (payload.mode === 'ai') {
      if (payload.outcome === 'win') {
        data.stats.aiWinStreak = (data.stats.aiWinStreak || 0) + 1;
      } else if (payload.outcome === 'loss' || payload.outcome === 'draw') {
        data.stats.aiWinStreak = 0;
      }
    }
    saveData();

    // сохраняем контекст последней партии — используется при последующем анализе
    lastGameContext = {
      outcome: payload.outcome,
      playerColor: session.playerColor,
    };
  }

  let lastGameContext = null;

  // Вызывается из приложения после завершения анализа партии движком
  function trackAnalysis(info) {
    const playerColor = (lastGameContext && lastGameContext.playerColor) || session.playerColor || 'w';
    const outcome = (lastGameContext && lastGameContext.outcome) || 'draw';
    const playerAccuracy = playerColor === 'w' ? info.accuracyWhite : info.accuracyBlack;
    const playerElo = playerColor === 'w' ? info.eloWhite : info.eloBlack;
    const playerMoves = (info.moveAnalysis || []).filter(m => m.move.color === playerColor);
    const playerHasMistake = playerMoves.some(m => m.delta < -100);

    // Дебютная подготовка: первые 15 ходов игрока практически не теряли в оценке
    // (т.е. фактически совпадали с лучшей линией движка)
    const openingMoves = playerMoves.slice(0, 15);
    const openingPerfect = openingMoves.length >= 15 && openingMoves.every(m => m.delta >= -20);

    // минимальная оценка позиции с точки зрения игрока (по белым конвертируем на игрока)
    let minPlayerEval = null;
    if (Array.isArray(info.evaluationsAbsoluteWhite)) {
      info.evaluationsAbsoluteWhite.forEach((whiteScore) => {
        if (whiteScore == null) return;
        const playerScore = playerColor === 'w' ? whiteScore : -whiteScore;
        if (minPlayerEval === null || playerScore < minPlayerEval) minPlayerEval = playerScore;
      });
    }

    track('analysis', {
      playerAccuracy, playerElo, playerHasMistake: playerMoves.length ? playerHasMistake : null,
      minPlayerEval, outcome, openingPerfect,
    });
  }

  function trackBestMoveView() {
    track('bestMoveView', {});
  }

  /* ---------------------------------------------------------------------
     Сводные счётчики — используются Achievements View в боковой панели
     (см. getSummary() ниже). Отдельная модалка/кнопки достижений убраны:
     доступ к достижениям теперь только через раздел «Достижения» в настройках.
     --------------------------------------------------------------------- */
  function totalUnlockedCount() { return Object.keys(data.unlocked).length; }
  function totalCount() { return ACHIEVEMENTS.length; }

  function init() {
    // Кнопки/модалка достижений больше не создаются — единственная точка
    // входа теперь раздел «Достижения» в настройках (см. renderAchievementsGrid()
    // и #view-achievements в app.js/index.html).
  }

  return {
    getAchievements: () => ACHIEVEMENTS.slice(),
    isUnlocked: (id) => isUnlocked(id),
    init, track, trackAnalysis, trackBestMoveView,
    getStats: () => ({ ...data.stats }),
    // Краткая сводка прогресса — используется Achievements View в боковой панели.
    getSummary: () => ({ unlocked: totalUnlockedCount(), total: totalCount() }),
    getUnlockDate: (id) => data.unlocked[id]?.date || null,
  };
})();
window.Achievements = Achievements;