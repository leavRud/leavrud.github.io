// Главный экран: показ/скрытие, выбор режима, модалка цвета и сложности.
'use strict';

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
  stopHomeSnow();
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

const LEVEL_LABEL = { 8: 'лёгкий', 14: 'средний', 20: 'сложный' };

// Модалка открывается с готовым выбором (последний цвет и сложность, по
// умолчанию белые и «Средний»), поэтому «Начать игру» всегда активна.
function resetDifficultyChoice() {
  chosenColor = localStorage.getItem('chessLastColor') === 'b' ? 'b' : 'w';
  const savedLevel = parseInt(localStorage.getItem('chessLastLevel'), 10);
  chosenLevel = LEVEL_LABEL[savedLevel] ? savedLevel : 14;
  document.querySelectorAll('.color-choice-btn').forEach(b => {
    const active = b.dataset.color === chosenColor;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('.diff-choice-btn').forEach(b => {
    const active = parseInt(b.dataset.level, 10) === chosenLevel;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  updateStartAiBtn();
}
function updateStartAiBtn() {
  const btn = $id('startAiGameBtn');
  btn.disabled = !(chosenColor && chosenLevel);
  btn.textContent = `Начать: ${chosenColor === 'b' ? 'чёрные' : 'белые'}, ${LEVEL_LABEL[chosenLevel] || 'средний'}`;
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
  try {
    localStorage.setItem('chessLastColor', chosenColor);
    localStorage.setItem('chessLastLevel', String(chosenLevel));
  } catch (e) { /* хранилище недоступно — просто не запоминаем */ }
  hideModal('colorModal');
  if (stockfish && isEngineReady) {
    stockfish.postMessage(`setoption name Skill Level value ${chosenLevel}`);
  }
  hideHomeScreen();
  initGame();
});
