#!/usr/bin/env node
/**
 * Sync roster from Sleeper fantasy platform.
 * Fetches the user's current roster, maps player IDs to names via the
 * Sleeper player database, and updates data/roster.json — preserving any
 * manual aliases and exclusion overrides.
 *
 * Exits silently (no error) when:
 *   - data/sleeper.json is missing (sync not configured)
 *   - the roster hasn't changed since the last sync
 *   - the Sleeper API is unreachable (feed build should still proceed)
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const P = (...parts) => path.join(ROOT, ...parts);
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));

const NFL_TEAMS = {
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens',
  BUF: 'Buffalo Bills', CAR: 'Carolina Panthers', CHI: 'Chicago Bears',
  CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns', DAL: 'Dallas Cowboys',
  DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers',
  HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars',
  KC: 'Kansas City Chiefs', LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams',
  LV: 'Las Vegas Raiders', MIA: 'Miami Dolphins', MIN: 'Minnesota Vikings',
  NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants',
  NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers',
  SEA: 'Seattle Seahawks', SF: 'San Francisco 49ers', TB: 'Tampa Bay Buccaneers',
  TEN: 'Tennessee Titans', WAS: 'Washington Commanders',
};

const FANTASY_POS = new Set(['QB', 'RB', 'WR', 'TE']);
const FETCH_TIMEOUT = 15_000;

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'roster-watch/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function main() {
  let cfg;
  try {
    cfg = await readJson(P('data/sleeper.json'));
  } catch {
    console.log('No data/sleeper.json — skipping Sleeper sync.');
    return;
  }
  if (!cfg.leagueId || !cfg.username) {
    console.log('sleeper.json incomplete — skipping.');
    return;
  }

  // 1. Find user's roster (lightweight calls)
  console.log(`Sleeper sync: league ${cfg.leagueId}, user ${cfg.username}`);
  const users = await fetchJson(`https://api.sleeper.app/v1/league/${cfg.leagueId}/users`);
  const user = users.find(u => u.display_name?.toLowerCase() === cfg.username.toLowerCase());
  if (!user) { console.error(`User "${cfg.username}" not in league.`); return; }

  const rosters = await fetchJson(`https://api.sleeper.app/v1/league/${cfg.leagueId}/rosters`);
  const roster = rosters.find(r => r.owner_id === user.user_id);
  if (!roster) { console.error(`No roster for ${cfg.username}.`); return; }

  const ids = (roster.players || []).sort();

  // 2. Short-circuit if unchanged
  let cached = [];
  try { cached = (await readJson(P('state/sleeper-roster-ids.json'))).ids; } catch {}
  if (JSON.stringify(ids) === JSON.stringify(cached)) {
    console.log('Roster unchanged — skipping full sync.');
    return;
  }
  console.log(`Roster changed (${ids.length} slots). Downloading player database...`);

  // 3. Separate defenses from humans
  const defIds = ids.filter(id => /^[A-Z]{2,3}$/.test(id));
  const humanIds = ids.filter(id => !/^[A-Z]{2,3}$/.test(id));

  // 4. Fetch full player DB (~70 MB, only when roster changed)
  const db = await fetchJson('https://api.sleeper.app/v1/players/nfl');

  const sleeperPlayers = [];
  for (const pid of humanIds) {
    const p = db[pid];
    if (!p) { console.warn(`  ? ID ${pid} not in Sleeper DB`); continue; }
    if (!FANTASY_POS.has(p.position)) continue;
    sleeperPlayers.push({
      sleeperId: pid,
      name: p.full_name || `${p.first_name} ${p.last_name}`,
      pos: p.position,
      team: p.team || 'FA',
    });
  }

  // 5. Load existing roster.json to preserve manual customizations
  let existing;
  try { existing = await readJson(P('data/roster.json')); }
  catch { existing = { players: [], teams: {} }; }

  const bySleeper = Object.fromEntries(existing.players.filter(p => p.sleeperId).map(p => [p.sleeperId, p]));
  const byName = Object.fromEntries(existing.players.map(p => [p.name.toLowerCase(), p]));
  function findByAlias(name) {
    const lower = name.toLowerCase();
    return existing.players.find(p => (p.aliases || []).some(a => a.toLowerCase() === lower));
  }

  // 6. Merge
  const merged = [];
  for (const sp of sleeperPlayers) {
    const prev = bySleeper[sp.sleeperId] || byName[sp.name.toLowerCase()] || findByAlias(sp.name);
    if (prev) {
      merged.push({ ...prev, sleeperId: sp.sleeperId, pos: sp.pos, team: sp.team, verified: true });
    } else {
      merged.push({
        id: slugify(sp.name), sleeperId: sp.sleeperId,
        name: sp.name, pos: sp.pos, team: sp.team,
        verified: true, aliases: [sp.name], exclude: [],
      });
      console.log(`  + ${sp.name} (${sp.pos}, ${sp.team})`);
    }
  }
  for (const p of existing.players) {
    if (!merged.some(m => m.name === p.name)) console.log(`  - ${p.name}`);
  }

  const posOrd = { QB: 0, RB: 1, WR: 2, TE: 3 };
  merged.sort((a, b) => (posOrd[a.pos] ?? 9) - (posOrd[b.pos] ?? 9) || a.name.localeCompare(b.name));

  // 7. Rebuild teams map
  const teams = {};
  for (const p of merged) if (p.team && NFL_TEAMS[p.team]) teams[p.team] = NFL_TEAMS[p.team];
  for (const d of defIds) if (NFL_TEAMS[d]) teams[d] = NFL_TEAMS[d];

  const out = {
    _comment: existing._comment || 'Managed by Sleeper sync + web editor. Manual alias/exclude edits are preserved across syncs.',
    _sleeper: { leagueId: cfg.leagueId, username: cfg.username, lastSync: new Date().toISOString() },
    players: merged,
    teams: Object.fromEntries(Object.entries(teams).sort(([a], [b]) => a.localeCompare(b))),
  };

  await fs.writeFile(P('data/roster.json'), JSON.stringify(out, null, 2) + '\n');
  await fs.mkdir(P('state'), { recursive: true });
  await fs.writeFile(P('state/sleeper-roster-ids.json'), JSON.stringify({ ids }));
  console.log(`Synced: ${merged.length} players, ${Object.keys(teams).length} teams.`);
}

main().catch(err => {
  console.error('Sleeper sync error (non-fatal):', err.message);
});
