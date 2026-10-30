// Пакеты вопросов и цены. Источник один — серверная функция payments (GET /packs),
// здесь только загрузка и подписи. Подключают index.html и tarify.html.
'use strict';

const PACKS_URL = 'https://lmkomispucbysxidkcno.supabase.co/functions/v1/payments/packs';
let packsPromise = null;

// Список пакетов [{ id, questions, price, title }] в порядке показа. Запрос один
// на загрузку страницы; после ошибки следующий вызов попробует снова.
function loadPacks() {
  if (!packsPromise) {
    packsPromise = fetch(PACKS_URL)
      .then((r) => { if (!r.ok) throw new Error(`packs: HTTP ${r.status}`); return r.json(); })
      .then((data) => {
        if (!Array.isArray(data?.packs) || !data.packs.length) throw new Error('packs: пустой список');
        return data.packs;
      })
      .catch((e) => { packsPromise = null; throw e; });
  }
  return packsPromise;
}

function formatRub(price) {
  return `${Number(price).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
}

// «100 вопросов», «21 вопрос», «3 вопроса»
function packQuestionsLabel(pack) {
  const n = pack.questions;
  const mod10 = n % 10, mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'вопрос'
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'вопроса' : 'вопросов';
  return `${n} ${word}`;
}

// «выгоднее в 1,2 раза» — по цене вопроса относительно самого дорогого пакета.
// null, если выгода меньше 10%.
function packSavingNote(pack, packs) {
  const worst = Math.max(...packs.map((p) => p.price / p.questions));
  const ratio = worst / (pack.price / pack.questions);
  if (ratio < 1.1) return null;
  return `выгоднее в ${ratio.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} раза`;
}
