// Панель настроек.
'use strict';

/* =========================================================================
   ПАНЕЛЬ НАСТРОЕК
   ========================================================================= */
function syncAutoHintAvailability() {
  const row = $id('autoHintRow');
  const delayRow = $id('autoHintDelayRow');
  const note = $id('autoHintCharacterNote');
  if (!row || !delayRow || !note) return;
  const isCharacterMode = state.mode === 'characters';
  row.classList.toggle('hidden', isCharacterMode);
  note.classList.toggle('hidden', !isCharacterMode);
  delayRow.classList.toggle('hidden', isCharacterMode || !state.settings.autoHint);
}

/* Настройки — это view внутри общей боковой Side Panel (см. блок навигации
   ниже), а не отдельный overlay. Эти функции сохранены как совместимый
   тонкий алиас поверх единого navigateTo()/navigateBack(), т.к. на них
   могут быть внешние ссылки; вся реальная логика — в navigationState. */
function openSettingsPanel() {
  if (!$id('menuOverlay')) {
    console.error('Боковая панель (menuOverlay) не найдена');
    return;
  }
  if (!$id('menuOverlay').classList.contains('open')) openSidePanel();
  navigateTo('settings');
}
function closeSettingsPanel() {
  if (typeof getCurrentView === 'function' && getCurrentView() === 'settings') navigateBack();
}

function applyAccent(name) {
  document.documentElement.setAttribute('data-accent', name);
  localStorage.setItem('chessAccent', name);
  state.settings.accent = name;
  document.dispatchEvent(new Event(PALETTE_CHANGED_EVENT));
  document.querySelectorAll('.accent-swatch').forEach(el => {
    el.classList.toggle('is-active', el.dataset.accent === name);
  });
  const knightImg = $id('homeKnightImg');
  if (knightImg) {
    const knightSrcMap = {
      gold: 'assests/knight.png',
      maroon: 'assests/knight red.png',
      blue: 'assests/knight blue.png',
      green: 'assests/knight green.png',
    };
    knightImg.src = knightSrcMap[name] || 'assests/knight.png';
  }
}

function applyBoardStyle(name) {
  document.documentElement.setAttribute('data-board-style', name);
  localStorage.setItem('chessBoardStyle', name);
  state.settings.boardStyle = name;
  document.querySelectorAll('#boardStyleRow .board-style-btn').forEach(el => {
    el.classList.toggle('is-active', el.dataset.boardStyle === name);
  });
}

function applyGlow(on) {
  document.documentElement.classList.toggle('no-glow', !on);
  localStorage.setItem('chessGlow', on ? '1' : '0');
  state.settings.perfGlow = on;
}

function applyHomeBackground(name, restart) {
  state.settings.homeBackground = name;
  localStorage.setItem('chess_homeBackground', name);
  document.querySelectorAll('#homeBackgroundRow .board-style-btn').forEach(el => {
    el.classList.toggle('is-active', el.dataset.homeBg === name);
  });
  // Пешки бывают только в рое коней
  const enemiesRow = $id('homeEnemiesRow');
  if (enemiesRow) enemiesRow.classList.toggle('hidden', name !== 'knights');
  if (restart && !$id('homeScreen').classList.contains('hidden')) initHomeFigures();
}

function applyHomeEnemies(on) {
  state.settings.homeEnemies = on;
  localStorage.setItem('chess_homeEnemies', on ? '1' : '0');
  if (on) {
    if (figureState && homePageVisible) startEnemySpawner();
  } else {
    stopEnemySpawner();
    if (figureState) {
      figureState.enemies.forEach(enemy => enemy.el.remove());
      figureState.enemies = [];
    }
  }
}

function applyPerfMode() {
  const lowPerf = !state.settings.perfHighFps || !state.settings.perfSmoothAnim;
  document.documentElement.classList.toggle('perf-low', lowPerf);
}

/* ---- Режим анализа («Стандартный» / «Слабый ПК») ---- */
function applyAnalysisMode(mode) {
  const value = mode === 'weak' ? 'weak' : 'standard';
  state.settings.analysisMode = value;
  localStorage.setItem('chess_analysisMode', value);
  document.querySelectorAll('#analysisModeRow .board-style-btn').forEach(el => {
    el.classList.toggle('is-active', el.dataset.analysisMode === value);
  });
  const desc = $id('analysisModeDesc');
  if (desc) {
    desc.textContent = value === 'weak'
      ? 'После каждого хода — короткий анализ (глубина ~12), затем движок полностью останавливается. Минимальная нагрузка на процессор.'
      : 'Infinite Analysis: пока вы думаете над ходом, движок непрерывно анализирует позицию в фоне. Итоговый анализ партии строится почти мгновенно, но нагрузка на процессор повышена.';
  }
}

// Настройку режима анализа нельзя менять во время партии — блокируем
// переключатель и показываем подсказку, пока идёт партия.
function syncAnalysisModeLock() {
  const row = $id('analysisModeRow');
  const note = $id('analysisModeLockNote');
  if (!row || !note) return;
  const locked = !!state.game && !state.isGameOver;
  row.classList.toggle('is-disabled', locked);
  note.classList.toggle('hidden', !locked);
  row.querySelectorAll('.board-style-btn').forEach(btn => { btn.disabled = locked; });
}

function resetAutoHintTimer() {
  clearTimeout(autoHintTimer);
  if (state.mode === 'characters') return;
  if (!state.settings.autoHint || !state.game || state.isGameOver) return;
  if (state.game.turn() !== state.playerColor) return;
  autoHintTimer = setTimeout(() => {
    if (!state.isAsking) {
      $id('chatInput').value = 'Дай короткую подсказку по текущей позиции.';
      handleAsk();
    }
  }, state.settings.autoHintDelay * 1000);
}

/* initSettingsPanel() отвечает ТОЛЬКО за внутренние контролы настроек
   (тема/акцент/доска/время/звук/ИИ/автоподсказки/производительность).
   Открытие/закрытие и место настроек в навигации — забота Side Panel
   (см. initMenuPanel() и navigateTo('settings') ниже). Раньше здесь же
   навешивался обработчик на appSettingsBtn, из-за чего кнопка ☰ в игре
   открывала Settings напрямую, в обход меню, — источник "часть кнопок
   работает непредсказуемо". Убрано: кнопка ☰ всегда открывает Side Panel. */
function initSettingsPanel() {
  // Тема
  $id('settingsThemeToggle').addEventListener('click', () => { toggleTheme(); playSound('ui'); });

  // Акцент
  applyAccent(state.settings.accent);
  document.querySelectorAll('.accent-swatch').forEach(el => {
    el.addEventListener('click', () => { applyAccent(el.dataset.accent); playSound('ui'); });
  });

  // Оформление доски
  applyBoardStyle(state.settings.boardStyle);
  document.querySelectorAll('#boardStyleRow .board-style-btn').forEach(el => {
    el.addEventListener('click', () => { applyBoardStyle(el.dataset.boardStyle); playSound('ui'); });
  });

  // Режим анализа (заблокирован во время партии — см. syncAnalysisModeLock)
  applyAnalysisMode(state.settings.analysisMode);
  document.querySelectorAll('#analysisModeRow .board-style-btn').forEach(el => {
    el.addEventListener('click', () => {
      if (el.disabled) return;
      applyAnalysisMode(el.dataset.analysisMode);
      playSound('ui');
    });
  });
  syncAnalysisModeLock();
  // ---- Время партии ----
  const timeLimitedToggle = $id('timeLimitedToggle');
  const timeControlRow = $id('timeControlRow');
  const timeSlider = $id('timeControlSlider');

  timeLimitedToggle.checked = state.settings.timeLimited;
  timeControlRow.classList.toggle('hidden', !state.settings.timeLimited);

  timeLimitedToggle.addEventListener('change', () => {
    state.settings.timeLimited = timeLimitedToggle.checked;
    localStorage.setItem('chessTimeLimited', timeLimitedToggle.checked ? '1' : '0');
    timeControlRow.classList.toggle('hidden', !timeLimitedToggle.checked);
    playSound('ui');
    if (state.game && !state.isGameOver) {
      resetTimers();
      startTimer();
    }
  });

  timeSlider.value = state.settings.timeControl;
  $id('timeControlValue').textContent = state.settings.timeControl;
  timeSlider.addEventListener('input', () => {
    state.settings.timeControl = parseInt(timeSlider.value, 10);
    $id('timeControlValue').textContent = timeSlider.value;
    localStorage.setItem('chessTimeControl', timeSlider.value);
    if (state.game && !state.isGameOver) {
      resetTimers();
      startTimer();
    }
});

  // Звук: чекбоксы
  const soundIds = ['soundMoves', 'soundCaptures', 'soundCheck', 'soundMate', 'soundUi'];
  const soundKindMap = {
    soundMoves: 'move',
    soundCaptures: 'capture',
    soundCheck: 'check',
    soundMate: 'win',
    soundUi: 'ui'
  };
  soundIds.forEach(id => {
    const el = $id(id);
    el.checked = state.settings[id];
    el.addEventListener('change', () => {
      state.settings[id] = el.checked;
      localStorage.setItem('chess_' + id, el.checked ? '1' : '0');
      const kind = soundKindMap[id];
      if (kind) {
        // playSound сам проверит, включён ли этот звук в настройках
        playSound(kind);
      }
    });
  });

  const volumeSlider = $id('volumeSlider');
  volumeSlider.value = state.settings.volume;
  $id('volumeValue').textContent = state.settings.volume;
  volumeSlider.addEventListener('input', () => {
    state.settings.volume = parseInt(volumeSlider.value, 10);
    $id('volumeValue').textContent = volumeSlider.value;
    localStorage.setItem('chessVolume', volumeSlider.value);
  });
  volumeSlider.addEventListener('change', () => playSound('ui'));

  // ИИ: температура
  const tempSlider = $id('temperatureSlider');
  tempSlider.value = state.settings.temperature;
  $id('temperatureValue').textContent = state.settings.temperature;
  tempSlider.addEventListener('input', () => {
    state.settings.temperature = parseInt(tempSlider.value, 10);
    $id('temperatureValue').textContent = state.settings.temperature;
    localStorage.setItem('chessTemperature', String(tempSlider.value));
  });

  // ИИ: длина ответа
  const respSelect = $id('responseLengthSelect');
  respSelect.value = state.settings.responseLength;
  respSelect.addEventListener('change', () => {
    state.settings.responseLength = respSelect.value;
    localStorage.setItem('chessResponseLength', respSelect.value);
  });

  // Автоподсказки
  const autoHintToggle = $id('autoHintToggle');
  const autoHintDelayRow = $id('autoHintDelayRow');
  const autoHintDelaySlider = $id('autoHintDelaySlider');
  autoHintToggle.checked = state.settings.autoHint;
  autoHintDelayRow.classList.toggle('hidden', !state.settings.autoHint);
  autoHintToggle.addEventListener('change', () => {
    state.settings.autoHint = autoHintToggle.checked;
    localStorage.setItem('chessAutoHint', autoHintToggle.checked ? '1' : '0');
    autoHintDelayRow.classList.toggle('hidden', !autoHintToggle.checked);
    resetAutoHintTimer();
  });
  autoHintDelaySlider.value = state.settings.autoHintDelay;
  $id('autoHintDelayValue').textContent = state.settings.autoHintDelay;
  autoHintDelaySlider.addEventListener('input', () => {
    state.settings.autoHintDelay = parseInt(autoHintDelaySlider.value, 10);
    $id('autoHintDelayValue').textContent = autoHintDelaySlider.value;
    localStorage.setItem('chessAutoHintDelay', autoHintDelaySlider.value);
  });

  // Производительность
  const perfIds = ['perfHardware', 'perfHighFps', 'perfSmoothAnim'];
  perfIds.forEach(id => {
    const el = $id(id);
    el.checked = state.settings[id];
    el.addEventListener('change', () => {
      state.settings[id] = el.checked;
      localStorage.setItem('chess_' + id, el.checked ? '1' : '0');
      applyPerfMode();
    });
  });
  applyPerfMode();

  // Эффекты свечения
  const glowToggle = $id('perfGlow');
  glowToggle.checked = state.settings.perfGlow;
  applyGlow(glowToggle.checked);
  glowToggle.addEventListener('change', () => applyGlow(glowToggle.checked));

  // Фон главного экрана
  applyHomeBackground(state.settings.homeBackground, false);
  document.querySelectorAll('#homeBackgroundRow .board-style-btn').forEach(el => {
    el.addEventListener('click', () => { applyHomeBackground(el.dataset.homeBg, true); playSound('ui'); });
  });

  // Вражеские пешки на главном экране
  const homeEnemiesToggle = $id('homeEnemiesToggle');
  if (homeEnemiesToggle) {
    homeEnemiesToggle.checked = state.settings.homeEnemies;
    homeEnemiesToggle.addEventListener('change', () => {
      applyHomeEnemies(homeEnemiesToggle.checked);
      playSound('ui');
    });
  }

  // О программе
  $id('aboutLicensesLink').addEventListener('click', (e) => {
    e.preventDefault();
    showToast('chessboard.js, chess.js и Stockfish распространяются по своим open-source лицензиям (MIT/GPL)');
  });
}
