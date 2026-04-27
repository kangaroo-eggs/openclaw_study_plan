const state = {
  data: null,
  currentDate: null,
  primaryTab: 'plan',
  planTab: 'new',
  fontScale: Number(localStorage.getItem('studyFontScale') || '1'),
  db: null,
  progress: new Map(),
  sqlReady: false,
};

const DB_KEY = 'studyPlanSqliteDbV1';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function highlightReviewWords(text, words) {
  let html = escapeHtml(text);
  for (const word of words || []) {
    const safe = escapeHtml(word);
    const re = new RegExp(`\\b(${safe.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')})\\b`, 'gi');
    html = html.replace(re, '<mark>$1</mark>');
  }
  return html;
}

function formatDate(date) {
  try {
    return new Intl.DateTimeFormat('zh-TW', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(date + 'T00:00:00'));
  } catch {
    return date;
  }
}

function wordKey(item) {
  return String(item?.word || '').trim().toLowerCase();
}

function allDays() {
  return state.data.weeks.flatMap(w => w.days);
}

function findDay(date) {
  return allDays().find(d => d.date === date) || allDays()[0];
}

function setFontScale(scale) {
  state.fontScale = Math.min(1.35, Math.max(0.85, scale));
  document.documentElement.style.setProperty('--font-scale', state.fontScale);
  localStorage.setItem('studyFontScale', String(state.fontScale));
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function initProgressDb() {
  try {
    if (typeof initSqlJs !== 'function') throw new Error('sql.js is not loaded');
    const SQL = await initSqlJs({ locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/${file}` });
    const saved = localStorage.getItem(DB_KEY);
    state.db = saved ? new SQL.Database(base64ToBytes(saved)) : new SQL.Database();
    state.db.run(`
      CREATE TABLE IF NOT EXISTS word_progress (
        word TEXT PRIMARY KEY,
        learned INTEGER NOT NULL DEFAULT 0,
        unfamiliar INTEGER NOT NULL DEFAULT 0,
        learned_at TEXT,
        unfamiliar_at TEXT,
        updated_at TEXT NOT NULL
      );
    `);
    state.sqlReady = true;
    loadProgressFromDb();
    saveProgressDb();
  } catch (error) {
    console.warn('SQLite progress unavailable; falling back to localStorage JSON.', error);
    state.sqlReady = false;
    const fallback = JSON.parse(localStorage.getItem('studyProgressFallbackV1') || '{}');
    state.progress = new Map(Object.entries(fallback));
  }
}

function loadProgressFromDb() {
  state.progress.clear();
  if (!state.db) return;
  const rows = state.db.exec('SELECT word, learned, unfamiliar, learned_at, unfamiliar_at, updated_at FROM word_progress');
  if (!rows.length) return;
  for (const row of rows[0].values) {
    const [word, learned, unfamiliar, learnedAt, unfamiliarAt, updatedAt] = row;
    state.progress.set(word, {
      learned: Boolean(learned),
      unfamiliar: Boolean(unfamiliar),
      learnedAt,
      unfamiliarAt,
      updatedAt,
    });
  }
}

function saveProgressDb() {
  if (state.db) {
    localStorage.setItem(DB_KEY, bytesToBase64(state.db.export()));
  } else {
    localStorage.setItem('studyProgressFallbackV1', JSON.stringify(Object.fromEntries(state.progress)));
  }
}

function getProgress(word) {
  return state.progress.get(String(word || '').toLowerCase()) || { learned: false, unfamiliar: false };
}

function setProgress(word, patch) {
  const key = String(word || '').toLowerCase();
  const now = new Date().toISOString();
  const current = getProgress(key);
  const next = {
    ...current,
    ...patch,
    learnedAt: patch.learned === true ? now : (patch.learned === false ? null : current.learnedAt),
    unfamiliarAt: patch.unfamiliar === true ? now : (patch.unfamiliar === false ? null : current.unfamiliarAt),
    updatedAt: now,
  };
  state.progress.set(key, next);

  if (state.db) {
    state.db.run(
      `INSERT INTO word_progress (word, learned, unfamiliar, learned_at, unfamiliar_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(word) DO UPDATE SET
         learned = excluded.learned,
         unfamiliar = excluded.unfamiliar,
         learned_at = excluded.learned_at,
         unfamiliar_at = excluded.unfamiliar_at,
         updated_at = excluded.updated_at`,
      [key, next.learned ? 1 : 0, next.unfamiliar ? 1 : 0, next.learnedAt, next.unfamiliarAt, next.updatedAt]
    );
  }
  saveProgressDb();
}

function progressStats() {
  let learned = 0;
  let unfamiliar = 0;
  for (const value of state.progress.values()) {
    if (value.learned) learned += 1;
    if (value.unfamiliar) unfamiliar += 1;
  }
  return { learned, unfamiliar };
}

function renderNav() {
  const nav = $('#weekNav');
  nav.innerHTML = state.data.weeks.map(week => `
    <div class="week-block">
      <div class="week-title">Week ${week.week} · ${week.startDate} → ${week.endDate}</div>
      ${week.days.map(day => `
        <button class="day-link ${day.date === state.currentDate ? 'active' : ''}" data-date="${day.date}" type="button">
          <span>${formatDate(day.date)}</span>
          <small>${day.newWords.length}+${day.reviewWords.length}</small>
        </button>
      `).join('')}
    </div>
  `).join('');

  $$('.day-link').forEach(btn => btn.addEventListener('click', () => showDay(btn.dataset.date)));
}

function renderStats(day) {
  const ps = progressStats();
  $('#stats').innerHTML = `
    <div class="stat-card"><strong>${day.newWords.length}</strong><span>今日新單字</span></div>
    <div class="stat-card"><strong>${state.data.stats.sourceVocabulary || state.data.stats.newWordEntries}</strong><span>所有單字</span></div>
    <div class="stat-card"><strong>${ps.learned}</strong><span>已學會</span></div>
    <div class="stat-card"><strong>${ps.unfamiliar}</strong><span>不熟單字</span></div>
  `;
}

function wordCard(item) {
  if (item.parse_error) {
    return `<article class="word-card"><p class="empty">解析失敗：${escapeHtml(item.raw)}</p></article>`;
  }
  const key = wordKey(item);
  const progress = getProgress(key);
  const classes = ['word-card'];
  if (progress.learned) classes.push('is-learned');
  if (progress.unfamiliar) classes.push('is-unfamiliar');
  const hasDetails = Boolean(item.chinese || item.japanese || item.englishExample || item.japaneseExample);
  const meta = [item.pos, item.level, item.firstDate ? `學習日 ${item.firstDate}` : '', item.scheduled === false ? '尚未排入計劃' : ''].filter(Boolean).join(' · ');
  return `
    <article class="${classes.join(' ')}" id="word-${escapeHtml(key)}" data-word="${escapeHtml(key)}">
      <div class="word-head">
        <span class="word-number">${item.number}</span>
        <div>
          <h4 class="word">${escapeHtml(item.word)}</h4>
          <p class="pos">${escapeHtml(meta)}</p>
        </div>
      </div>
      <div class="progress-actions" aria-label="單字熟悉度">
        <button class="progress-btn learned-btn ${progress.learned ? 'active' : ''}" data-action="learned" data-word="${escapeHtml(key)}" type="button">${progress.learned ? '已學會 ✓' : '標記已學會'}</button>
        <button class="progress-btn unfamiliar-btn ${progress.unfamiliar ? 'active' : ''}" data-action="unfamiliar" data-word="${escapeHtml(key)}" type="button">${progress.unfamiliar ? '不熟 ★' : '標記不熟'}</button>
      </div>
      ${hasDetails ? `
        <div class="meaning-row">
          <div><span class="label">中文</span><p class="chinese">${escapeHtml(item.chinese || '—')}</p></div>
          <div><span class="label">日本語</span><p class="japanese">${escapeHtml(item.japanese || '—')}</p></div>
        </div>
        <div class="examples">
          <p class="english-example">${escapeHtml(item.englishExample || '')}</p>
          <p class="japanese-example">${escapeHtml(item.japaneseExample || '')}</p>
        </div>
      ` : `<p class="empty">這個字還沒排進每日計劃，所以暫時沒有翻譯與例句。</p>`}
    </article>
  `;
}

function wordsSection(title, words, emptyText) {
  return `
    <section class="section-card">
      <h3>${title}</h3>
      ${words.length ? `<div class="word-grid">${words.map(wordCard).join('')}</div>` : `<p class="empty">${emptyText}</p>`}
    </section>
  `;
}

function uniqueWordItems() {
  if (state.data.completeVocabulary?.length) return state.data.completeVocabulary;
  const seen = new Set();
  const items = [];
  for (const day of allDays()) {
    for (const item of [...day.newWords, ...day.reviewWords]) {
      if (item.parse_error) continue;
      const key = wordKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  return items;
}

function storySection(day) {
  const story = day.story || {};
  const hasStory = story.english || story.chinese || story.japanese;
  if (!hasStory) {
    return `
      <section class="section-card story-card">
        <h3>複習故事</h3>
        <p class="empty">今天沒有複習故事。</p>
      </section>
    `;
  }
  return `
    <section class="section-card story-card">
      <h3>複習故事</h3>
      <div class="story-used">${(story.used || []).map(w => `<span class="chip">${escapeHtml(w)}</span>`).join('')}</div>
      <div class="story-lang">
        <h4>English</h4>
        <p>${highlightReviewWords(story.english, story.used)}</p>
      </div>
      <div class="story-lang">
        <h4>中文</h4>
        <p>${escapeHtml(story.chinese)}</p>
      </div>
      <div class="story-lang">
        <h4>日本語</h4>
        <p>${escapeHtml(story.japanese)}</p>
      </div>
    </section>
  `;
}

function bindProgressButtons() {
  $$('.progress-btn').forEach(btn => btn.addEventListener('click', () => {
    const word = btn.dataset.word;
    const progress = getProgress(word);
    if (btn.dataset.action === 'learned') {
      setProgress(word, { learned: !progress.learned });
    } else if (btn.dataset.action === 'unfamiliar') {
      setProgress(word, { unfamiliar: !progress.unfamiliar });
    }
    renderStats(findDay(state.currentDate));
    renderDayContent(findDay(state.currentDate));
  }));
}

function renderDayContent(day) {
  const chunks = [];
  $('#planSubTabs').hidden = state.primaryTab !== 'plan';

  if (state.primaryTab === 'plan') {
    if (state.planTab === 'new') chunks.push(wordsSection('今日新單字 30', day.newWords, '今天沒有新單字。'));
    if (state.planTab === 'review') chunks.push(wordsSection('複習單字 10', day.reviewWords, '今天沒有複習單字。'));
    if (state.planTab === 'story') chunks.push(storySection(day));
  }

  if (state.primaryTab === 'vocabulary') {
    const vocabulary = uniqueWordItems();
    chunks.push(wordsSection(`所有單字 ${vocabulary.length}`, vocabulary, '沒有找到 7000words.txt 的單字資料。'));
  }
  if (state.primaryTab === 'learned') {
    const learned = uniqueWordItems().filter(item => getProgress(wordKey(item)).learned);
    chunks.push(wordsSection(`已學會 ${learned.length}`, learned, '還沒有標記為已學會的單字。'));
  }
  if (state.primaryTab === 'unfamiliar') {
    const unfamiliar = uniqueWordItems().filter(item => getProgress(wordKey(item)).unfamiliar);
    chunks.push(wordsSection(`不熟單字 ${unfamiliar.length}`, unfamiliar, '還沒有標記為不熟的單字。'));
  }

  $('#dayContent').innerHTML = chunks.join('');
  bindProgressButtons();
}

function closeMobileNav() {
  document.body.classList.remove('nav-open');
  const toggle = $('#mobileNavToggle');
  const backdrop = $('#mobileBackdrop');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
  if (backdrop) backdrop.hidden = true;
}

function toggleMobileNav() {
  const open = !document.body.classList.contains('nav-open');
  document.body.classList.toggle('nav-open', open);
  const toggle = $('#mobileNavToggle');
  const backdrop = $('#mobileBackdrop');
  if (toggle) toggle.setAttribute('aria-expanded', String(open));
  if (backdrop) backdrop.hidden = !open;
}

function showDay(date) {
  const day = findDay(date);
  state.currentDate = day.date;
  location.hash = day.date;
  $('#eyebrow').textContent = `Week ${day.week} · ${formatDate(day.date)}`;
  $('#dayTitle').textContent = day.title;
  renderStats(day);
  renderNav();
  renderDayContent(day);
  closeMobileNav();
}

function renderSearch(query) {
  const q = query.trim().toLowerCase();
  const panel = $('#searchResults');
  if (!q) {
    panel.hidden = true;
    $('#resultList').innerHTML = '';
    return;
  }
  const results = [];
  for (const item of uniqueWordItems()) {
    if (item.parse_error) continue;
    const haystack = [item.word, item.pos, item.level, item.chinese, item.japanese, item.englishExample, item.japaneseExample].join(' ').toLowerCase();
    if (haystack.includes(q)) {
      const day = item.firstDate ? findDay(item.firstDate) : findDay(state.currentDate);
      results.push({ day, type: item.firstDate ? 'newWords' : 'vocabulary', item });
    }
  }
  panel.hidden = false;
  $('#resultList').innerHTML = results.length ? results.slice(0, 120).map(r => {
    const p = getProgress(wordKey(r.item));
    const badges = [p.learned ? '已學會' : '', p.unfamiliar ? '不熟' : ''].filter(Boolean).join(' · ');
    const primaryTab = r.type === 'vocabulary' ? 'vocabulary' : 'plan';
    const planTab = r.type === 'vocabulary' ? 'new' : 'new';
    const place = r.item.firstDate ? `學習日 ${r.item.firstDate}` : (r.item.level || '所有單字');
    const meaning = [r.item.chinese, r.item.japanese].filter(Boolean).join(' · ') || '尚未排入每日計劃';
    return `
    <div class="result-item" data-date="${r.day.date}" data-primary-tab="${primaryTab}" data-plan-tab="${planTab}">
      <strong>${escapeHtml(r.item.word)}</strong>
      <span>${escapeHtml(meaning)} · ${escapeHtml(place)}${badges ? ' · ' + escapeHtml(badges) : ''}</span>
    </div>`;
  }).join('') : '<p class="empty">找不到符合的單字。</p>';

  $$('.result-item').forEach(item => item.addEventListener('click', () => {
    setPrimaryTab(item.dataset.primaryTab || 'plan');
    setPlanTab(item.dataset.planTab || 'new', false);
    showDay(item.dataset.date);
    $('#searchInput').blur();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
}

function setPrimaryTab(tab, render = true) {
  state.primaryTab = tab;
  $$('.primary-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.primaryTab === tab));
  $('#planSubTabs').hidden = tab !== 'plan';
  if (render) renderDayContent(findDay(state.currentDate));
}

function setPlanTab(tab, render = true) {
  state.planTab = tab;
  $$('.sub-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.planTab === tab));
  if (render) renderDayContent(findDay(state.currentDate));
}

function bindEvents() {
  $$('.primary-tab').forEach(btn => btn.addEventListener('click', () => setPrimaryTab(btn.dataset.primaryTab)));
  $$('.sub-tab').forEach(btn => btn.addEventListener('click', () => setPlanTab(btn.dataset.planTab)));
  $('#searchInput').addEventListener('input', (e) => renderSearch(e.target.value));
  $('#clearSearch').addEventListener('click', () => { $('#searchInput').value = ''; renderSearch(''); });
  $('#todayBtn').addEventListener('click', () => {
    const today = new Date().toISOString().slice(0, 10);
    showDay(findDay(today)?.date || allDays()[0].date);
  });
  $('#firstBtn').addEventListener('click', () => showDay(allDays()[0].date));
  $('#fontPlus').addEventListener('click', () => setFontScale(state.fontScale + 0.05));
  $('#fontMinus').addEventListener('click', () => setFontScale(state.fontScale - 0.05));
  $('#focusMode').addEventListener('click', () => document.body.classList.toggle('focus'));
  $('#focusExit')?.addEventListener('click', () => document.body.classList.remove('focus'));
  $('#themeToggle').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('studyTheme', document.body.classList.contains('dark') ? 'dark' : 'light');
  });
  $('#mobileNavToggle')?.addEventListener('click', toggleMobileNav);
  $('#mobileBackdrop')?.addEventListener('click', closeMobileNav);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMobileNav();
      document.body.classList.remove('focus');
    }
  });
}

async function init() {
  setFontScale(state.fontScale);
  if (localStorage.getItem('studyTheme') === 'dark') document.body.classList.add('dark');
  const response = await fetch('web_assets/study_data.json');
  state.data = await response.json();
  await initProgressDb();
  bindEvents();
  const hashDate = decodeURIComponent(location.hash.replace('#', ''));
  const initial = allDays().some(d => d.date === hashDate) ? hashDate : allDays()[0].date;
  showDay(initial);
}

init().catch(err => {
  console.error(err);
  $('#dayTitle').textContent = '讀取失敗';
  $('#dayContent').innerHTML = `<section class="section-card"><p>無法讀取 web_assets/study_data.json。請用本機伺服器開啟，例如在 AIagent_study_plan 資料夾執行：<code>python3 -m http.server 8000</code></p></section>`;
});
