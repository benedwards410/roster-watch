#!/usr/bin/env node
/**
 * Regression tests for the filter logic. Each case corresponds to a specific
 * failure in the original hand-written keyword strings. Run: npm test
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { buildMatchers, buildSources, classify, keysFor, termsToRegex } from './lib.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const readJson = async (p) => JSON.parse(await fs.readFile(path.join(ROOT, p), 'utf8'));

const roster = await readJson('data/roster.json');
const config = await readJson('data/config.json');
const m = buildMatchers(roster, config);

let pass = 0;
const failures = [];

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else failures.push(`${label}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const item = (title, mode = 'roster', summary = '') => ({
  title,
  summary,
  mode,
  link: `https://example.com/${encodeURIComponent(title.slice(0, 40))}`,
  guid: title,
  published: new Date().toUTCString(),
  source: 'test',
});

const kept = (title, mode, summary) => classify(item(title, mode, summary), m) !== null;
const players = (title, mode = 'roster') => classify(item(title, mode), m)?.players ?? null;
const isUrgent = (title) => classify(item(title), m)?.urgent ?? null;

// -- 1. Substring collateral damage from the original exclusion list ---------
// "line" / "spread" / "jersey" / "shop" as bare substrings destroyed these.
check('goal line news survives', kept('Bills plan to use James Cook on goal-line carries'), true);
check('offensive line news survives', kept('Justin Herbert protected by rebuilt offensive line'), true);
check('New Jersey survives', kept('Mason Taylor turning heads in New Jersey camp'), true);
check('sideline survives', kept('Tee Higgins seen on the sideline in a walking boot'), true);
check('spread offense survives', kept('Vikings spread offense feeds Justin Jefferson'), true);

// -- 2. Gambling and merch spam still dropped -------------------------------
check('betting odds dropped', kept('Justin Jefferson receiving yards prop bet and betting odds'), false);
check('parlay dropped', kept('Best James Cook parlay for Sunday'), false);
check('promo dropped', kept('DraftKings promo code for Chargers game'), false);
check('ticket resale dropped', kept('Cheap Steelers tickets on StubHub, Jaylen Warren returns'), false);

// -- 3. Name collisions isolated by per-player exclusions -------------------
check('Captain Cook dropped', kept('James Cook the explorer and his final voyage'), false);
check('Aidan Hutchinson not counted', players('Aidan Hutchinson signs extension'), null);
check('Xavier Hutchinson counted', players('Xavier Hutchinson gets first-team reps'), ['Xavier Hutchinson']);
check('Khalil Herbert not counted', players('Khalil Herbert waived by Colts'), null);
check(
  'Deion coverage dropped',
  players('Coach Prime praises Shedeur Sanders after Colorado Buffaloes practice'),
  null
);
check('actual Shedeur news kept', players('Shedeur Sanders takes first-team reps in Cleveland'), [
  'Shedeur Sanders',
]);

// -- 4. Spelling. The original string had "Nijgba" and would never have matched
check('Smith-Njigba matches hyphenated', players('Jaxon Smith-Njigba dominating slot snaps'), [
  'Jaxon Smith-Njigba',
]);
check('JSN alias matches', players('JSN leads Seahawks in target share'), ['Jaxon Smith-Njigba']);

// -- 5. No AND-gate on player names ----------------------------------------
// The original doc appended AND ("depth chart" OR ...) to player names, which
// would have silently swallowed the single most important item type.
check(
  'bare injury note passes with no buzzword',
  kept('Herbert questionable, ankle'.replace('Herbert', 'Justin Herbert')),
  true
);
check('breaking role news passes', kept('Travis Etienne will start Week 1'), true);

// -- 6. Tier separation ----------------------------------------------------
check('team feed needs buzzword', kept('Tennessee Titans unveil new uniforms', 'team'), false);
check('team feed passes on buzzword', kept('Tennessee Titans release depth chart', 'team'), true);
check('roster feed never passes on buzzword alone', kept('Broncos release depth chart', 'roster'), false);

// -- 7. Urgency routing ----------------------------------------------------
check('inactive is urgent', isUrgent('Kyren Williams inactive for Sunday'), true);
check('ruled out is urgent', isUrgent('Tank Dell ruled out with hamstring strain'), true);
check('target share is not urgent', isUrgent('Justin Jefferson leads league in target share'), false);
check('trade is urgent', isUrgent('Kimani Vidal traded to the Jets'), true);

// -- 8. Dedupe -------------------------------------------------------------
const a = item('Report: Travis Etienne to miss two weeks with a hamstring strain');
const b = {
  ...item('Report: Travis Etienne to miss two weeks with a hamstring strain -- via ESPN'),
  guid: 'different-guid-entirely',
  link: 'https://other.example.com/etienne',
};
check('cross-source near-duplicate collides', keysFor(a).fuzzy === keysFor(b).fuzzy, true);
check('unrelated headline does not collide', keysFor(a).fuzzy === keysFor(item('Bills win')).fuzzy, false);

// -- 9. Regex construction safety -----------------------------------------
check('special chars escaped', termsToRegex(['over/under', 'C.J. Stroud']).test('over/under 44.5'), true);
check('empty list yields null', termsToRegex([]), null);

// -- 10. Source generation ------------------------------------------------
const sources = buildSources(roster, config);
const teamFeeds = sources.filter((s) => s.mode === 'team');
const rosterTeams = new Set(roster.players.map((p) => p.team));
check('one team feed per rostered team', teamFeeds.length, rosterTeams.size);
check('every player appears in a generated query', 
  roster.players.every((p) => sources.some((s) => s.url.includes(encodeURIComponent(`"${p.name}"`)))),
  true
);
check('all URLs are https', sources.every((s) => s.url.startsWith('https://')), true);

// -- report ---------------------------------------------------------------
console.log(`\n  ${pass} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
console.log('  Filter logic verified. Feed reachability is separate -- check status.json after the first run.\n');
