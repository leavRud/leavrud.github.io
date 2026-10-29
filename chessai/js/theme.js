// Тёмная/светлая тема и SVG-фигуры доски.
'use strict';

/* =========================================================================
   ТЁМНАЯ ТЕМА
   ========================================================================= */
// Сменились тема или акцентный цвет — то, что рисуется на canvas (снегопад),
// само CSS-переменные не подхватит и перечитывает цвета по этому событию.
const PALETTE_CHANGED_EVENT = 'chessai:palette-changed';

function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem('chessTheme', theme);
  document.dispatchEvent(new Event(PALETTE_CHANGED_EVENT));
  const icon = $id('settingsThemeIcon');
  const label = $id('settingsThemeLabel');
  if (icon) icon.textContent = theme === 'dark' ? '🌙' : '☀️';
  if (label) {
    const i18nKey = 'settings.appearance.' + (theme === 'dark' ? 'dark' : 'light');
    label.textContent = window.t ? window.t(i18nKey) : (theme === 'dark' ? 'Тёмная' : 'Светлая');
  }
}
(function initTheme() {
  const saved = localStorage.getItem('chessTheme') || 'dark';
  applyTheme(saved);
})();
function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  applyTheme(isDark ? 'light' : 'dark');
}

/* =========================================================================
   ФИГУРЫ ДОСКИ (SVG)
   ========================================================================= */
const PIECE_GLYPH = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟',
};
function buildPieceSvg(piece) {
  const isWhite = piece[0] === 'w';
  const glyph = PIECE_GLYPH[piece];
  // Чёрные фигуры почти чёрные с яркой обводкой — иначе на тёмных клетках
  // их видно только по контуру.
  const fill = isWhite ? '#F6F1E6' : '#141210';
  const stroke = isWhite ? '#7B3B3E' : '#E0B85C';
  const strokeWidth = isWhite ? 2.2 : 3;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<text x="50" y="78" font-size="80" text-anchor="middle" ` +
    `font-family="'Segoe UI Symbol','Noto Sans Symbols 2',sans-serif" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" paint-order="stroke">${glyph}</text>` +
    `</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}
const PIECE_THEME_CACHE = {};
function pieceThemeFn(piece) {
  if (!PIECE_THEME_CACHE[piece]) PIECE_THEME_CACHE[piece] = buildPieceSvg(piece);
  return PIECE_THEME_CACHE[piece];
}
