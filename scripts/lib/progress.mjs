// Run-time guardrails for the scheduled build.
//
// Oct 2026: scheduled runs kept getting killed at GitHub's time limit, and
// because every result was only saved at the very end, each killed run threw
// its work away and the next one started from scratch. These helpers let the
// build (a) report which stage it's in as a GitHub annotation, readable even
// when the run is killed, (b) stop starting new Claude calls once a soft
// deadline passes, so the run always finishes and deploys what it has, and
// (c) hard-exit with a clear annotation if something stalls past that.

const startedAt = Date.now();
const SOFT_DEADLINE_MIN = Number(process.env.BUILD_SOFT_DEADLINE_MIN ?? 25);
const HARD_DEADLINE_MIN = Number(process.env.BUILD_HARD_DEADLINE_MIN ?? 37);
const inActions = !!process.env.GITHUB_ACTIONS;

let currentStage = 'starting';

function elapsed() {
  const s = Math.round((Date.now() - startedAt) / 1000);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

export function stage(name) {
  currentStage = name;
  const line = `[${elapsed()}] ${name}`;
  console.log(line);
  if (inActions) console.log(`::notice title=Build stage::${line}`);
}

export function pastSoftDeadline() {
  return Date.now() - startedAt > SOFT_DEADLINE_MIN * 60_000;
}

let warnedSoft = false;
export function noteSoftDeadline(detail) {
  if (warnedSoft) return;
  warnedSoft = true;
  const line = `Soft deadline (${SOFT_DEADLINE_MIN} min) reached during "${currentStage}": ${detail}. Remaining work carries over to the next run.`;
  console.log(line);
  if (inActions) console.log(`::warning title=Build deadline::${line}`);
}

const hardTimer = setTimeout(() => {
  const line = `Hard deadline (${HARD_DEADLINE_MIN} min) hit while stuck in "${currentStage}". Exiting.`;
  console.log(line);
  if (inActions) console.log(`::error title=Build stalled::${line}`);
  process.exit(1);
}, HARD_DEADLINE_MIN * 60_000);
hardTimer.unref();

// Run fn over items with at most `limit` in flight.
export async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
