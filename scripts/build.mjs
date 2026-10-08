#!/usr/bin/env node
// Orchestrates one ingestion run: fetch feeds -> embed -> cluster into stories
// -> score each article's slant -> summarize each story -> link cross-border
// pairs -> write data/stories.json for the front end. Run by hand with
// `npm run build`, or on the GitHub Actions schedule once Chris turns it on.
import { loadOutlets, fetchAllFeeds } from './lib/feeds.mjs';
import { embed } from './lib/embed.mjs';
import { clusterArticles, findCrossBorderPairs } from './lib/cluster.mjs';
import { scoreArticleSlant, summarizeStory, compareCrossBorder } from './lib/score.mjs';
import { getUsageLog, summarizeUsage } from './lib/claude.mjs';
import {
  stableId, loadSettings, loadArticles, saveArticles, pruneOld,
  saveStories, appendUsageLog, saveFeedHealth,
  loadStorySummaries, saveStorySummaries, loadCrossBorderCache, saveCrossBorderCache,
} from './lib/store.mjs';

const settings = loadSettings();
const outlets = loadOutlets();
const outletById = new Map(outlets.map((o) => [o.outlet, o]));

console.log(`Fetching ${outlets.length} feeds...`);
const { items, failures } = await fetchAllFeeds(outlets);
saveFeedHealth(failures);
if (failures.length) {
  console.log(`${failures.length} feed(s) failed:`);
  for (const f of failures) console.log(`  - ${f.outlet}: ${f.error}`);
}
console.log(`Fetched ${items.length} items.`);

// Merge into the rolling article store, keyed by canonical URL.
let articles = loadArticles();
const byId = new Map(articles.map((a) => [a.id, a]));
for (const item of items) {
  const id = stableId(item.url);
  if (!byId.has(id)) {
    const a = { id, ...item, embedding: null, slant: null };
    byId.set(id, a);
  }
}
articles = pruneOld([...byId.values()], settings.articleWindowHours);

const missingEmbeddings = articles.filter((a) => !a.embedding);
console.log(`Embedding ${missingEmbeddings.length} new article(s)...`);
for (const a of missingEmbeddings) {
  a.embedding = await embed(`${a.title}. ${a.summary}`);
}
saveArticles(articles);

// Cluster within each tab's country group -- same-event grouping stays mostly
// same-language, which keeps clusters tight.
const tabClusters = {};
for (const tab of settings.tabs) {
  const tabArticles = articles.filter((a) => tab.countries.includes(a.country));
  tabClusters[tab.id] = clusterArticles(tabArticles, settings.clusterSimilarityThreshold);
}

const articleById = new Map(articles.map((a) => [a.id, a]));
const storySummaryCache = loadStorySummaries();
const crossBorderCache = loadCrossBorderCache();

function leanBucket(lean) {
  if (lean === 'Left' || lean === 'Lean Left') return 'l';
  if (lean === 'Right' || lean === 'Lean Right') return 'r';
  return 'c';
}

function directionSide(direction) {
  if (direction === 'leans left') return -1;
  if (direction === 'leans right') return 1;
  return 0;
}

async function buildStory(cluster) {
  const members = cluster.articleIds.map((id) => articleById.get(id)).filter(Boolean);
  if (members.length === 0) return null;
  const anchorId = cluster.articleIds[0];
  const storyId = `story-${anchorId}`;

  // Coverage bar: share of articles from left/center/right-labeled outlets.
  const counts = { l: 0, c: 0, r: 0 };
  for (const m of members) counts[leanBucket(m.lean)] += 1;
  const total = members.length;
  const pct = {
    l: Math.round((counts.l / total) * 100),
    c: Math.round((counts.c / total) * 100),
    r: Math.round((counts.r / total) * 100),
  };
  let blindspot = false;
  let blindspotSide = null;
  if (total >= 5) {
    if (pct.l < settings.blindspotThresholdPct) { blindspot = true; blindspotSide = 'Left'; }
    else if (pct.r < settings.blindspotThresholdPct) { blindspot = true; blindspotSide = 'Right'; }
  }

  // Story summary -- cached, regenerated only once the cluster has grown
  // meaningfully so we don't re-pay for a Sonnet call every 2 hours.
  const cached = storySummaryCache[storyId];
  let summary = cached;
  if (!cached || total - cached.memberCount >= 3) {
    const result = await summarizeStory({ model: settings.models.storySummary, articles: members });
    summary = { kicker: result.kicker, title: result.title, summary: result.summary, memberCount: total };
    storySummaryCache[storyId] = summary;
  }

  // Per-article slant -- scored once per article, cached on the article record.
  for (const m of members) {
    if (!m.slant) {
      const result = await scoreArticleSlant({ model: settings.models.articleScoring, article: m, siblingArticles: members });
      m.slant = { score: result.score, direction: result.direction, reason: result.reason };
    }
  }

  const articlesOut = members.map((m) => {
    const side = directionSide(m.slant?.direction ?? 'neutral');
    const score = m.slant?.score ?? 0;
    return {
      outlet: m.outlet,
      lean: m.lean,
      headline: m.title,
      url: m.url,
      slantScore: m.slant?.score ?? null,
      slantDirection: m.slant?.direction ?? 'neutral',
      slantReason: m.slant?.reason ?? '',
      pos: Math.max(0, Math.min(100, 50 + side * score * 5)),
    };
  });

  return {
    id: storyId,
    kicker: summary.kicker,
    title: summary.title,
    summary: summary.summary,
    l: pct.l, c: pct.c, r: pct.r,
    sources: total,
    blindspot, blindspotSide,
    articles: articlesOut,
  };
}

const tabsOut = {};
const eligibleClusters = {};
for (const tab of settings.tabs) {
  // Most articles never get corroborated by a second outlet -- that's normal
  // news volume, not a clustering failure. Skip straight to Claude only for
  // clusters that actually are a "story" (multiple outlets on the same
  // event); a single-source item has no coverage bar or blindspot to show
  // anyway, and scoring every singleton would multiply the Claude bill for
  // no product value.
  const eligible = tabClusters[tab.id].filter((c) => c.articleIds.length >= settings.minSourcesForStory);
  eligibleClusters[tab.id] = eligible;
  const skipped = tabClusters[tab.id].length - eligible.length;
  console.log(`${tab.label}: ${eligible.length} multi-source stor${eligible.length === 1 ? 'y' : 'ies'} (${skipped} single-source item(s) skipped).`);
  const stories = [];
  for (const cluster of eligible) {
    const story = await buildStory(cluster);
    if (story) stories.push(story);
  }
  stories.sort((a, b) => b.sources - a.sources);
  tabsOut[tab.id] = stories;
}

// Cross-border links: Spain <-> US, Spain <-> World (each pair stays within
// its own two countries' lean scales -- never compared on one axis).
const crossBorder = [];
const pairDefs = [['es', 'us'], ['es', 'world']];
for (const [tabA, tabB] of pairDefs) {
  const pairs = findCrossBorderPairs(eligibleClusters[tabA], eligibleClusters[tabB], settings.crossBorderSimilarityThreshold);
  for (const { a, b } of pairs) {
    const storyA = tabsOut[tabA].find((s) => s.id === `story-${a.articleIds[0]}`);
    const storyB = tabsOut[tabB].find((s) => s.id === `story-${b.articleIds[0]}`);
    if (!storyA || !storyB) continue;
    const pairKey = [storyA.id, storyB.id].sort().join('|');
    const cached = crossBorderCache[pairKey];
    let compared = cached;
    if (!cached || storyA.sources - cached.sourcesA >= 3 || storyB.sources - cached.sourcesB >= 3) {
      const tabLabel = (id) => settings.tabs.find((t) => t.id === id)?.label ?? id;
      const result = await compareCrossBorder({
        model: settings.models.crossBorderComparison,
        storyA: { title: storyA.title, summary: storyA.summary, countryLabel: tabLabel(tabA) },
        storyB: { title: storyB.title, summary: storyB.summary, countryLabel: tabLabel(tabB) },
      });
      compared = { ...result, sourcesA: storyA.sources, sourcesB: storyB.sources };
      crossBorderCache[pairKey] = compared;
    }
    crossBorder.push({
      id: pairKey,
      title: compared.title,
      a: { tab: tabA, storyId: storyA.id, sources: storyA.sources, l: storyA.l, c: storyA.c, r: storyA.r, framing: compared.framingA },
      b: { tab: tabB, storyId: storyB.id, sources: storyB.sources, l: storyB.l, c: storyB.c, r: storyB.r, framing: compared.framingB },
      keyDifference: compared.keyDifference,
    });
  }
}

saveStorySummaries(storySummaryCache);
saveCrossBorderCache(crossBorderCache);
saveStories({ tabs: tabsOut, crossBorder });
saveArticles(articles); // persist slant scores computed this run

appendUsageLog(getUsageLog());
const usage = summarizeUsage();
console.log(`\nDone. ${usage.calls} Claude call(s) this run, ~$${usage.totalCost.toFixed(4)}.`);
for (const [action, stats] of Object.entries(usage.byAction)) {
  console.log(`  ${action}: ${stats.calls} call(s), ~$${stats.costUsd.toFixed(4)}`);
}
