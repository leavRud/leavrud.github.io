// Правая боковая панель: стек навигации и меню.
'use strict';

/* =========================================================================
   ПРАВАЯ БОКОВАЯ ПАНЕЛЬ (SIDE PANEL) — ЕДИНАЯ СИСТЕМА НАВИГАЦИИ
   -------------------------------------------------------------------------
   Вся навигация приложения (Профиль / Настройки / Достижения / Статистика /
   О приложении) проходит через один navigation stack, а не через набор
   независимых пар open.../close... и showModal()/hideModal() для каждого
   раздела. Кнопка "Назад" ничего не угадывает — она просто снимает верхний
   элемент стека. Экран, соответствующий текущему верхнему элементу стека,
   получает класс .is-active; все остальные .side-view скрыты (display:none).
   ========================================================================= */
const SIDE_VIEWS = ['menu', 'profile', 'profile-edit', 'settings', 'achievements', 'stats', 'about'];
const SIDE_VIEW_TITLES = {
  menu: '',
  profile: 'Профиль',
  'profile-edit': 'Редактирование',
  settings: 'Настройки',
  achievements: 'Достижения',
  stats: 'Статистика',
  about: 'О приложении',
};

const navigationState = { stack: ['menu'] };

function getCurrentView() {
  return navigationState.stack[navigationState.stack.length - 1];
}

// Применяет текущий верхний view стека к DOM: показывает нужный .side-view,
// обновляет заголовок и кнопку "Назад/Закрыть", и вызывает hook раздела
// (заполнение реальными данными — профиль/статистика/достижения).
function renderSideView() {
  const view = getCurrentView();
  const panel = document.querySelector('.settings-panel');
  if (panel) {
    panel.classList.toggle('panel-expanded', view === 'achievements');
  }
  document.querySelectorAll('.side-view').forEach(el => {
    el.classList.toggle('is-active', el.id === `view-${view}`);
  });

  const titleEl = $id('sidePanelTitle');
  if (titleEl) titleEl.textContent = SIDE_VIEW_TITLES[view] || '';

  const backBtn = $id('menuBackBtn');
  if (backBtn) {
    const isRoot = navigationState.stack.length <= 1;
    backBtn.textContent = isRoot ? '✕' : '←';
    backBtn.setAttribute('aria-label', isRoot ? 'Закрыть' : 'Назад');
  }

  if (view === 'menu') renderMenuProfile();
  else if (view === 'profile') renderProfileView();
  else if (view === 'settings') { syncAutoHintAvailability(); syncAnalysisModeLock(); }
  else if (view === 'achievements') renderAchievementsGrid();
  else if (view === 'stats') renderStatsView();
}
function renderAchievementsGrid() {
  const container = document.getElementById('achievementsGridContainer');
  const summaryEl = document.getElementById('achievementsViewSummary');
  const barEl = document.getElementById('achievementsViewBar');
  if (!container) return;

  if (!window.Achievements || typeof window.Achievements.getAchievements !== 'function') {
    container.innerHTML = '<p class="modal-sub">Модуль достижений недоступен.</p>';
    const cards = container.querySelectorAll('.achv-card');
    cards.forEach((card, index) => {
      card.style.opacity = '0';
      card.style.transform = 'translateY(20px) scale(0.95)';
      card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      setTimeout(() => {
        card.style.opacity = '1';
        card.style.transform = 'translateY(0) scale(1)';
      }, 100 + index * 60);
    });
    return;
  }

  const list = window.Achievements.getAchievements();
  const stats = window.Achievements.getStats();
  const unlockedCount = list.filter(a => window.Achievements.isUnlocked(a.id)).length;
  const total = list.length;

  if (summaryEl) summaryEl.textContent = `${unlockedCount} / ${total}`;
  if (barEl) {
    const pct = total > 0 ? Math.round((unlockedCount / total) * 100) : 0;
    barEl.style.width = pct + '%';
  }

  // Сортируем: открытые сверху
  const sorted = list.slice().sort((a, b) => {
    const ua = window.Achievements.isUnlocked(a.id);
    const ub = window.Achievements.isUnlocked(b.id);
    return (ua === ub) ? 0 : (ua ? -1 : 1);
  });

  container.innerHTML = sorted.map(def => {
    const unlocked = window.Achievements.isUnlocked(def.id);
    const hideInfo = def.secret && !unlocked;
    const name = hideInfo ? '???' : def.name;
    const desc = hideInfo ? 'Секретное достижение' : def.desc;
    const icon = hideInfo ? '🔒' : def.icon;
    const dateStr = unlocked ? new Date(window.Achievements.getUnlockDate(def.id)).toLocaleDateString('ru-RU') : '';
    let progressHtml = '';
    if (def.progress && !hideInfo) {
      const p = def.progress(stats);
      const pct = Math.min(100, Math.round((p.current / p.goal) * 100));
      progressHtml = `<div class="achv-progress"><div class="achv-progress-bar" style="width:${pct}%"></div></div>
        <div class="achv-progress-label">${Math.min(p.current, p.goal)} / ${p.goal}</div>`;
    }
    return `<div class="achv-card ${unlocked ? 'is-unlocked' : 'is-locked'} ${def.secret ? 'is-secret' : ''}">
      <div class="achv-card-icon">${icon}</div>
      <div class="achv-card-name">${escapeHtml(name)}</div>
      <div class="achv-card-desc">${escapeHtml(desc)}</div>
      ${progressHtml}
      ${unlocked ? `<div class="achv-card-date">Получено: ${dateStr}</div>` : ''}
    </div>`;
  }).join('');

  // Применяем эффект "колеса" сразу же, не дожидаясь первого скролла —
  // ждём кадр отрисовки, чтобы карточки успели встать на свои места.
  if (typeof applySpinEffect === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(applySpinEffect));
  }
}
// Переход вперёд — кладём новый view на вершину стека.
function navigateTo(view) {
  if (!SIDE_VIEWS.includes(view)) { console.warn('Неизвестный view боковой панели:', view); return; }
  if (getCurrentView() !== view) {
    navigationState.stack.push(view);
    playSound('ui');
  }
  renderSideView();
}

// Кнопка "Назад" (и Escape) — ЕДИНСТВЕННЫЙ способ вернуться назад.
// Никаких if(profileOpen)/else if(settingsOpen) — просто pop() стека.
// Если мы уже в корне (menu) — закрываем панель целиком.
function navigateBack() {
  if (navigationState.stack.length > 1) {
    navigationState.stack.pop();
    renderSideView();
  } else {
    closeSidePanel();
  }
}

function resetNavigation() {
  navigationState.stack = ['menu'];
  renderSideView();
}

function openSidePanel() {
  resetNavigation(); // панель всегда открывается с корневого экрана — Menu
  const overlay = $id('menuOverlay');
  if (!overlay) { console.error('menuOverlay не найден'); return; }
  overlay.classList.add('open');
  playSound('ui');
}
function closeSidePanel() {
  const overlay = $id('menuOverlay');
  if (overlay) overlay.classList.remove('open');
  // Стек намеренно не сбрасываем здесь — иначе смена view "мигала" бы прямо
  // во время анимации закрытия. Сброс происходит в openSidePanel() при
  // следующем открытии (см. resetNavigation()).
}

// Обратно совместимые алиасы — те же имена, что были в проекте раньше,
// чтобы не плодить дубликаты функций с другими названиями.
function openMenuPanel() { openSidePanel(); }
function closeMenuPanel() { closeSidePanel(); }

/* ---- Единый обработчик навигации меню ----
   Значения data-menu-action у пунктов меню ('profile', 'settings',
   'achievements', 'stats', 'about') совпадают с именами view — поэтому
   обработчик сводится к одному вызову navigateTo(). */
function handleMenuAction(action) {
  navigateTo(action);
}

/* ---- Профиль ----
   openProfileModal()/openProfileEditModal() — сохранённые имена старых
   функций, теперь просто переключают view внутри панели вместо
   showModal('profileModal')/showModal('profileEditModal'). */
function openProfileModal() {
  navigateTo('profile');
}
function renderProfileView() {
  const acc = getAccount();
  const avatarEl = $id('profileViewAvatar');
  const nameEl = $id('profileViewName');
  const eloEl = $id('profileViewElo');
  const statsEl = $id('profileViewStats');
  const guestEl = $id('profileViewGuest');
  const editBtn = $id('profileEditBtn');
  const logoutBtn = $id('profileLogoutBtn');
  if (!avatarEl || !nameEl || !eloEl) return;

  if (acc) {
    avatarEl.textContent = acc.avatar || '♟';
    nameEl.textContent = acc.name || 'Игрок';
    eloEl.textContent = `${Number.isFinite(acc.elo) ? acc.elo : 1200} Elo`;
    eloEl.classList.remove('hidden');
    if (guestEl) guestEl.classList.add('hidden');
    if (statsEl) statsEl.classList.remove('hidden');
    if (editBtn) editBtn.classList.remove('hidden');
    if (logoutBtn) logoutBtn.classList.remove('hidden');

    // Реальные данные из существующей системы достижений — без выдуманных значений.
    const stats = window.Achievements?.getStats?.();
    const eloStatEl = $id('profileStatElo');
    const winsEl = $id('profileStatWins');
    const gamesEl = $id('profileStatGames');
    if (eloStatEl) eloStatEl.textContent = Number.isFinite(acc.elo) ? acc.elo : 1200;
    if (winsEl) winsEl.textContent = stats && Number.isFinite(stats.winsTotal) ? stats.winsTotal : '—';
    if (gamesEl) gamesEl.textContent = stats && Number.isFinite(stats.gamesPlayed) ? stats.gamesPlayed : '—';
  } else {
    avatarEl.textContent = '♟';
    nameEl.textContent = 'Гость';
    eloEl.classList.add('hidden');
    if (statsEl) statsEl.classList.add('hidden');
    if (editBtn) editBtn.classList.add('hidden');
    if (logoutBtn) logoutBtn.classList.add('hidden');
    if (guestEl) guestEl.classList.remove('hidden');
  }
}

function openProfileEditModal() {
  const acc = getAccount() || { name: '', avatar: '♟', elo: 1200 };
  $id('profileEditNameInput').value = acc.name || '';
  document.querySelectorAll('#profileAvatarPicker .avatar-choice-btn').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.avatar === (acc.avatar || '♟'));
  });
  navigateTo('profile-edit');
}
function handleProfileEditSave() {
  const acc = getAccount() || { elo: 1200 };
  const name = ($id('profileEditNameInput').value || '').trim().slice(0, 24) || 'Игрок';
  const activeAvatarBtn = document.querySelector('#profileAvatarPicker .avatar-choice-btn.is-active');
  acc.name = name;
  acc.avatar = activeAvatarBtn ? activeAvatarBtn.dataset.avatar : (acc.avatar || '♟');
  if (!Number.isFinite(acc.elo)) acc.elo = 1200;
  saveAccount(acc);
  navigateBack(); // Save -> возвращаемся в Profile (renderProfileView вызовется сам)
  renderMenuProfile();
  showToast('Профиль обновлён');
}

/* ---- Достижения ----
   Полный список достижений с категориями/прогрессом/секретками рендерится
   через renderAchievementsGrid() (см. renderSideView()) напрямую из
   существующей системы window.Achievements — единственная система
   отображения достижений в приложении. */
function openAchievementsFromMenu() {
  navigateTo('achievements');
}

/* ---- Статистика ---- */
function openStatsFromMenu() {
  navigateTo('stats');
}
function renderStatsView() {
  const eloEl = $id('statsViewElo');
  const body = $id('statsViewBody');
  const acc = getAccount();
  if (eloEl) eloEl.textContent = acc && Number.isFinite(acc.elo) ? acc.elo : '—';
  renderEloChartCard(acc);
  if (body) {
    const stats = window.Achievements?.getStats?.();
    // getStats() всегда возвращает объект с нулевыми значениями по умолчанию,
    // поэтому "нет данных" определяем по gamesPlayed, а не по наличию stats.
    const hasPlayed = stats && Number.isFinite(stats.gamesPlayed) && stats.gamesPlayed > 0;
    body.innerHTML = hasPlayed
      ? renderStatsAsList(stats)
      : '<p class="modal-sub">Пока нет статистики — сыграйте первую партию, чтобы увидеть свой прогресс.</p>';
  }
}

const STAT_LABELS_RU = {
  gamesPlayed: 'Сыграно партий',
  winsTotal: 'Побед всего',
  currentWinStreak: 'Текущая серия побед',
  bestWinStreak: 'Лучшая серия побед',
  analysesCount: 'Проведено анализов партий',
  charactersPlayed: 'Персонажей сыграно',
  aiWinStreak: 'Побед подряд над Stockfish',
  modesPlayed: 'Опробовано режимов игры',
  checkTypesGiven: 'Видов шаха объявлено',
  homeEnemiesKilled: 'Побеждено на главном экране',
};
function humanizeStatKey(key) {
  if (STAT_LABELS_RU[key]) return STAT_LABELS_RU[key];
  const spaced = key.replace(/([A-Z])/g, ' $1').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
function renderStatsAsList(stats) {
  const rows = [];
  Object.keys(stats).forEach(key => {
    const val = stats[key];
    if (Array.isArray(val)) {
      rows.push(`<div class="settings-row"><span class="settings-row-label">${escapeHtml(humanizeStatKey(key))}</span><span>${val.length}</span></div>`);
    } else if (val !== null && typeof val === 'object') {
      // сложные вложенные объекты пропускаем — им нужен отдельный экран
    } else if (val !== undefined) {
      rows.push(`<div class="settings-row"><span class="settings-row-label">${escapeHtml(humanizeStatKey(key))}</span><span>${escapeHtml(String(val))}</span></div>`);
    }
  });
  return rows.length ? rows.join('') : '<p class="modal-sub">Пока нет данных.</p>';
}

/* ---- Мини-график Elo (SVG, раскрывается под ELO-хиро) ---- */
function buildEloChartSvg(history) {
  const W = 300, H = 120, padX = 10, padY = 14;
  const elos = history.map(p => p.elo);
  let min = Math.min(...elos), max = Math.max(...elos);
  if (min === max) { min -= 10; max += 10; }
  const span = max - min;
  const stepX = history.length > 1 ? (W - padX * 2) / (history.length - 1) : 0;

  const points = history.map((p, i) => ({
    ...p,
    x: padX + i * stepX,
    y: padY + (H - padY * 2) * (1 - (p.elo - min) / span),
  }));

  const linePoints = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const dots = points.map(p => `
    <g class="elo-point" tabindex="0" data-n="${p.n}" data-elo="${p.elo}" data-delta="${p.delta}"
       transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
      <circle class="elo-point-hit" r="9"></circle>
      <circle class="elo-point-dot" r="3"></circle>
    </g>`).join('');

  return `<svg class="stats-elo-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <polyline class="elo-line" points="${linePoints}" fill="none"></polyline>
    ${dots}
  </svg>`;
}

function renderEloChartCard(acc) {
  const wrap = $id('statsEloChartInner');
  if (!wrap) return;
  const history = acc ? ensureEloHistory(acc) : null;
  if (!history || history.length < 2) {
    wrap.innerHTML = '<p class="modal-sub stats-elo-chart-empty">График появится после первой рейтинговой партии.</p>';
    return;
  }
  wrap.innerHTML = buildEloChartSvg(history) + '<div class="elo-tooltip" id="statsEloTooltip" hidden></div>';
}

/* ---- О приложении ---- */
function openAboutFromMenu() {
  navigateTo('about');
}
