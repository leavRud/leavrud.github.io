// Экран загрузки: прячется, когда готовы шрифты, страница и движок.
'use strict';

/* =========================================================================
   ЭКРАН ЗАГРУЗКИ
   Скрывается только когда реально готовы: шрифты, полная загрузка окна
   (скрипты/картинки/стили) и движок Stockfish (получен readyok). Есть
   аварийный тайм-аут, чтобы не держать пользователя вечно, если Stockfish
   не смог инициализироваться (например, воркеры не поддерживаются).
   ========================================================================= */
const loadingReadyFlags = { fonts: false, engine: false, windowLoad: false };
let loadingScreenHidden = false;

function markLoadingReady(flag) {
  loadingReadyFlags[flag] = true;
  maybeHideLoadingScreen();
}

function maybeHideLoadingScreen() {
  if (loadingScreenHidden) return;
  if (loadingReadyFlags.fonts && loadingReadyFlags.engine && loadingReadyFlags.windowLoad) {
    hideLoadingScreen();
  }
}

function hideLoadingScreen() {
  if (loadingScreenHidden) return;
  loadingScreenHidden = true;
  const el = $id('loadingScreen');
  if (!el) return;
  el.classList.add('is-hidden');
  setTimeout(() => { el.style.display = 'none'; }, 500);
}

(function initLoadingScreenWatchers() {
  // Шрифты
  const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
  fontsReady.then(() => markLoadingReady('fonts')).catch(() => markLoadingReady('fonts'));

  // Полная загрузка окна (картинки, стили, все <script>)
  if (document.readyState === 'complete') {
    markLoadingReady('windowLoad');
  } else {
    window.addEventListener('load', () => markLoadingReady('windowLoad'), { once: true });
  }

  // Аварийный предохранитель — не дольше 8 секунд ожидания движка
  setTimeout(() => markLoadingReady('engine'), 8000);
})();
