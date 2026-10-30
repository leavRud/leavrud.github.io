// Запросы к нейросети через Supabase Edge Function, дневной лимит и покупка пакетов вопросов.
'use strict';

/* =========================================================================
   PROVOD.AI (через Supabase Edge Function — работает на любом хостинге,
   включая GitHub Pages, без локального прокси-сервера)
   ========================================================================= */
// kind: 'question' — тратит вопрос из дневного лимита (чат, разбор хода, анализ),
//       'game'     — служебные вызовы режима персонажей (у них отдельный потолок).
// При ошибке у исключения есть поле code: AUTH_REQUIRED, DAILY_LIMIT_REACHED,
// GAME_LIMIT_REACHED, PROVIDER_ERROR и т.п. (см. supabase/functions/chat-proxy).
async function provodChat(messages, { temperature = 0.6, kind = 'question' } = {}) {
  const { data, error } = await sb.functions.invoke('chat-proxy', {
    body: { model: PROVODAI_MODEL, messages, temperature, kind },
  });
  if (error) {
    let code = null;
    try { code = (await error.context?.json())?.error ?? null; } catch (e) { /* тело ответа не JSON */ }
    const err = new Error(`Provod.ai ошибка: ${code || error.message}`);
    err.code = code;
    throw err;
  }
  if (data?.quota) renderChatQuota(data.quota);
  return data?.choices?.[0]?.message?.content ?? '';
}

/* ---- Дневной лимит вопросов (этап 0: бесплатно, но только после входа) ---- */
let chatSignedIn = false;
let lastChatQuota = null; // последний ответ get_chat_quota — его же показывает профиль

function renderChatQuota(quota) {
  lastChatQuota = chatSignedIn ? quota : null;
  renderProfileQuota();
  const el = $id('chatQuota');
  if (!el) return;
  if (!chatSignedIn) {
    el.innerHTML = 'Войдите, чтобы задавать вопросы нейросети: 15 вопросов в день бесплатно. ' +
      '<button type="button" class="chat-quota-login">Войти</button>';
    el.classList.remove('is-empty');
    return;
  }
  if (!quota) { el.textContent = ''; return; }
  const left = Math.max(0, quota.daily_limit - quota.daily_used);
  const extra = Math.floor(Number(quota.bonus_left) || 0);
  let text = `Осталось ${left} из ${quota.daily_limit} вопросов на сегодня`;
  if (extra > 0) text += ` · ещё ${extra} в запасе`;
  el.textContent = text + ' ';
  const buy = document.createElement('button');
  buy.type = 'button';
  buy.className = 'chat-quota-buy';
  buy.textContent = 'Купить вопросы';
  el.appendChild(buy);
  el.classList.toggle('is-empty', left === 0 && extra === 0);
}

// Блок «Вопросы к нейросети» в профиле. Гостю не показываем — у него
// в профиле и так кнопка «Войти».
function renderProfileQuota() {
  const box = $id('profileQuota');
  if (!box) return;
  const quota = lastChatQuota;
  box.classList.toggle('hidden', !quota);
  if (!quota) return;
  const left = Math.max(0, quota.daily_limit - quota.daily_used);
  const extra = Math.floor(Number(quota.bonus_left) || 0);
  $id('profileQuotaDaily').textContent = `${left} из ${quota.daily_limit}`;
  $id('profileQuotaBar').style.width = `${quota.daily_limit ? (left / quota.daily_limit) * 100 : 0}%`;
  $id('profileQuotaExtra').textContent = extra;
  box.classList.toggle('is-empty', left === 0 && extra === 0);
}

// ?. — на случай закэшированного старого index.html без этой кнопки:
// иначе ошибка остановила бы файл и сломала покупку ниже.
$id('profileBuyBtn')?.addEventListener('click', () => { playSound('ui'); openBuyModal(); });

/* ---- Покупка пакетов вопросов (supabase/functions/payments) ---- */
// Пакеты и цены приходят с сервера (loadPacks из js/packs.js), здесь их нет.
let buyPacks = [];
let buyPack = null;

function renderBuyPacks() {
  const box = $id('buyPacks');
  box.textContent = '';
  for (const pack of buyPacks) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'buy-pack';
    btn.dataset.pack = pack.id;
    btn.setAttribute('role', 'radio');
    const name = document.createElement('span');
    name.className = 'buy-pack-name';
    name.textContent = packQuestionsLabel(pack);
    const price = document.createElement('span');
    price.className = 'buy-pack-price';
    price.textContent = formatRub(pack.price);
    btn.append(name, price);
    const saving = packSavingNote(pack, buyPacks);
    if (saving) {
      const note = document.createElement('span');
      note.className = 'buy-pack-note';
      note.textContent = saving;
      btn.append(note);
    }
    box.append(btn);
  }
}

function selectBuyPack(packId) {
  const pack = buyPacks.find(p => p.id === packId) || buyPacks[0];
  if (!pack) return;
  buyPack = pack.id;
  document.querySelectorAll('#buyPacks .buy-pack').forEach(btn => {
    const active = btn.dataset.pack === pack.id;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-checked', String(active));
  });
  $id('buyPayBtn').textContent = `Оплатить ${formatRub(pack.price)}`;
}

// Покупка только после входа: вопросы зачисляются на аккаунт.
async function openBuyModal(packId = buyPack) {
  if (!chatSignedIn) {
    try { sessionStorage.setItem('chessPendingBuy', packId || ''); } catch (e) { /* без хранилища просто не откроем после входа */ }
    showToast('Войдите, чтобы купить вопросы: они зачисляются на аккаунт');
    openAuthModal();
    return;
  }
  const payBtn = $id('buyPayBtn');
  const errorEl = $id('buyError');
  errorEl.classList.add('hidden');
  showModal('buyModal');
  if (!buyPacks.length) {
    payBtn.disabled = true;
    payBtn.textContent = 'Оплатить';
    try {
      buyPacks = await loadPacks();
      renderBuyPacks();
    } catch (e) {
      $id('buyPacks').innerHTML = '';
      errorEl.textContent = 'Не удалось загрузить цены. Проверьте интернет и откройте окно ещё раз.';
      errorEl.classList.remove('hidden');
      return;
    }
  }
  payBtn.disabled = false;
  selectBuyPack(packId);
}

async function startPayment() {
  const btn = $id('buyPayBtn');
  const errorEl = $id('buyError');
  btn.disabled = true;
  btn.textContent = 'Переходим к оплате…';
  errorEl.classList.add('hidden');
  const { data, error } = await sb.functions.invoke('payments/create', { body: { pack_id: buyPack } });
  if (!error && data?.confirmation_url) {
    window.location.href = data.confirmation_url;
    return;
  }
  let code = null;
  try { code = (await error?.context?.json())?.error ?? null; } catch (e) { /* тело ответа не JSON */ }
  errorEl.textContent = code === 'PAYMENTS_NOT_CONFIGURED'
    ? 'Оплата подключается и скоро заработает. Пока можно пользоваться бесплатными вопросами.'
    : code === 'AUTH_REQUIRED'
      ? 'Сессия истекла — войдите заново.'
      : 'Не удалось перейти к оплате. Попробуйте ещё раз через минуту.';
  errorEl.classList.remove('hidden');
  btn.disabled = false;
  selectBuyPack(buyPack);
}

$id('buyPacks').addEventListener('click', (e) => {
  const btn = e.target.closest('.buy-pack');
  if (btn) { playSound('ui'); selectBuyPack(btn.dataset.pack); }
});
$id('buyPayBtn').addEventListener('click', () => { playSound('ui'); startPayment(); });
$id('buyCancelBtn').addEventListener('click', () => hideModal('buyModal'));
document.addEventListener('click', (e) => {
  if (e.target.closest('.chat-quota-buy')) openBuyModal();
});

// Ссылки «Купить» со страницы тарифов (?buy=q100) и возврат с оплаты (?paid=1).
function handlePaymentParams() {
  const params = new URLSearchParams(location.search);
  const buy = params.get('buy');
  const paid = params.get('paid');
  if (!buy && !paid) return;
  history.replaceState(null, '', location.pathname);
  if (paid) {
    showToast('Спасибо за оплату! Вопросы начислятся в течение минуты');
    setTimeout(refreshChatQuota, 5000);
  }
  if (buy) openBuyModal(buy);
}

// Гость нажал «Купить» → вошёл → открываем покупку того же пакета.
function resumePendingBuy() {
  if (!chatSignedIn) return;
  let pending = null;
  try { pending = sessionStorage.getItem('chessPendingBuy'); sessionStorage.removeItem('chessPendingBuy'); } catch (e) { /* нет хранилища */ }
  if (pending !== null) openBuyModal(pending); // '' — пакет не выбирали, откроется первый
}

async function refreshChatQuota() {
  const { data: { session } } = await sb.auth.getSession();
  chatSignedIn = !!session;
  if (!chatSignedIn) { renderChatQuota(null); return; }
  const { data, error } = await sb.rpc('get_chat_quota');
  renderChatQuota(error ? null : data?.[0]);
}
window.refreshChatQuota = refreshChatQuota;

document.addEventListener('click', (e) => {
  if (e.target.closest('.chat-quota-login')) openAuthModal();
});

// Текст для игрока по коду ошибки chat-proxy.
function chatErrorMessage(error) {
  switch (error?.code) {
    case 'AUTH_REQUIRED':
      return 'Чтобы спросить нейросеть, войдите в аккаунт. Это бесплатно: 15 вопросов в день.';
    case 'DAILY_LIMIT_REACHED':
      return 'Вопросы на сегодня закончились. Новые 15 появятся в полночь по Москве. Можно купить пакет вопросов — кнопка «Купить вопросы» под чатом, а бонусные вопросы даются за достижения.';
    case 'GAME_LIMIT_REACHED':
      return 'Персонажи на сегодня устали: дневной лимит игровых запросов исчерпан. Попробуйте завтра.';
    case 'REQUEST_TOO_LONG':
      return 'Слишком длинный запрос. Начните новую партию или задайте вопрос короче.';
    default:
      return 'Нейросеть сейчас не отвечает. Попробуйте ещё раз через минуту.';
  }
}
