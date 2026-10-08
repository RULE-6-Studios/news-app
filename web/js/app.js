const root = document.getElementById('app');

let data = { tabs: { es: [], us: [], world: [] }, crossBorder: [] };

const TABS = [
  { id: 'es', label: 'Valencia & Spain' },
  { id: 'us', label: 'US' },
  { id: 'world', label: 'World' },
];

function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (key === 'class') node.className = val;
    else if (key === 'onClick') node.addEventListener('click', val);
    else if (key === 'html') node.innerHTML = val; // only ever used with escaped() output
    else node.setAttribute(key, val);
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function leanClass(lean) {
  return lean.replace(/\s+/g, '');
}

function getLastTab() {
  try { return localStorage.getItem('news.lastTab') || 'es'; } catch { return 'es'; }
}
function setLastTab(id) {
  try { localStorage.setItem('news.lastTab', id); } catch { /* ignore */ }
}

function findStory(id) {
  for (const tab of TABS) {
    const story = (data.tabs[tab.id] ?? []).find((s) => s.id === id);
    if (story) return { story, tabId: tab.id };
  }
  return null;
}

function crossBorderFor(storyId) {
  return data.crossBorder.filter((c) => c.a.storyId === storyId);
}

function renderCoverageBar(l, c, r, sizeClass = '') {
  return h('div', { class: `coverage-bar ${sizeClass}` }, [
    h('span', { class: 'bar-l', style: `width:${l}%` }),
    h('span', { class: 'bar-c', style: `width:${c}%` }),
    h('span', { class: 'bar-r', style: `width:${r}%` }),
  ]);
}

function backIcon() {
  const span = h('span', { 'aria-hidden': 'true' });
  span.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"></path></svg>';
  return span;
}
function fwdIcon() {
  const span = h('span', { 'aria-hidden': 'true' });
  span.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"></path></svg>';
  return span;
}

function renderFeed() {
  const activeTab = getLastTab();
  const header = h('div', { class: 'feed-header' }, [
    h('div', { class: 'feed-date' }, formatToday()),
    h('h1', { class: 'feed-title' }, 'Today'),
  ]);

  const tabBar = h('div', { class: 'tabs' }, TABS.map((t) =>
    h('button', {
      type: 'button',
      class: `tab-btn ${t.id === activeTab ? 'active' : ''}`,
      onClick: () => { setLastTab(t.id); render(); },
    }, t.label)
  ));

  const stories = data.tabs[activeTab] ?? [];
  const list = h('div', { class: 'story-list' },
    stories.length
      ? stories.map(renderStoryCard)
      : h('div', { class: 'empty-state' }, 'No stories yet for this tab. The first ingestion run may still be pending.')
  );

  root.replaceChildren(header, tabBar, list);
}

function renderStoryCard(story) {
  const top = h('div', { class: 'story-card-top' }, [
    h('span', { class: 'kicker' }, story.kicker),
    story.blindspot ? h('span', { class: 'blindspot-tag' }, `Blindspot: ${story.blindspotSide}`) : null,
  ]);
  const card = h('div', { class: 'story-card', onClick: () => { location.hash = `#/story/${story.id}`; } }, [
    top,
    h('div', { class: 'story-title serif' }, story.title),
    renderCoverageBar(story.l, story.c, story.r),
    h('div', { class: 'coverage-caption' }, [
      h('span', {}, `L ${story.l}% · C ${story.c}% · R ${story.r}%`),
      h('span', {}, `${story.sources} sources`),
    ]),
  ]);
  return card;
}

function renderStory(storyId) {
  const found = findStory(storyId);
  if (!found) { root.replaceChildren(h('div', { class: 'empty-state' }, 'Story not found.')); return; }
  const { story, tabId } = found;

  const back = h('button', { type: 'button', class: 'back-link', onClick: () => { setLastTab(tabId); location.hash = '#/'; } }, [backIcon(), ' Today']);

  const head = h('div', { class: 'story-head' }, [
    h('span', { class: 'kicker' }, story.kicker),
    h('h1', { class: 'story-title-lg serif' }, story.title),
    h('p', { class: 'story-dek' }, story.summary),
  ]);

  const coverage = h('div', { class: 'card' }, [
    h('div', { class: 'card-row' }, [
      h('span', { class: 'label' }, 'Who covered it'),
      h('span', { class: 'meta' }, `${story.sources} sources`),
    ]),
    renderCoverageBar(story.l, story.c, story.r, 'lg'),
    h('div', { class: 'coverage-legend' }, [
      h('span', { class: 'l' }, `Left ${story.l}%`),
      h('span', { class: 'c' }, `Center ${story.c}%`),
      h('span', { class: 'r' }, `Right ${story.r}%`),
    ]),
  ]);

  const children = [back, head, coverage];

  const links = crossBorderFor(story.id);
  for (const link of links) {
    const otherTabLabel = TABS.find((t) => t.id === link.b.tab)?.label ?? link.b.tab;
    children.push(h('button', {
      type: 'button',
      class: 'cta',
      onClick: () => { location.hash = `#/compare/${encodeURIComponent(link.id)}`; },
    }, [`See how the ${otherTabLabel} press covered it`, fwdIcon()]));
  }

  children.push(h('div', { class: 'section-head' }, [
    h('h2', {}, 'Articles'),
    h('span', { class: 'section-note' }, "Lean is the outlet's label. Slant is scored per article."),
  ]));

  children.push(h('div', { class: 'articles' }, story.articles.map(renderArticleCard)));

  root.replaceChildren(...children);
}

function renderArticleCard(article) {
  const top = h('div', { class: 'article-top' }, [
    h('span', { class: 'outlet-name' }, article.outlet),
    h('span', { class: `lean-chip ${leanClass(article.lean)}` }, article.lean),
  ]);
  const track = h('div', { class: 'slant-track' }, [
    h('div', { class: 'slant-mid' }),
    h('div', { class: 'slant-dot', style: `left:${article.pos}%` }),
  ]);
  const score = article.slantScore == null ? 'Unscored' : `Slant ${article.slantScore}/10 · ${article.slantDirection}`;
  const slantRow = h('div', { class: 'slant-row' }, [
    h('span', { class: 'score' }, score),
    h('a', { href: article.url, target: '_blank', rel: 'noopener' }, 'Read original'),
  ]);
  return h('div', { class: 'article-card' }, [
    top,
    h('div', { class: 'headline serif' }, article.headline),
    track,
    slantRow,
    article.slantReason ? h('span', { class: 'slant-reason' }, article.slantReason) : null,
  ]);
}

function renderCompare(pairId) {
  const pair = data.crossBorder.find((c) => c.id === decodeURIComponent(pairId));
  if (!pair) { root.replaceChildren(h('div', { class: 'empty-state' }, 'Comparison not found.')); return; }

  const back = h('button', { type: 'button', class: 'back-link', onClick: () => { location.hash = `#/story/${pair.a.storyId}`; } }, [backIcon(), ' Story']);

  const head = h('div', { class: 'story-head' }, [
    h('span', { class: 'kicker' }, 'Same story, two countries'),
    h('h1', { class: 'story-title-lg serif' }, pair.title),
    h('span', { class: 'compare-note' }, 'Each country is rated on its own left-right scale.'),
  ]);

  function sideCard(side, label) {
    return h('div', { class: 'card' }, [
      h('div', { class: 'card-row' }, [
        h('span', { class: 'label' }, label),
        h('span', { class: 'meta' }, `${side.sources} sources`),
      ]),
      renderCoverageBar(side.l, side.c, side.r),
      h('span', { class: 'slant-reason' }, side.framing),
    ]);
  }

  const tabLabel = (id) => TABS.find((t) => t.id === id)?.label ?? id;

  const keyDiff = h('div', { class: 'key-diff' }, [
    h('span', { class: 'heading' }, 'What changes across the border'),
    h('span', { class: 'body' }, pair.keyDifference),
  ]);

  root.replaceChildren(back, head, sideCard(pair.a, `${tabLabel(pair.a.tab)} press`), sideCard(pair.b, `${tabLabel(pair.b.tab)} press`), keyDiff);
}

function formatToday() {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

function render() {
  const hash = location.hash || '#/';
  const storyMatch = hash.match(/^#\/story\/(.+)$/);
  const compareMatch = hash.match(/^#\/compare\/(.+)$/);
  if (storyMatch) renderStory(decodeURIComponent(storyMatch[1]));
  else if (compareMatch) renderCompare(compareMatch[1]);
  else renderFeed();
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);

async function boot() {
  try {
    const res = await fetch('data/stories.json', { cache: 'no-store' });
    if (res.ok) data = await res.json();
  } catch {
    // Keep the empty-state shell; the service worker's cached copy (if any) still renders on next load.
  }
  render();
}

boot();
