// Разделы боковой панели: профиль, достижения, статистика, вход, обратная связь, о приложении.
'use strict';

/* =========================================================================
   ИНИЦИАЛИЗАЦИЯ РАЗДЕЛОВ БОКОВОЙ ПАНЕЛИ
   Каждый раздел инициализируется отдельно и один раз (флаг *Initialized
   защищает от повторного навешивания обработчиков при повторных вызовах).
   initMenuPanel() отвечает ТОЛЬКО за открытие/закрытие панели, backdrop,
   Escape и клики по пунктам меню — ничего больше.
   ========================================================================= */
let menuPanelInitialized = false;
function initMenuPanel() {
  if (menuPanelInitialized) return;
  menuPanelInitialized = true;

  const homeBtn = $id('homeSettingsBtn');
  const appBtn = $id('appSettingsBtn');
  const backBtn = $id('menuBackBtn');
  const backdrop = $id('menuBackdrop');

  // ☰ (и справа на главном экране, и справа в игре) — ВСЕГДА открывает
  // Side Panel и ничего больше.
  if (homeBtn) homeBtn.addEventListener('click', openSidePanel);
  if (appBtn) appBtn.addEventListener('click', openSidePanel);

  // Одна кнопка в шапке панели — она же "Назад", она же "Закрыть" (см.
  // renderSideView: на корневом view показывает ✕, на остальных — ←).
  if (backBtn) backBtn.addEventListener('click', navigateBack);
  if (backdrop) backdrop.addEventListener('click', closeSidePanel);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($id('menuOverlay')?.classList.contains('open')) navigateBack();
  });

  document.querySelectorAll('.menu-nav-item[data-menu-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      try {
        handleMenuAction(btn.dataset.menuAction);
      } catch (e) {
        console.error('Ошибка навигации меню:', e);
      }
    });
  });

  const authBtn = $id('menuAuthBtn');
  if (authBtn) authBtn.addEventListener('click', () => { closeSidePanel(); openAuthModal(); });

  renderMenuProfile();
}

/* ---- Авторизация (пока локально; структура готова под замену на Supabase) ---- */
let authInitialized = false;
function initAuth() {
  if (authInitialized) return;
  authInitialized = true;

  const closeBtn = $id('authCloseBtn');
  const googleBtn = $id('authGoogleBtn');
  const vkBtn = $id('authVkBtn');
  const tabLogin = $id('authTabLogin');
  const tabRegister = $id('authTabRegister');
  const loginForm = $id('authLoginForm');
  const registerForm = $id('authRegisterForm');

  const switchAuthTab = (tab) => {
    const isLogin = tab === 'login';
    tabLogin.classList.toggle('is-active', isLogin);
    tabRegister.classList.toggle('is-active', !isLogin);
    tabLogin.setAttribute('aria-selected', String(isLogin));
    tabRegister.setAttribute('aria-selected', String(!isLogin));
    loginForm.classList.toggle('hidden', !isLogin);
    registerForm.classList.toggle('hidden', isLogin);
    $id('authModalTitle').textContent = isLogin ? 'Вход в аккаунт' : 'Регистрация';
    clearAuthErrors();
  };

  if (tabLogin) tabLogin.addEventListener('click', () => switchAuthTab('login'));
  if (tabRegister) tabRegister.addEventListener('click', () => switchAuthTab('register'));

  if (closeBtn) closeBtn.addEventListener('click', () => hideModal('authModal'));
  $id('authLoginCancelBtn').addEventListener('click', () => hideModal('authModal'));
  $id('authRegisterCancelBtn').addEventListener('click', () => hideModal('authModal'));

  // Показать/скрыть пароль
  document.querySelectorAll('.auth-password-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = $id(btn.dataset.target);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.classList.toggle('is-visible', show);
    });
  });

  // Индикатор надёжности пароля при регистрации
  const regPassword = $id('authRegisterPassword');
  if (regPassword) regPassword.addEventListener('input', () => updatePasswordStrength(regPassword.value));

  // Отправка форм
  if (loginForm) loginForm.addEventListener('submit', (e) => { e.preventDefault(); handleLoginSubmit(); });
  if (registerForm) registerForm.addEventListener('submit', (e) => { e.preventDefault(); handleRegisterSubmit(); });

  $id('authForgotBtn').addEventListener('click', () => {
    showToast('Восстановление пароля скоро будет доступно');
  });

  // Вход через Google/VK пока не реализован — заглушка с уведомлением.
  if (googleBtn) googleBtn.addEventListener('click', () => signInWithOAuthProvider('google'));
  if (vkBtn) vkBtn.addEventListener('click', () => signInWithOAuthProvider('custom:vk')); // 'vk' — slug вашего Custom Provider в Supabase

  // Клик по фону (вне .modal) закрывает модалку, как обычный modal-overlay.
  const overlay = $id('authModal');
  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) hideModal('authModal'); });

  // Escape закрывает authModal, если она открыта.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!overlay || overlay.classList.contains('hidden')) return;
    hideModal('authModal');
  });

  // Открываем модалку всегда на вкладке "Вход"
  switchAuthTab('login');
}

// Проверка текущей сессии Supabase при загрузке страницы + подписка на её изменения
async function initSupabaseSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await fetchProfileFromSupabase(session.user.id);
    renderMenuProfile();
  }
  refreshChatQuota().then(() => { handlePaymentParams(); resumePendingBuy(); });

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      await fetchProfileFromSupabase(session.user.id);
    } else if (event === 'SIGNED_OUT') {
      clearAccount();
    }
    if (event === 'SIGNED_IN') refreshChatQuota().then(resumePendingBuy);
    if (event === 'SIGNED_OUT') refreshChatQuota();
    renderMenuProfile();
    if (typeof getCurrentView === 'function' && getCurrentView() === 'profile') renderProfileView();
  });
}

// Вход через OAuth-провайдера (Google — встроенный провайдер Supabase,
// VK — подключается как Custom OAuth/OIDC Provider, provider: 'vk' — это
// slug, который вы зададите при настройке в Supabase Dashboard).
// Supabase сам перенаправит на страницу провайдера и обратно; после
// редиректа сработает initSupabaseSession()/onAuthStateChange, который
// подтянет профиль — здесь ничего дополнительно обрабатывать не нужно.
async function signInWithOAuthProvider(provider) {
  const { error } = await sb.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.href.split('#')[0].split('?')[0] } // полный текущий путь, а не только домен — важно для GitHub Pages, где сайт живёт в подпапке /reponame/
  });
  if (error) showToast('Не удалось начать вход через ' + provider);
}

function clearAuthErrors() {
  document.querySelectorAll('.auth-field-error').forEach((el) => { el.textContent = ''; });
  document.querySelectorAll('.auth-field .menu-text-input').forEach((el) => el.classList.remove('is-invalid'));
}

function setFieldError(inputId, errorId, message) {
  const input = $id(inputId);
  const error = $id(errorId);
  if (input) input.classList.toggle('is-invalid', Boolean(message));
  if (error) error.textContent = message || '';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function updatePasswordStrength(pass) {
  const wrap = $id('authPasswordStrength');
  if (!wrap) return;
  const bar = wrap.querySelector('span');
  let score = 0;
  if (pass.length >= 8) score++;
  if (pass.length >= 12) score++;
  if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) score++;
  if (/\d/.test(pass)) score++;
  if (/[^A-Za-z0-9]/.test(pass)) score++;
  const levels = ['weak', 'weak', 'medium', 'medium', 'strong', 'strong'];
  wrap.dataset.level = pass ? levels[score] : '';
  bar.style.width = pass ? `${Math.min(score, 5) * 20}%` : '0%';
}

async function handleLoginSubmit() {
  clearAuthErrors();
  const email = $id('authLoginEmail').value.trim();
  const password = $id('authLoginPassword').value;
  let valid = true;

  if (!email || !EMAIL_RE.test(email)) {
    setFieldError('authLoginEmail', 'authLoginEmailError', 'Введите корректный email');
    valid = false;
  }
  if (!password) {
    setFieldError('authLoginPassword', 'authLoginPasswordError', 'Введите пароль');
    valid = false;
  }
  if (!valid) return;

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { setFieldError('authLoginPassword', 'authLoginPasswordError', 'Неверный email или пароль'); return; }

  const acc = await fetchProfileFromSupabase(data.user.id);
  hideModal('authModal');
  renderMenuProfile();
  if (typeof getCurrentView === 'function' && getCurrentView() === 'profile') renderProfileView();
  showToast(`С возвращением, ${acc ? acc.name : ''}!`);
}

async function handleRegisterSubmit() {
  clearAuthErrors();
  const name = $id('authRegisterName').value.trim().slice(0, 24);
  const email = $id('authRegisterEmail').value.trim();
  const password = $id('authRegisterPassword').value;
  const password2 = $id('authRegisterPassword2').value;
  let valid = true;

  if (!name) {
    setFieldError('authRegisterName', 'authRegisterNameError', 'Введите имя');
    valid = false;
  }
  if (!email || !EMAIL_RE.test(email)) {
    setFieldError('authRegisterEmail', 'authRegisterEmailError', 'Введите корректный email');
    valid = false;
  }
  if (!password || password.length < 8) {
    setFieldError('authRegisterPassword', 'authRegisterPasswordError', 'Минимум 8 символов');
    valid = false;
  }
  if (password2 !== password || !password2) {
    setFieldError('authRegisterPassword2', 'authRegisterPassword2Error', 'Пароли не совпадают');
    valid = false;
  }
  if (!valid) return;

  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { name } } // попадёт в user_metadata, подхватится триггером handle_new_user
  });
  if (error) { setFieldError('authRegisterEmail', 'authRegisterEmailError', error.message); return; }

  // Профиль создаётся триггером на стороне БД; кэшируем то, что уже знаем.
  saveAccount({ name, avatar: '♟', elo: 1200 });
  hideModal('authModal');
  renderMenuProfile();
  if (typeof getCurrentView === 'function' && getCurrentView() === 'profile') renderProfileView();
  showToast(`Добро пожаловать, ${name}!`);
}

/* ---- Профиль (view внутри панели) ---- */
let profileInitialized = false;
function initProfileView() {
  if (profileInitialized) return;
  profileInitialized = true;

  const editBtn = $id('profileEditBtn');
  const logoutBtn = $id('profileLogoutBtn');
  const guestAuthBtn = $id('profileViewAuthBtn');

  if (editBtn) editBtn.addEventListener('click', openProfileEditModal);
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
  if (guestAuthBtn) guestAuthBtn.addEventListener('click', () => { closeSidePanel(); openAuthModal(); });
}

/* ---- Редактирование профиля (view внутри панели) ---- */
let profileEditInitialized = false;
function initProfileEditView() {
  if (profileEditInitialized) return;
  profileEditInitialized = true;

  document.querySelectorAll('#profileAvatarPicker .avatar-choice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#profileAvatarPicker .avatar-choice-btn').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
    });
  });

  const saveBtn = $id('profileEditSaveBtn');
  const cancelBtn = $id('profileEditCancelBtn');

  if (saveBtn) saveBtn.addEventListener('click', handleProfileEditSave);
  // Cancel -> Profile, через тот же navigateBack(), что и кнопка "←" в шапке.
  if (cancelBtn) cancelBtn.addEventListener('click', () => navigateBack());
}

/* ---- Достижения (view внутри панели) ---- */
function initAchievementsView() { /* без собственных обработчиков — только рендер данных в renderAchievementsGrid() */ }

/* ---- Статистика (view внутри панели) ---- */
function initStatsView() {
  const hero = $id('statsEloHero');
  const wrap = $id('statsEloChartWrap');
  if (!hero || !wrap || hero.dataset.bound) return;
  hero.dataset.bound = '1';

  const toggleChart = () => {
    const isOpen = wrap.classList.toggle('is-open');
    hero.classList.toggle('is-open', isOpen);
    hero.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    wrap.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  };
  hero.addEventListener('click', toggleChart);
  hero.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleChart(); }
  });

  // Делегирование событий на точки графика: hover — для десктопа,
  // click/touch — для мобильных устройств (без зависимости от hover).
  const inner = $id('statsEloChartInner');
  if (!inner) return;
  const showTip = (pointEl) => {
    const tip = $id('statsEloTooltip');
    const svg = pointEl.closest('svg');
    if (!tip || !svg) return;
    const { n, elo, delta } = pointEl.dataset;
    const d = Number(delta);
    const sign = d > 0 ? '+' : (d < 0 ? '' : '±');
    tip.innerHTML = `Партия #${n}<br>${elo} Elo<br>${sign}${d}`;
    tip.hidden = false;
    const match = pointEl.getAttribute('transform').match(/[-\d.]+/g);
    const cx = parseFloat(match[0]);
    const ratio = svg.clientWidth / 300;
    tip.style.left = `${cx * ratio}px`;
  };
  const hideTip = () => { const tip = $id('statsEloTooltip'); if (tip) tip.hidden = true; };

  inner.addEventListener('mouseover', (e) => {
    const pt = e.target.closest('.elo-point');
    if (pt) showTip(pt);
  });
  inner.addEventListener('mouseleave', hideTip);
  inner.addEventListener('click', (e) => {
    const pt = e.target.closest('.elo-point');
    if (pt) { showTip(pt); e.stopPropagation(); } else { hideTip(); }
  });
}

/* ---- Обратная связь (модалка поверх Side Panel, insert в Supabase) ---- */
let feedbackModalInitialized = false;
let feedbackSubmitting = false;
let feedbackReturnFocusEl = null;
const FEEDBACK_TYPES = ['bug', 'suggestion', 'question', 'other'];

// Только неигровые/нечувствительные данные — без FEN, истории партии или чата.
function collectFeedbackMetadata() {
  return {
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    language: 'ru',
    accent: state.settings.accent,
    boardStyle: state.settings.boardStyle,
    mode: state.mode || null,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
  };
}

function clearFeedbackErrors() {
  ['feedbackMessageError', 'feedbackContactError'].forEach((id) => {
    const el = $id(id);
    if (el) el.textContent = '';
  });
  const formErr = $id('feedbackFormError');
  if (formErr) { formErr.hidden = true; formErr.textContent = ''; }
}

function showFeedbackError(message) {
  const formErr = $id('feedbackFormError');
  if (formErr) { formErr.textContent = message; formErr.hidden = false; }
}

function setFeedbackLoading(loading) {
  feedbackSubmitting = loading;
  const btn = $id('feedbackSubmitBtn');
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? 'Отправка…' : 'Отправить';
}

function resetFeedbackForm() {
  const form = $id('feedbackForm');
  if (form) form.reset();
  clearFeedbackErrors();
  const counter = $id('feedbackMessageCounter');
  if (counter) counter.textContent = '0 / 2000';
  const fieldsGroup = $id('feedbackFieldsGroup');
  const success = $id('feedbackSuccess');
  if (fieldsGroup) fieldsGroup.classList.remove('hidden');
  if (success) success.classList.add('hidden');
  setFeedbackLoading(false);
}

function openFeedbackModal() {
  feedbackReturnFocusEl = document.activeElement;
  resetFeedbackForm();
  showModal('feedbackModal');
  const typeSelect = $id('feedbackType');
  if (typeSelect) typeSelect.focus();
}

function closeFeedbackModal() {
  if (feedbackSubmitting) return; // не закрываем модалку посреди отправки
  hideModal('feedbackModal');
  if (feedbackReturnFocusEl && typeof feedbackReturnFocusEl.focus === 'function') {
    feedbackReturnFocusEl.focus();
  }
  feedbackReturnFocusEl = null;
}

async function submitFeedback() {
  if (feedbackSubmitting) return; // защита от двойной отправки
  clearFeedbackErrors();

  const typeEl = $id('feedbackType');
  const messageEl = $id('feedbackMessage');
  const contactEl = $id('feedbackContact');
  if (!typeEl || !messageEl || !contactEl) return;

  const type = FEEDBACK_TYPES.includes(typeEl.value) ? typeEl.value : 'other';
  const message = (messageEl.value || '').trim();
  const contact = (contactEl.value || '').trim();

  if (!message) {
    showFeedbackFieldError('feedbackMessageError', 'Опишите проблему, предложение или вопрос.');
    messageEl.focus();
    return;
  }
  if (message.length > 2000) {
    showFeedbackFieldError('feedbackMessageError', 'Сообщение слишком длинное (максимум 2000 символов).');
    messageEl.focus();
    return;
  }
  if (contact.length > 120) {
    showFeedbackFieldError('feedbackContactError', 'Слишком длинный контакт (максимум 120 символов).');
    contactEl.focus();
    return;
  }

  setFeedbackLoading(true);
  try {
    const { data: { user } } = await sb.auth.getUser();
    const { error } = await sb.from('feedback').insert({
      user_id: user ? user.id : null,
      type,
      message,
      contact: contact || null,
      app_version: APP_VERSION,
      metadata: collectFeedbackMetadata(),
    });
    if (error) throw error;

    const fieldsGroup = $id('feedbackFieldsGroup');
    const success = $id('feedbackSuccess');
    if (fieldsGroup) fieldsGroup.classList.add('hidden');
    if (success) success.classList.remove('hidden');
    setFeedbackLoading(false);

    setTimeout(() => {
      const overlay = $id('feedbackModal');
      if (overlay && !overlay.classList.contains('hidden')) closeFeedbackModal();
    }, 3000);
  } catch (err) {
    console.error('Не удалось отправить обратную связь:', err);
    showFeedbackError('Не удалось отправить сообщение. Попробуйте ещё раз.');
    setFeedbackLoading(false);
  }
}
function showFeedbackFieldError(id, message) {
  const el = $id(id);
  if (el) el.textContent = message;
}

function initFeedbackModal() {
  if (feedbackModalInitialized) return;
  feedbackModalInitialized = true;

  const overlay = $id('feedbackModal');
  const form = $id('feedbackForm');
  const closeBtn = $id('feedbackCloseBtn');
  const cancelBtn = $id('feedbackCancelBtn');
  const successCloseBtn = $id('feedbackSuccessCloseBtn');
  const messageEl = $id('feedbackMessage');
  const counter = $id('feedbackMessageCounter');

  if (form) form.addEventListener('submit', (e) => { e.preventDefault(); submitFeedback(); });
  if (closeBtn) closeBtn.addEventListener('click', () => closeFeedbackModal());
  if (cancelBtn) cancelBtn.addEventListener('click', () => closeFeedbackModal());
  if (successCloseBtn) successCloseBtn.addEventListener('click', () => closeFeedbackModal());

  if (messageEl && counter) {
    messageEl.addEventListener('input', () => {
      counter.textContent = `${messageEl.value.length} / 2000`;
    });
  }

  // Клик по фону (вне .modal) закрывает модалку — как у остальных modal-overlay.
  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFeedbackModal(); });

  // Escape закрывает feedbackModal, если она открыта.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!overlay || overlay.classList.contains('hidden')) return;
    closeFeedbackModal();
  });
}

/* ---- О приложении (view внутри панели) ---- */
let aboutViewInitialized = false;
function initAboutView() {
  if (aboutViewInitialized) return;
  aboutViewInitialized = true;

  const versionEl = $id('aboutHeroVersion');
  if (versionEl) versionEl.textContent = `v${APP_VERSION}`;

  const licensesLink = $id('aboutLicensesLinkMenu');
  if (licensesLink) {
    licensesLink.addEventListener('click', (e) => {
      e.preventDefault();
      showToast('chessboard.js, chess.js и Stockfish распространяются по своим open-source лицензиям (MIT/GPL)');
    });
  }

  const feedbackBtn = $id('aboutFeedbackBtn');
  if (feedbackBtn) {
    feedbackBtn.addEventListener('click', () => openFeedbackModal());
  }
}
