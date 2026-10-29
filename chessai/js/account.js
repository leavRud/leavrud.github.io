// Аккаунт и вход.
'use strict';

/* =========================================================================
   АККАУНТ
   -------------------------------------------------------------------------
   getAccount/saveAccount/clearAccount — локальный кэш в localStorage,
   нужен для мгновенной отрисовки профиля без ожидания сети. Источник
   истины — таблица profiles в Supabase; после логина/загрузки сессии
   кэш синхронизируется через fetchProfileFromSupabase().
   ========================================================================= */
const ACCOUNT_STORAGE_KEY = 'chessAccount';

function getAccount() {
  try {
    const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function saveAccount(acc) {
  try { localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(acc)); } catch (e) {}
}
function clearAccount() {
  try { localStorage.removeItem(ACCOUNT_STORAGE_KEY); } catch (e) {}
}

// Подтягивает профиль пользователя из таблицы profiles и обновляет локальный кэш.
async function fetchProfileFromSupabase(userId) {
  const { data, error } = await sb
    .from('profiles')
    .select('name, avatar, elo')
    .eq('id', userId)
    .single();
  if (error || !data) return null;
  const acc = { name: data.name, avatar: data.avatar || '♟', elo: data.elo ?? 1200 };
  saveAccount(acc);
  return acc;
}

// Записывает изменения профиля (например, новый Elo) в Supabase и локальный кэш.
async function syncProfileToSupabase(userId, patch) {
  const { error } = await sb
    .from('profiles')
    .update(patch)
    .eq('id', userId);
  if (error) console.error('Не удалось сохранить профиль в Supabase:', error);
}

const ELO_HISTORY_LIMIT = 200;

// Гарантирует наличие eloHistory у старых аккаунтов (первая точка = стартовый Elo).
function ensureEloHistory(acc) {
  if (!Array.isArray(acc.eloHistory) || !acc.eloHistory.length) {
    acc.eloHistory = [{ n: 0, elo: Number.isFinite(acc.elo) ? acc.elo : 1200, delta: 0, ts: Date.now() }];
  }
  return acc.eloHistory;
}

// Обновляем рейтинг аккаунта после анализа партии (плавное скользящее среднее)
async function updateAccountEloFromGame(playerElo) {
  // «На одном ПК» (friend) не участвует в рейтинге: не начисляем и не пишем в историю.
  if (state.mode === 'friend') return;

  const acc = getAccount();
  if (!acc || !Number.isFinite(playerElo)) return;

  const history = ensureEloHistory(acc);

  // Защита от дублей: повторный вызов для той же партии (например, повторное
  // «Обновить анализ») не должен добавлять вторую точку в историю.
  const gameKey = (state.game && typeof state.game.pgn === 'function') ? state.game.pgn() : null;
  if (gameKey && acc.lastEloGameKey === gameKey) return;

  const base = Number.isFinite(acc.elo) ? acc.elo : 1200;
  const newElo = Math.round(base * 0.7 + playerElo * 0.3);
  const delta = newElo - base;
  acc.elo = newElo;

  const lastPoint = history[history.length - 1];
  history.push({ n: lastPoint.n + 1, elo: newElo, delta, ts: Date.now() });
  if (history.length > ELO_HISTORY_LIMIT) {
    acc.eloHistory = [history[0], ...history.slice(-(ELO_HISTORY_LIMIT - 1))];
  }
  if (gameKey) acc.lastEloGameKey = gameKey;

  saveAccount(acc);
  renderMenuProfile();
  if (getCurrentView() === 'stats') renderStatsView();

  const { data: { user } } = await sb.auth.getUser();
  if (user) syncProfileToSupabase(user.id, { elo: acc.elo });
}

function renderMenuProfile() {
  const avatarEl = $id('menuAvatar');
  const nameEl = $id('menuProfileName');
  const eloEl = $id('menuProfileElo');
  const authBtn = $id('menuAuthBtn');
  const cardEl = $id('menuProfileCard');
  if (!avatarEl || !nameEl || !eloEl || !authBtn || !cardEl) return;

  const acc = getAccount();
  if (acc) {
    avatarEl.textContent = acc.avatar || '♟';
    nameEl.textContent = acc.name || 'Игрок';
    eloEl.textContent = `${Number.isFinite(acc.elo) ? acc.elo : 1200} Elo`;
    eloEl.classList.remove('hidden');
    authBtn.classList.add('hidden');
    cardEl.classList.remove('is-guest');
  } else {
    avatarEl.textContent = '♟';
    nameEl.textContent = 'Гость';
    eloEl.classList.add('hidden');
    authBtn.classList.remove('hidden');
    cardEl.classList.add('is-guest');
  }
}

/* ---- Мок-авторизация (полностью локальная, без сервера) ----
   Вход — короткое самостоятельное действие, поэтому остаётся обычной
   модалкой (см. правило: модалки — только для коротких действий),
   а не view боковой панели. */
function openAuthModal() {
  ['authLoginEmail', 'authLoginPassword', 'authRegisterName', 'authRegisterEmail', 'authRegisterPassword', 'authRegisterPassword2'].forEach((id) => {
    const el = $id(id);
    if (el) el.value = '';
  });
  clearAuthErrors();
  updatePasswordStrength('');
  showModal('authModal');
  setTimeout(() => { const el = $id('authLoginEmail'); if (el) el.focus(); }, 50);
}
async function handleLogout() {
  await sb.auth.signOut();
  clearAccount();
  renderMenuProfile();
  if (typeof getCurrentView === 'function' && getCurrentView() === 'profile') renderProfileView();
  showToast('Вы вышли из аккаунта');
}
