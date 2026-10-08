# News (private, personal)

A private news app for Chris (and Amy, if he opens it to her): same-story coverage
grouped across outlets, each outlet's own lean label, a per-article Claude slant
score with a one-line reason, and a coverage bar with a blindspot flag. Not a
product -- no sign-up, no ads, no republished article text. Three tabs: Valencia
& Spain, US, World, plus a same-story-two-countries comparison view.

## How it works

1. `scripts/build.mjs` fetches every outlet's RSS feed (`config/outlets.json`),
   embeds new headlines locally (no API call -- `@xenova/transformers`, a small
   multilingual sentence model), and clusters same-event articles into "stories"
   within each tab's country group.
2. Each story gets a short neutral summary (Claude Sonnet 5), and each article
   gets a 0-10 slant score + direction + one-line reason (Claude Haiku 4.5),
   scored from its headline and feed snippet only -- never the full article body.
3. Stories whose clusters in two different tabs look like the same underlying
   event get linked for the "same story, two countries" view, with a short
   Claude-written comparison of how each country's press framed it.
4. The result is written to `data/stories.json` (and copied to `web/data/stories.json`
   for the front end) plus a running usage log at `data/usage-log.json`.
5. `web/` is a static, installable PWA that reads `data/stories.json` -- no
   server, no database.

On GitHub Actions (`.github/workflows/ingest.yml`), steps 1-4 run on a schedule
(currently commented out -- see "Turning on the schedule" below) and the result
deploys to Cloudflare Pages.

## Running it by hand

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # or use `ant auth login` once, no env var needed
npm run build
```

This writes `data/stories.json` and `web/data/stories.json`. To preview the
front end locally:

```bash
npx serve web   # or: cd web && python3 -m http.server 8080
```

## Editing the outlet table

Everything about an outlet lives in one place: `config/outlets.json`.

- **To change a label**: edit that outlet's `lean` field (`Left`, `Lean Left`,
  `Center`, `Lean Right`, or `Right`), and update `labelSource`/`labelDate` to
  say why. Spain and US/World outlets are rated on separate scales -- never
  copy a lean value across countries.
- **To fix or add a feed**: edit `feedUrl`. Set it to `null` and add a
  `feedStatus` note if an outlet has no working public feed.
- **To add a new outlet**: copy an existing entry's shape and add it to the
  array. Give it a `country` that matches one of the groups in
  `config/settings.json`'s `tabs` (or add a new tab there).
- **To re-check every feed** after an edit: `npm run verify-feeds`.

### Known feed gaps (as of 2026-10-08)

These outlets have no working public RSS feed and are skipped until one is
found or added by hand:

- **Spain**: Publico, Levante-EMV, EFE (feed exists but blocks automated
  fetches, HTTP 403), RTVE, El Debate (feed blocks automated fetches)
- **US**: MSNBC, CNN (its RSS feeds return HTTP 200 but serve content frozen
  since 2023-04 -- effectively dead), Politico, USA Today
- **World**: Reuters, AP, The Telegraph

`HuffPost`'s feed resolves and looks valid but has had zero items in every
check so far -- likely deprecated infrastructure left running empty; not
worth chasing further by hand. `Newsmax` has a feed URL that couldn't be
verified from the environment this was built in (looked like a local network
issue, not a dead feed) -- the first scheduled run will tell us for sure;
check `data/feed-health.json` after it.

### Labels that need a human glance

A few US/World labels were assigned by judgment rather than a clean AllSides +
Ad Fontes match, and are worth Chris reviewing once:

- **AP**: AllSides puts it at -1.30 (barely left of Center). Set to `Center`
  here per wire-service convention; flip to `Lean Left` if you want the raw
  number honored.
- **DW, France 24**: neither AllSides nor Ad Fontes rates them. Set to `Center`
  by judgment (both are public international broadcasters with BBC-comparable
  editorial independence).
- **The Telegraph**: neither AllSides nor Ad Fontes rates it either. Fell back
  to Media Bias/Fact Check ("Right Biased").
- **The Hill**: sources disagreed between Lean Left and Center; settled on
  Center using Ad Fontes' explicit "Middle" score.

## Changing the blindspot threshold or similarity thresholds

`config/settings.json`:

- `blindspotThresholdPct` (default 15): a story is flagged as a blindspot when
  one side (left or right outlets) is under this share of its coverage.
- `clusterSimilarityThreshold` (default 0.8): how similar two articles' titles
  need to be (cosine similarity on embeddings) to count as the same story.
- `crossBorderSimilarityThreshold` (default 0.72): same, but for linking a
  Spain story to a US/World story as "the same event" -- looser, since the
  language differs.

## Turning on the schedule

Nothing runs automatically yet. `.github/workflows/ingest.yml` has a
`workflow_dispatch` trigger (so it can be run by hand from the Actions tab or
`gh workflow run ingest.yml`) and a commented-out `schedule` trigger.

**Before uncommenting the schedule**, run the workflow by hand a few times and
check `data/usage-log.json` (or the Action's log output) for the real per-run
Claude cost, then project it to a monthly figure at the planned cadence (every
2 hours, 07:00-23:00 Madrid time, about 9 runs/day).

Measured on 2026-10-08 (real run, real API key, this outlet table):

- **Cold start** (first run, nothing cached yet): 431 Claude calls, **$0.59**.
  This only happens once -- every article gets a slant score and every story
  gets a summary from scratch.
- **Warm run** ~15 minutes later (36 new articles arrived, slant scores and
  story summaries reused from cache): 9 Claude calls, **$0.01**.
- A real 2-hour gap will see more new articles than that 15-minute sample, so
  the steady-state run is realistically somewhere between the two --
  call it **$0.03-$0.10 per run**. At 9 runs/day x ~30 days that's roughly
  **$8-$27/month**, plus one $0.59 cold start the first time the schedule
  runs. Local embeddings cost nothing (no API call -- they run on the
  GitHub Actions runner itself).
- Re-run `npm run build` by hand a few more times over a few real 2-hour gaps
  before trusting this range, and update these numbers from whatever
  `data/usage-log.json` actually shows.

Required repo secrets (Settings -> Secrets and variables -> Actions):

- `ANTHROPIC_API_KEY` -- personal API key, billed to Chris's own card, not a
  RULE 6 account.
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` -- for the Pages deploy step.
- Repo variable `CLOUDFLARE_PAGES_PROJECT` -- the Pages project name.

## Access

The deployed site should sit behind Cloudflare Access, restricted to Chris's
email (and Amy's, only if Chris says so). That's configured in the Cloudflare
dashboard against the Pages project, not in this repo.

## Hard rules this app follows

- RSS (plus GDELT where needed) only -- never scrapes or stores full article
  text. Only headline, our own Claude-written summary, and a link to the
  original are stored or shown.
- Spain and US (and World, rated against each outlet's own home country) are
  separate lean scales, never compared on one axis.
- Every slant score always carries its one-line reason.
