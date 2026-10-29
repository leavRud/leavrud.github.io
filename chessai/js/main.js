// Запуск приложения после загрузки страницы и таймер партии. Грузится последним.
'use strict';

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
  if (w) w.textContent = state.timeLimited ? formatTime(state.timeWhite || 0) : '—';
  if (b) b.textContent = state.timeLimited ? formatTime(state.timeBlack || 0) : '—';
  // Активный игрок: подсвечиваем и таймер, и всю строку игрока
  const turn = state.game && !state.isGameOver ? state.game.turn() : null;
  document.querySelectorAll('.player-bar').forEach(bar => {
    bar.classList.toggle('is-turn', bar.dataset.side === turn);
  });
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
