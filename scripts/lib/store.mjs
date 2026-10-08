import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');

function dataPath(name) {
  return path.join(DATA_DIR, name);
}

function readJson(name, fallback) {
  const p = dataPath(name);
  if (!existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, 'utf8'));
}

function writeJson(name, value) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(dataPath(name), JSON.stringify(value, null, 2));
}

export function stableId(url) {
  return createHash('sha1').update(url).digest('hex').slice(0, 16);
}

export function loadSettings() {
  const raw = readFileSync(path.join(ROOT, 'config', 'settings.json'), 'utf8');
  return JSON.parse(raw);
}

export function loadArticles() {
  return readJson('articles.json', []);
}

export function saveArticles(articles) {
  writeJson('articles.json', articles);
}

export function pruneOld(articles, windowHours) {
  const cutoff = Date.now() - windowHours * 3600 * 1000;
  return articles.filter((a) => new Date(a.publishedAt).getTime() >= cutoff);
}

export function saveStories({ tabs, crossBorder }) {
  writeJson('stories.json', { generatedAt: new Date().toISOString(), tabs, crossBorder });
}

export function appendUsageLog(records) {
  const existing = readJson('usage-log.json', []);
  const combined = [...existing, ...records].slice(-2000); // keep recent history bounded
  writeJson('usage-log.json', combined);
}

export function saveFeedHealth(failures) {
  writeJson('feed-health.json', { checkedAt: new Date().toISOString(), failures });
}

export function loadStorySummaries() {
  return readJson('story-summaries.json', {});
}

export function saveStorySummaries(map) {
  writeJson('story-summaries.json', map);
}

export function loadCrossBorderCache() {
  return readJson('cross-border-cache.json', {});
}

export function saveCrossBorderCache(map) {
  writeJson('cross-border-cache.json', map);
}
