#!/usr/bin/env node
/**
 * Fantasy roster feed builder -- orchestration and IO only.
 * All filter logic lives in lib.mjs and is covered by selftest.mjs.
 *
 * Run locally: npm run build
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { buildSources, buildMatchers, classify, keysFor, stripTags, toRss } from './lib.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const P = (...parts) => path.join(ROOT, ...parts);

const SITE_URL = process.env.SITE_URL || 'https://example.netlify.app';
const UA = 'roster-feed-builder/1.0 (personal fantasy football filter)';
const FETCH_TIMEOUT_MS = 12_000;
const STATE_MAX = 6000;
const RETAIN_DAYS = 21;
const MAX_ITEMS = 400;

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'user-agent': UA,
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', trimValues: true });
const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const textOf = (v) => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object') return String(v['#text'] ?? '');
  return '';
};

/** Handles RSS 2.0 and Atom, which covers every source in config.json. */
export function parseFeed(xml, source) {
  let doc;
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }

  const out = [];

  for (const it of asArray(doc?.rss?.channel?.item)) {
    out.push({
      title: stripTags(textOf(it.title)),
      link: textOf(it.link),
      summary: stripTags(textOf(it.description)).slice(0, 600),
      published: textOf(it.pubDate) || textOf(it['dc:date']),
      guid: textOf(it.guid) || textOf(it.link),
      source: source.label,
      sourceId: source.id,
      mode: source.mode,
    });
  }

  for (const it of asArray(doc?.feed?.entry)) {
    const links = asArray(it.link);
    const href =
      links.find((l) => (l?.['@rel'] ?? 'alternate') === 'alternate')?.['@href'] ??
      links[0]?.['@href'] ??
      '';
    out.push({
      title: stripTags(textOf(it.title)),
      link: href,
      summary: stripTags(textOf(it.summary) || textOf(it.content)).slice(0, 600),
      published: textOf(it.published) || textOf(it.updated),
      guid: textOf(it.id) || href,
      source: source.label,
      sourceId: source.id,
      mode: source.mode,
    });
  }

  return out.filter((i) => i.title);
}

async function main() {
  const roster = await readJson(P('data/roster.json'));
  const config = await readJson(P('data/config.json'));
  const matchers = buildMatchers(roster, config);
  const sources = buildSources(roster, config);

  let state = { seen: {} };
  try {
    state = await readJson(P('state/seen.json'));
  } catch {
    /* first run */
  }

  const nowMs = Date.now();
  const health = [];
  const fresh = [];

  const results = await Promise.allSettled(
    sources.map(async (s) => {
      const started = Date.now();
      const xml = await fetchText(s.url);
      return { items: parseFeed(xml, s), ms: Date.now() - started };
    })
  );

  results.forEach((r, idx) => {
    const s = sources[idx];
    if (r.status !== 'fulfilled') {
      health.push({
        id: s.id,
        label: s.label,
        mode: s.mode,
        ok: false,
        error: String(r.reason?.message ?? r.reason).slice(0, 120),
        raw: 0,
        kept: 0,
      });
      return;
    }
    const { items, ms } = r.value;
    let kept = 0;
    for (const raw of items) {
      const item = classify(raw, matchers);
      if (!item) continue;
      const { exact, fuzzy } = keysFor(item);
      if (state.seen[exact] || state.seen[fuzzy]) continue;
      state.seen[exact] = nowMs;
      state.seen[fuzzy] = nowMs;
      fresh.push({ ...item, key: exact, firstSeen: nowMs });
      kept++;
    }
    health.push({ id: s.id, label: s.label, mode: s.mode, ok: true, ms, raw: items.length, kept });
  });

  // Rolling window of what has already gone out, so the feed files stay stable
  // for readers instead of emptying out between runs.
  let archive = [];
  try {
    archive = (await readJson(P('state/archive.json'))).items ?? [];
  } catch {
    /* first run */
  }
  const cutoff = nowMs - RETAIN_DAYS * 86_400_000;
  archive = [...fresh, ...archive]
    .filter((i) => (i.firstSeen ?? nowMs) > cutoff)
    .slice(0, MAX_ITEMS);

  // Prune dedupe state so the file does not grow without bound.
  state.seen = Object.fromEntries(
    Object.entries(state.seen)
      .filter(([, t]) => t > cutoff)
      .sort((a, b) => b[1] - a[1])
      .slice(0, STATE_MAX)
  );

  const urgent = archive.filter((i) => i.urgent);

  await fs.mkdir(P('public'), { recursive: true });
  await fs.mkdir(P('state'), { recursive: true });

  await fs.writeFile(
    P('public/all.xml'),
    toRss({
      title: 'Roster Watch - all player news',
      description: 'Every item matching a rostered player, deduped across sources.',
      items: archive,
      filename: 'all.xml',
      siteUrl: SITE_URL,
    })
  );

  await fs.writeFile(
    P('public/urgent.xml'),
    toRss({
      title: 'Roster Watch - urgent only',
      description: 'Availability and role changes only. Point your email service at this one.',
      items: urgent,
      filename: 'urgent.xml',
      siteUrl: SITE_URL,
    })
  );

  const status = {
    builtAt: new Date().toISOString(),
    sources: health.sort((a, b) => Number(a.ok) - Number(b.ok) || b.kept - a.kept),
    counts: {
      sources: sources.length,
      ok: health.filter((h) => h.ok).length,
      failed: health.filter((h) => !h.ok).length,
      newThisRun: fresh.length,
      inAllFeed: archive.length,
      inUrgentFeed: urgent.length,
    },
    roster: roster.players.map((p) => ({
      name: p.name,
      pos: p.pos,
      team: p.team,
      verified: p.verified,
      recent: archive.filter((i) => i.players?.includes(p.name)).length,
    })),
  };

  await fs.writeFile(P('public/status.json'), JSON.stringify(status, null, 2));
  await fs.writeFile(P('state/seen.json'), JSON.stringify(state));
  await fs.writeFile(P('state/archive.json'), JSON.stringify({ items: archive }));

  console.log(
    `${status.counts.ok}/${sources.length} sources ok, ${fresh.length} new, ` +
      `${archive.length} in all.xml, ${urgent.length} urgent`
  );
  for (const h of health.filter((x) => !x.ok)) console.warn(`  FAILED ${h.id}: ${h.error}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
