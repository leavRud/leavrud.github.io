// Мелкие утилиты: $id, модалки, clamp, экранирование, тосты.
'use strict';

/* =========================================================================
   УТИЛИТЫ
   ========================================================================= */
function $id(id) { return document.getElementById(id); }
function showModal(id) { $id(id).classList.remove('hidden'); }
function hideModal(id) { $id(id).classList.add('hidden'); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function stripMarkdown(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, m => m.replace(/```/g, '').trim())
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .trim();
}
function isHomeCellOccupied(row, col) {
  if (!figureState) return false;
  for (const enemy of figureState.enemies) {
    if (enemy.row === row && enemy.col === col) return true;
  }
  return false;
}
function showConnectionBanner(text) {
  $id('connectionBannerText').textContent = text;
  $id('connectionBanner').classList.remove('hidden');
  playSound('error');
}
function hideConnectionBanner() {
  $id('connectionBanner').classList.add('hidden');
}
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 3000);
}
function onHomeVisibilityChange() {
  homePageVisible = !document.hidden;

  if (!figureState) return;

  if (homePageVisible) {
    if (state.settings.homeEnemies) startEnemySpawner();
  } else {
    stopEnemySpawner();
  }
}
