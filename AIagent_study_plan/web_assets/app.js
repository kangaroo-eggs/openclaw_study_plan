const state = {
  data: null,
  currentDate: null,
  tab: 'new',
  fontScale: Number(localStorage.getItem('studyFontScale') || '1'),
};

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
  $('#stats').innerHTML = `
    <div class="stat-card"><strong>${day.newWords.length}</strong><span>今日新單字</span></div>
    <div class="stat-card"><strong>${day.reviewWords.length}</strong><span>今日複習</span></div>
    <div class="stat-card"><strong>${state.data.stats.newWordEntries}</strong><span>全月新單字</span></div>
    <div class="stat-card"><strong>${state.data.stats.days}</strong><span>學習天數</span></div>
  `;
}

function wordCard(item) {
  if (item.parse_error) {
    return `<article class="word-card"><p class="empty">解析失敗：${escapeHtml(item.raw)}</p></article>`;
  }
  return `
    <article class="word-card" id="word-${escapeHtml(item.word.toLowerCase())}">
      <div class="word-head">
        <span class="word-number">${item.number}</span>
        <div>
          <h4 class="word">${escapeHtml(item.word)}</h4>
          <p class="pos">${escapeHtml(item.pos)}</p>
        </div>
      </div>
      <div class="meaning-row">
        <div><span class="label">中文</span><p class="chinese">${escapeHtml(item.chinese)}</p></div>
        <div><span class="label">日本語</span><p class="japanese">${escapeHtml(item.japanese)}</p></div>
      </div>
      <div class="examples">
        <p class="english-example">${escapeHtml(item.englishExample)}</p>
        <p class="japanese-example">${escapeHtml(item.japaneseExample)}</p>
      </div>
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

function renderDayContent(day) {
  const chunks = [];
  if (state.tab === 'new' || state.tab === 'all') chunks.push(wordsSection('新單字 30', day.newWords, '今天沒有新單字。'));
  if (state.tab === 'review' || state.tab === 'all') chunks.push(wordsSection('複習單字 10', day.reviewWords, '今天沒有複習單字。'));
  if (state.tab === 'story' || state.tab === 'all') chunks.push(storySection(day));
  $('#dayContent').innerHTML = chunks.join('');
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
  for (const day of allDays()) {
    for (const type of ['newWords', 'reviewWords']) {
      for (const item of day[type]) {
        if (item.parse_error) continue;
        const haystack = [item.word, item.pos, item.chinese, item.japanese, item.englishExample, item.japaneseExample].join(' ').toLowerCase();
        if (haystack.includes(q)) {
          results.push({ day, type, item });
        }
      }
    }
  }
  panel.hidden = false;
  $('#resultList').innerHTML = results.length ? results.slice(0, 80).map(r => `
    <div class="result-item" data-date="${r.day.date}" data-tab="${r.type === 'newWords' ? 'new' : 'review'}">
      <strong>${escapeHtml(r.item.word)}</strong>
      <span>${escapeHtml(r.item.chinese)} · ${escapeHtml(r.item.japanese)} · ${r.day.date} · ${r.type === 'newWords' ? '新單字' : '複習'}</span>
    </div>
  `).join('') : '<p class="empty">找不到符合的單字。</p>';

  $$('.result-item').forEach(item => item.addEventListener('click', () => {
    setTab(item.dataset.tab);
    showDay(item.dataset.date);
    $('#searchInput').blur();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
}

function setTab(tab) {
  state.tab = tab;
  $$('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  renderDayContent(findDay(state.currentDate));
}

function bindEvents() {
  $$('.tab').forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
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
