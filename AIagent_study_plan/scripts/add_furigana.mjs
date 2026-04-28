import fs from 'node:fs/promises';
import path from 'node:path';
import kuromoji from 'kuromoji';
import * as wanakana from 'wanakana';

const ROOT = path.resolve('AIagent_study_plan');
const DATA_PATH = path.join(ROOT, 'web_assets', 'study_data.json');
const DIC_PATH = path.resolve('node_modules/kuromoji/dict');

function hasKanji(text) {
  return /[一-龯々〆ヵヶ]/.test(text || '');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function readingToKana(reading) {
  if (!reading || reading === '*') return '';
  return wanakana.toHiragana(reading);
}

function tokenToRuby(token) {
  const surface = token.surface_form || '';
  if (!surface) return '';
  if (!hasKanji(surface)) return escapeHtml(surface);
  const reading = readingToKana(token.reading);
  if (!reading || reading === surface) return escapeHtml(surface);
  return `<ruby>${escapeHtml(surface)}<rt>${escapeHtml(reading)}</rt></ruby>`;
}

function buildTokenizer() {
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: DIC_PATH }).build((err, tokenizer) => {
      if (err) reject(err);
      else resolve(tokenizer);
    });
  });
}

function rubyText(tokenizer, text) {
  if (!text || !hasKanji(text)) return escapeHtml(text || '');
  return tokenizer.tokenize(text).map(tokenToRuby).join('');
}

function addWordRuby(tokenizer, item) {
  if (!item || typeof item !== 'object') return;
  if (item.japanese) item.japaneseRuby = rubyText(tokenizer, item.japanese);
  if (item.japaneseExample) item.japaneseExampleRuby = rubyText(tokenizer, item.japaneseExample);
}

const tokenizer = await buildTokenizer();
const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
let wordCount = 0;
let storyCount = 0;

for (const item of data.allWords || []) {
  addWordRuby(tokenizer, item);
  wordCount += 1;
}

for (const item of data.completeVocabulary || []) {
  addWordRuby(tokenizer, item);
  wordCount += 1;
}

for (const week of data.weeks || []) {
  for (const day of week.days || []) {
    for (const item of day.newWords || []) addWordRuby(tokenizer, item);
    for (const item of day.reviewWords || []) addWordRuby(tokenizer, item);
    if (day.story?.japanese) {
      day.story.japaneseRuby = rubyText(tokenizer, day.story.japanese);
      storyCount += 1;
    }
  }
}

data.furigana = {
  generatedAt: new Date().toISOString(),
  engine: 'kuromoji + wanakana',
  fields: ['japaneseRuby', 'japaneseExampleRuby', 'story.japaneseRuby'],
};

await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
console.log(JSON.stringify({ wordCount, storyCount, dataPath: DATA_PATH }, null, 2));
