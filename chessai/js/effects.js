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
//   catch-N.wav — поймана падающая фигура на главном экране, см. playCatchSound()
const CATCH_SOUNDS = ['catch2', 'catch3', 'catch4', 'catch5', 'catch6', 'catch7', 'catch8', 'catch9', 'catch10'];
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
CATCH_SOUNDS.forEach((kind) => { SOUND_FILES[kind] = `assests/catch-${kind.slice(5)}.wav`; });

// Основной путь — Web Audio: файлы декодируются заранее, и звук начинается сразу.
// <audio> грузит файл при первом запуске, поэтому первый звук опаздывал. Он
// остаётся запасным вариантом — например, на file:// fetch не работает.
const SoundContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = SoundContext ? new SoundContext({ latencyHint: 'interactive' }) : null;
const soundBuffers = {}; // kind -> декодированный звук

function preloadSounds() {
  if (!audioCtx) return;
  const decoded = {}; // один файл у нескольких событий декодируем один раз
  Object.entries(SOUND_FILES).forEach(([kind, src]) => {
    decoded[src] = decoded[src] || fetch(src)
      .then(res => res.arrayBuffer())
      .then(data => audioCtx.decodeAudioData(data));
    decoded[src].then(buffer => { soundBuffers[kind] = buffer; }).catch(() => {});
  });
}

// Браузер разрешает звук только после действия пользователя. Будим контекст уже
// на нажатии, а не на отпускании, чтобы первый клик прозвучал без задержки.
const AUDIO_UNLOCK_EVENTS = ['pointerdown', 'touchend', 'keydown', 'click'];
function unlockAudio() {
  audioCtx.resume().then(() => {
    AUDIO_UNLOCK_EVENTS.forEach(name => window.removeEventListener(name, unlockAudio, true));
  }).catch(() => {});
}
if (audioCtx) {
  AUDIO_UNLOCK_EVENTS.forEach(name => window.addEventListener(name, unlockAudio, true));
  preloadSounds();
}

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
  if (kind === 'notification' || CATCH_SOUNDS.includes(kind)) return s.soundUi;
  return false;
}
function playBufferedSound(buffer, volume, rate) {
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  const gain = audioCtx.createGain();
  gain.gain.value = volume;
  source.connect(gain).connect(audioCtx.destination);
  source.start();
}
// rate — скорость воспроизведения: заодно меняет высоту звука
function playSound(kind, rate = 1) {
  if (kind === 'ach') kind = 'achievement';
  if (!isSoundKindEnabled(kind)) return;
  const volume = clamp(state.settings.volume / 100, 0, 1);
  if (soundBuffers[kind]) {
    playBufferedSound(soundBuffers[kind], volume, rate);
    return;
  }
  const template = getSoundTemplate(kind);
  if (!template) return;
  try {
    const node = template.cloneNode(true);
    node.volume = volume;
    node.playbackRate = rate;
    const playPromise = node.play();
    if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
  } catch (e) { /* тихо игнорируем */ }
}
// Случайный звук клавиши, но не тот же, что в прошлый раз, и чуть разной высоты
let lastCatchSound = null;
function playCatchSound() {
  const choices = CATCH_SOUNDS.filter(kind => kind !== lastCatchSound);
  lastCatchSound = choices[Math.floor(Math.random() * choices.length)];
  playSound(lastCatchSound, 0.96 + Math.random() * 0.08);
}
window.playChessSound = playSound;
