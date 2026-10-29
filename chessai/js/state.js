// Подключение к Supabase, настройки Provod.ai и общее состояние приложения (state). Грузится первым.
'use strict';

/* =========================================================================
   SUPABASE — замените на свои значения из Project Settings → API
   ========================================================================= */
const SUPABASE_URL = 'https://lmkomispucbysxidkcno.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxta29taXNwdWNieXN4aWRrY25vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MDE3MzEsImV4cCI6MjEwMjQ3NzczMX0.0VMFP0MdbZNyL-o9YCPot1zqbhF5hsMlUaMjmkak1PQ';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Единая версия приложения — используется в "О приложении" и в отправке обратной связи.
const APP_VERSION = '1.0.0';

/* =========================================================================
   НАСТРОЙКИ PROVOD.AI — ключ теперь только в secrets Edge Function
   (supabase/functions/chat-proxy), в браузере его больше нет
   ========================================================================= */
const PROVODAI_MODEL = 'deepseek/deepseek-v4-pro';
let temp = localStorage.getItem('chessTemperature');
if (temp !== null) {
  const val = parseFloat(temp);
  if (Number.isInteger(val) && val >= 1 && val <= 10) {
    // уже в новом формате
    temp = val;
  } else if (!isNaN(val) && val >= 0 && val <= 1) {
    // старое значение 0..1 → преобразуем в 1..10
    temp = Math.round(val * 10);
    localStorage.setItem('chessTemperature', String(temp));
  } else {
    temp = 6; // по умолчанию
  }
} else {
  temp = 6;
}
/* =========================================================================
   СОСТОЯНИЕ ПРИЛОЖЕНИЯ
   ========================================================================= */
const state = {
  mode: null,
  playerColor: 'w',
  aiColor: 'b',
  game: null,
  board: null,
  isThinking: false,
  isAsking: false,
  isGameOver: false,
  chatDisplay: [],
  chatApiHistory: [],
  capturedByWhite: [],
  capturedByBlack: [],
  skillLevel: 20,
  fenHistory: [],
  settings: {
    accent: localStorage.getItem('chessAccent') || 'gold',
    boardStyle: localStorage.getItem('chessBoardStyle') || 'classic',
    timeControl: parseInt(localStorage.getItem('chessTimeControl') || '10', 10),
    soundMoves: localStorage.getItem('chess_soundMoves') !== '0',
    soundCaptures: localStorage.getItem('chess_soundCaptures') !== '0',
    soundCheck: localStorage.getItem('chess_soundCheck') !== '0',
    soundMate: localStorage.getItem('chess_soundMate') !== '0',
    soundUi: localStorage.getItem('chess_soundUi') !== '0',
    volume: parseInt(localStorage.getItem('chessVolume') || '80', 10),
    responseLength: localStorage.getItem('chessResponseLength') || 'medium',
    autoHint: localStorage.getItem('chessAutoHint') === '1',
    autoHintDelay: parseInt(localStorage.getItem('chessAutoHintDelay') || '20', 10),
    language: localStorage.getItem('chessLanguage') || 'ru',
    perfHardware: localStorage.getItem('chess_perfHardware') !== '0',
    perfHighFps: localStorage.getItem('chess_perfHighFps') !== '0',
    perfSmoothAnim: localStorage.getItem('chess_perfSmoothAnim') !== '0',
    perfGlow: localStorage.getItem('chessGlow') !== '0',
    homeEnemies: localStorage.getItem('chess_homeEnemies') !== '0',
    // Фон главного экрана: 'knights' — рой коней, 'snow' — фигурный снегопад
    homeBackground: localStorage.getItem('chess_homeBackground') === 'snow' ? 'snow' : 'knights',
    timeLimited: localStorage.getItem('chessTimeLimited') !== '0',
    // Режим анализа: 'standard' — Infinite Analysis (максимальная глубина в фоне),
    // 'weak' — короткий анализ фиксированной глубины после каждого хода (для слабых ПК)
    analysisMode: localStorage.getItem('chess_analysisMode') === 'weak' ? 'weak' : 'standard',
  },
};
state.lastAutoReplyTime = 0;
state.lastAutoReplies = [];
state.settings.temperature = temp;
state.timeLimited = localStorage.getItem('chessTimeLimited') !== '0';
state.timeWhite = 600;  // секунд
state.timeBlack = 600;
state.timerInterval = null;
state.timerRunning = false;
state.timerPaused = false;
let autoHintTimer = null;
let homeAnimationInterval = null;
const WHITE_GLYPH = { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' };
const BLACK_GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
let homePageVisible = !document.hidden;
