import Parser from 'rss-parser';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const parser = new Parser({
  timeout: 20000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; personal-news-reader/1.0)' },
});

// Fetching 50+ feeds at once tends to trip up on sandboxed/throttled networks
// (observed locally; GitHub Actions runners haven't shown this) -- cap how
// many are in flight at a time instead of firing every request simultaneously.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function loadOutlets() {
  const raw = readFileSync(path.join(here, '..', '..', 'config', 'outlets.json'), 'utf8');
  return JSON.parse(raw).outlets;
}

function canonicalUrl(url) {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

async function parseOnce(feedUrl) {
  const feed = await parser.parseURL(feedUrl);
  return feed.items ?? [];
}

export async function fetchOutletFeed(outlet) {
  if (!outlet.feedUrl) return { outlet: outlet.outlet, items: [], error: 'no feedUrl configured' };
  // Retry once on a thrown error OR a suspiciously empty response -- a feed
  // that briefly returns a truncated/empty body shouldn't look identical to
  // one that's genuinely quiet right now.
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const rawItems = await parseOnce(outlet.feedUrl);
      if (rawItems.length === 0) {
        lastError = 'parsed 0 items (feed may be empty, or the fetch was truncated)';
        continue;
      }
      const items = rawItems.map((item) => ({
        outlet: outlet.outlet,
        country: outlet.country,
        lean: outlet.lean,
        title: (item.title ?? '').trim(),
        summary: (item.contentSnippet ?? item.summary ?? '').trim().slice(0, 400),
        url: canonicalUrl(item.link ?? ''),
        publishedAt: item.isoDate ?? item.pubDate ?? new Date().toISOString(),
      })).filter((i) => i.title && i.url);
      return { outlet: outlet.outlet, items, error: null };
    } catch (err) {
      lastError = err.message;
    }
  }
  return { outlet: outlet.outlet, items: [], error: lastError };
}

export async function fetchAllFeeds(outlets) {
  const results = await mapWithConcurrency(outlets, 6, fetchOutletFeed);
  const items = results.flatMap((r) => r.items);
  const failures = results.filter((r) => r.error).map((r) => ({ outlet: r.outlet, error: r.error }));
  return { items, failures };
}
