#!/usr/bin/env node
// Checks every feedUrl in config/outlets.json actually resolves, without
// running the full build. Use after editing the outlet table.
import { loadOutlets, fetchAllFeeds } from './lib/feeds.mjs';

const outlets = loadOutlets();
const { items, failures } = await fetchAllFeeds(outlets);

const byOutlet = new Map();
for (const item of items) byOutlet.set(item.outlet, (byOutlet.get(item.outlet) ?? 0) + 1);

console.log(`${outlets.length} outlets checked.\n`);
for (const o of outlets) {
  const count = byOutlet.get(o.outlet) ?? 0;
  const fail = failures.find((f) => f.outlet === o.outlet);
  if (fail) {
    console.log(`FAIL  ${o.outlet.padEnd(24)} ${fail.error}`);
  } else {
    console.log(`OK    ${o.outlet.padEnd(24)} ${count} item(s)`);
  }
}

if (failures.length) {
  console.log(`\n${failures.length} outlet(s) need attention.`);
  process.exitCode = 1;
} else {
  console.log('\nAll feeds OK.');
}
