// Режим «Против персонажей»: создание персонажа и его карточка.
'use strict';

/* =========================================================================
   РЕЖИМ «ПРОТИВ ПЕРСОНАЖЕЙ» — состояние
   ========================================================================= */
const charState = {
  activeTab: 'name',
  lastInput: null, // { type: 'name'|'desc', value: string }
};

function openCharacterSetup() {
  // Персонажей ведёт нейросеть, а она доступна только после входа.
  if (!chatSignedIn) {
    showToast('Войдите, чтобы играть против персонажей: ими управляет нейросеть');
    openAuthModal();
    return;
  }
  hideModal('characterCardModal');
  $id('charSetupError').classList.add('hidden');
  showModal('characterSetupModal');

  // Заполняем примеры из статистики
  const examplesContainer = document.getElementById('charExamples');
  if (!examplesContainer) return;
  const stats = window.Achievements?.getStats?.();
  const played = stats?.charactersPlayed || [];
  const recent = Array.from(new Set(played)).slice(-4).reverse();
  if (recent.length === 0) {
    examplesContainer.innerHTML = '';
    examplesContainer.style.display = 'none';
  } else {
    examplesContainer.style.display = 'flex';
    examplesContainer.innerHTML = recent.map(name =>
      `<button type="button" class="char-example-chip" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`
    ).join('');
    // Перепривязываем обработчики кликов (если нужны)
    examplesContainer.querySelectorAll('.char-example-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.getElementById('charNameInput').value = chip.dataset.name;
      });
    });
  }
}

/* ---- Вкладки: имя / описание ---- */
document.querySelectorAll('.char-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    charState.activeTab = target;
    document.querySelectorAll('.char-tab').forEach(t => {
      const active = t === tab;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', String(active));
    });
    $id('charNameTab').classList.toggle('hidden', target !== 'name');
    $id('charDescTab').classList.toggle('hidden', target !== 'desc');
  });
});

document.querySelectorAll('.char-example-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    $id('charNameInput').value = chip.dataset.name;
  });
});

$id('charSetupBackBtn').addEventListener('click', () => {
  hideModal('characterSetupModal');
  showHomeScreen();
});

$id('charCreateBtn').addEventListener('click', () => {
  playSound('ui');
  const errEl = $id('charSetupError');
  errEl.classList.add('hidden');
  let input;
  if (charState.activeTab === 'name') {
    const value = $id('charNameInput').value.trim();
    if (!value) {
      errEl.textContent = 'Введите имя персонажа.';
      errEl.classList.remove('hidden');
      playSound('error');
      return;
    }
    input = { type: 'name', value };
  } else {
    const value = $id('charDescInput').value.trim();
    if (!value) {
      errEl.textContent = 'Опишите вашего персонажа.';
      errEl.classList.remove('hidden');
      playSound('error');
      return;
    }
    input = { type: 'desc', value };
  }
  charState.lastInput = input;
  hideModal('characterSetupModal');
  runCharacterGeneration(input);
});

/* ---- Карточка персонажа ---- */
$id('charCardBackBtn').addEventListener('click', () => {
  hideModal('characterCardModal');
  openCharacterSetup();
});
$id('charCardRegenBtn').addEventListener('click', () => {
  if (!charState.lastInput) return;
  runCharacterGeneration(charState.lastInput);
});
$id('charCardPlayBtn').addEventListener('click', () => {
  if (!state.character) return;
  hideModal('characterCardModal');
  state.mode = 'characters';
  state.playerColor = 'w';
  state.aiColor = 'b';
  state.skillLevel = eloToSkillLevel(state.character.elo);
  if (stockfish && isEngineReady) {
    stockfish.postMessage(`setoption name Skill Level value ${state.skillLevel}`);
  }
  hideHomeScreen();
  initGame();
});

function setCharCardLoading(isLoading) {
  $id('characterCardLoading').classList.toggle('hidden', !isLoading);
  $id('characterCardBody').classList.toggle('hidden', isLoading);
  $id('charCardPlayBtn').disabled = isLoading;
  $id('charCardRegenBtn').disabled = isLoading;
}

async function runCharacterGeneration(input) {
  showModal('characterCardModal');
  $id('charCardError').classList.add('hidden');
  setCharCardLoading(true);
  try {
    const profile = await generateCharacterProfile(input);
    state.character = profile;
    renderCharacterCard(profile);
    setCharCardLoading(false);
  } catch (error) {
    console.error('Ошибка генерации персонажа:', error);
    setCharCardLoading(false);
    $id('characterCardBody').classList.add('hidden');
    const errEl = $id('charCardError');
    errEl.textContent = 'Не удалось создать персонажа: ' + error.message + '. Нажмите «Перегенерировать», чтобы попробовать снова.';
    errEl.classList.remove('hidden');
    playSound('error');
  }
}

/* ---- Генерация профиля персонажа ---- */
function buildCharacterGenSystemPrompt() {
  return `Ты создаёшь игровой профиль шахматного персонажа для приложения. Не преувеличивай умения. 
  Отвечай ТОЛЬКО валидным JSON-объектом без markdown-разметки, без пояснений, без \`\`\`.
  {
  "name": "имя персонажа",
  "shortDescription": "одно короткое предложение о персонаже",
  "style": "1-2 предложения о стиле игры в шахматы",
  "openings": "предпочитаемые дебюты, коротко",
  "aggression": число 0-100,
  "combination": число 0-100,
  "sacrifice": число 0-100,
  "caution": число 0-100,
  "emotionality": число 0-100,
  "endgame": число 0-100,
  "drawishness": число 0-100,
  "elo": число примерно от 400 до 2800,
  "tone": "манера общения персонажа, коротко",
  }
  Все текстовые поля — на русском языке. Придумай образ ярко и с характером. 
  Если дано известное имя, опирайся на известные о нём черты и адаптируй их под шахматный стиль и манеру речи.
  Если дано произвольное описание — придумай персонажа с нуля строго по этому описанию, включая подходящее имя.
  Числовые черты должны логично соответствовать описанию.`;
}

function extractJson(text) {
  const cleaned = String(text ?? '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return cleaned;
  return cleaned.slice(start, end + 1);
}

function normalizeCharacterProfile(p, input) {
  const clampNum = (v, min, max, def) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? clamp(n, min, max) : def;
  };
  const fallbackName = input.type === 'name' ? input.value : 'Загадочный соперник';
  const name = String(p.name || fallbackName).trim().slice(0, 40) || fallbackName;
  return {
    name,
    shortDescription: String(p.shortDescription || '').trim().slice(0, 180) || 'Загадочный противник со своим стилем игры.',
    style: String(p.style || '').trim().slice(0, 320) || 'Играет непредсказуемо, полагаясь на интуицию.',
    openings: String(p.openings || '').trim().slice(0, 160) || 'Разные дебюты.',
    aggression: clampNum(p.aggression, 0, 100, 50),
    combination: clampNum(p.combination, 0, 100, 50),
    sacrifice: clampNum(p.sacrifice, 0, 100, 30),
    caution: clampNum(p.caution, 0, 100, 50),
    emotionality: clampNum(p.emotionality, 0, 100, 50),
    endgame: clampNum(p.endgame, 0, 100, 50),
    drawishness: clampNum(p.drawishness, 0, 100, 30),
    elo: clampNum(p.elo, 500, 2900, 1400),
    tone: String(p.tone || '').trim().slice(0, 160) || 'Сдержанная, немногословная.',
  };
}

async function generateCharacterProfile(input) {
  const userMsg = input.type === 'name'
    ? `Имя персонажа: ${input.value}`
    : `Описание персонажа от пользователя: ${input.value}`;
  const messages = [
    { role: 'system', content: buildCharacterGenSystemPrompt() },
    { role: 'user', content: userMsg },
  ];
  const raw = await provodChat(messages, { temperature: 0.95, kind: 'game' });
  let profile;
  try {
    profile = JSON.parse(extractJson(raw));
  } catch (e) {
    throw new Error('не удалось разобрать ответ нейросети');
  }
  return normalizeCharacterProfile(profile, input);
}

function eloToSkillLevel(elo) {
  const level = Math.round(((clamp(elo, 500, 2900) - 500) / 2400) * 19) + 1;
  return clamp(level, 1, 20);
}

/* ---- Отрисовка карточки персонажа ---- */
function traitLevelLabel(value) {
  const v = clamp(value, 0, 100);
  if (v < 20) return 'очень низкая';
  if (v < 40) return 'низкая';
  if (v < 60) return 'средняя';
  if (v < 80) return 'высокая';
  return 'очень высокая';
}

function eloDifficultyLabel(elo) {
  const e = clamp(elo, 500, 2900);
  if (e < 900) return 'новичок';
  if (e < 1200) return 'любитель';
  if (e < 1600) return 'уверенный игрок';
  if (e < 2000) return 'кандидат в мастера';
  if (e < 2400) return 'мастер';
  return 'гроссмейстер';
}

function charBarRow(label, value) {
  const pct = clamp(value, 0, 100);
  const hue = pct * 1.2;
  const color = `hsl(${hue}, 80%, 50%)`;
  return `<div class="char-bar-row">
    <span class="char-bar-label">${escapeHtml(label)}</span>
    <span class="char-bar-track" title="${pct}/100">
      <span class="char-bar-fill" style="width:${pct}%; height:100%; background:${color}; display:block;"></span>
    </span>
    <span class="char-bar-value">${traitLevelLabel(pct)}</span>
  </div>`;
}

function renderCharacterCard(profile) {
  $id('charCardName').textContent = profile.name;
  $id('charCardDesc').textContent = profile.shortDescription;
  const eloLabel = eloDifficultyLabel(profile.elo);
  $id('charCardElo').textContent = `${eloLabel.charAt(0).toUpperCase()}${eloLabel.slice(1)}\n≈${profile.elo} Elo`;
  $id('charCardBars').innerHTML = [
    charBarRow('Агрессия', profile.aggression),
    charBarRow('Тактика', profile.combination),
    charBarRow('Жертвы', profile.sacrifice),
    charBarRow('Осторожность', profile.caution),
    charBarRow('Эндшпиль', profile.endgame),
  ].join('');
  $id('charCardStyle').textContent = profile.style;
  $id('charCardTone').textContent = profile.openings ? `Дебюты: ${profile.openings}` : '';
}
