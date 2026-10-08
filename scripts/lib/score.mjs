import { callClaude } from './claude.mjs';

function parseJsonLoose(text) {
  const stripped = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    return null;
  }
}

// One article's slant: 0-10 intensity + direction + a one-line reason, scored
// against loaded language, one-sided sourcing, headline-vs-body oversell, and
// what the sibling articles in the same story cluster cover that this one omits.
export async function scoreArticleSlant({ model, article, siblingArticles }) {
  const siblingList = siblingArticles
    .filter((s) => s.id !== article.id)
    .slice(0, 8)
    .map((s) => `- [${s.outlet}, ${s.lean}] ${s.title}`)
    .join('\n') || '(no other articles in this cluster)';

  const system = `You rate news articles for slant on a strict 0-10 scale (0 = neutral/factual, 10 = extremely one-sided), plus a direction. You never store or quote full article bodies -- you only see the headline and a short feed snippet, same as the reader will. Judge from: loaded/charged language in the headline/snippet, signs of one-sided sourcing, whether the headline oversells what the snippet actually supports, and what this article's framing omits compared to the sibling headlines from other outlets covering the same story. Respond with ONLY a JSON object: {"score": <0-10 integer>, "direction": "leans left"|"leans right"|"neutral", "reason": "<one short sentence, specific to this article, e.g. naming the loaded word or the omission>"}`;

  const user = `Outlet: ${article.outlet} (outlet's own lean label: ${article.lean})
Headline: ${article.title}
Snippet: ${article.summary || '(no snippet available)'}

Other outlets covering the same story:
${siblingList}`;

  const { text, record } = await callClaude({
    model,
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 200,
    action: 'score-article',
  });

  const parsed = parseJsonLoose(text);
  if (!parsed) {
    return { score: null, direction: 'neutral', reason: 'Scoring failed to parse; treat as unscored.', record };
  }
  return {
    score: Math.max(0, Math.min(10, Math.round(Number(parsed.score) ?? 0))),
    direction: ['leans left', 'leans right', 'neutral'].includes(parsed.direction) ? parsed.direction : 'neutral',
    reason: String(parsed.reason ?? '').slice(0, 200),
    record,
  };
}

// A short neutral synthesis of the story plus a kicker, from the cluster's
// headlines/snippets only (never full article text).
export async function summarizeStory({ model, articles }) {
  const list = articles
    .slice(0, 20)
    .map((a) => `- [${a.outlet}, ${a.lean}] ${a.title}${a.summary ? ' -- ' + a.summary : ''}`)
    .join('\n');

  const system = `You write short, neutral news-story summaries from a list of headlines and short snippets from multiple outlets covering the same event. You never saw the full articles. Respond with ONLY a JSON object: {"kicker": "<Region · Topic, max 4 words>", "title": "<one neutral sentence describing the event, max 20 words>", "summary": "<2-3 neutral sentences synthesizing what happened, max 60 words, no editorializing>"}`;

  const user = `Headlines covering this story:\n${list}`;

  const { text, record } = await callClaude({
    model,
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 400,
    action: 'summarize-story',
  });

  const parsed = parseJsonLoose(text);
  if (!parsed) {
    return { kicker: 'Story', title: articles[0]?.title ?? 'Untitled story', summary: '', record };
  }
  return {
    kicker: String(parsed.kicker ?? 'Story').slice(0, 60),
    title: String(parsed.title ?? articles[0]?.title ?? 'Untitled story').slice(0, 200),
    summary: String(parsed.summary ?? '').slice(0, 400),
    record,
  };
}

// For the "same story, two countries" view: how each country's press framed it,
// and the single biggest framing difference across the border.
export async function compareCrossBorder({ model, storyA, storyB }) {
  const system = `You compare how two different countries' press covered the same underlying event. Each side was already summarized separately from that country's own outlets -- you never saw full article text. Respond with ONLY a JSON object: {"title": "<one short neutral title for the shared event, max 12 words>", "framingA": "<one sentence on how country A's press mostly framed it>", "framingB": "<one sentence on how country B's press mostly framed it>", "keyDifference": "<one sentence on the single biggest framing difference, e.g. what one side's coverage leads with that the other leaves out>"}`;

  const user = `Country A (${storyA.countryLabel}): ${storyA.title}\n${storyA.summary}\n\nCountry B (${storyB.countryLabel}): ${storyB.title}\n${storyB.summary}`;

  const { text, record } = await callClaude({
    model,
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 400,
    action: 'cross-border-comparison',
  });

  const parsed = parseJsonLoose(text);
  if (!parsed) {
    return { title: storyA.title, framingA: '', framingB: '', keyDifference: '', record };
  }
  return {
    title: String(parsed.title ?? storyA.title).slice(0, 200),
    framingA: String(parsed.framingA ?? '').slice(0, 300),
    framingB: String(parsed.framingB ?? '').slice(0, 300),
    keyDifference: String(parsed.keyDifference ?? '').slice(0, 300),
    record,
  };
}
