// Анимации и звуки.
'use strict';

/* =========================================================================
   АНИМАЦИИ
   ========================================================================= */
function highlightLastMoveFade(from, to) {
  // Постоянная подсветка последнего хода — остаётся, пока не сделан следующий.
  $('#board .last-move-mark').removeClass('last-move-mark');
  $(`#board .square-${from}, #board .square-${to}`).addClass('last-move-mark');
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
