/**
 * Pure logic: URL generation, matching, dedupe, RSS serialisation.
 * No network, no filesystem -- so scripts/selftest.mjs can exercise all of it.
 */

import crypto from 'node:crypto';

export const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Word-boundary alternation. This is the whole point of the rewrite: matching
 * "line" as a bare substring is what kills "goal line", "offensive line" and
 * "New Jersey". \b anchors handle hyphenated names (Smith-Njigba) correctly
 * because the hyphen is itself a boundary character.
 */
export function termsToRegex(terms) {
  const cleaned = (terms ?? []).filter(Boolean).map(escRe).sort((a, b) => b.length - a.length);
  if (!cleaned.length) return null;
  return new RegExp(`\\b(?:${cleaned.join('|')})\\b`, 'i');
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export const xmlEsc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export const stripTags = (s = '') =>
  String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------ feed URL build

export const googleNewsUrl = (query) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;

export const redditSearchUrl = (sub, query) =>
  `https://www.reddit.com/r/${sub}/search.rss?q=${encodeURIComponent(
    query
  )}&restrict_sr=1&sort=new&t=week`;

/**
 * Every generated URL derives from roster.json. Edit the roster, push, and all
 * of these regenerate -- no re-pasting boolean strings into five filter boxes.
 */
export function buildSources(roster, config) {
  const sources = [...(config.sources ?? [])];
  const gen = config.generated ?? {};

  for (const handle of config.bluesky?.handles ?? []) {
    sources.push({
      id: `bsky-${handle.replace(/[^a-z0-9]/gi, '-')}`,
      label: `Bluesky @${handle}`,
      url: `https://bsky.app/profile/${handle}/rss`,
      mode: 'roster',
    });
  }

  if (gen.googleNews?.enabled) {
    // Chunked because a 23-name OR string exceeds what Google News parses
    // reliably. Five per query keeps each URL comfortably short.
    chunk(roster.players, gen.googleNews.chunkSize || 5).forEach((group, i) => {
      sources.push({
        id: `gnews-players-${i + 1}`,
        label: `Google News: ${group.map((p) => p.name.split(' ').pop()).join(', ')}`,
        url: googleNewsUrl(group.map((p) => `"${p.name}"`).join(' OR ')),
        mode: 'roster',
      });
    });
  }

  if (gen.googleNewsTeams?.enabled) {
    // Tier 2. Query is just the team name; the buzzword requirement is applied
    // locally, where we control matching, rather than trusting Google's boolean
    // parser to honour a nested AND(...) group.
    for (const abbr of [...new Set(roster.players.map((p) => p.team))].sort()) {
      const full = roster.teams?.[abbr];
      if (!full) continue;
      sources.push({
        id: `gnews-team-${abbr.toLowerCase()}`,
        label: `Google News: ${full}`,
        url: googleNewsUrl(`"${full}"`),
        mode: 'team',
      });
    }
  }

  if (gen.redditSearch?.enabled) {
    chunk(roster.players, gen.redditSearch.chunkSize || 6).forEach((group, i) => {
      sources.push({
        id: `reddit-search-${i + 1}`,
        label: `r/${gen.redditSearch.subreddit} search ${i + 1}`,
        url: redditSearchUrl(
          gen.redditSearch.subreddit,
          group.map((p) => `"${p.name}"`).join(' OR ')
        ),
        mode: 'roster',
      });
    });
  }

  return sources;
}

// ------------------------------------------------------------------ matching

export function buildMatchers(roster, config) {
  return {
    playerMatchers: roster.players.map((p) => ({
      id: p.id,
      name: p.name,
      include: termsToRegex(p.aliases),
      exclude: termsToRegex(p.exclude),
    })),
    buzzword: termsToRegex(config.buzzwords),
    urgent: termsToRegex(config.urgent),
    globalExclude: termsToRegex(config.exclude),
  };
}

/**
 * Returns null to drop the item, or the item annotated with matched players
 * and an urgency flag.
 *
 * Note what is deliberately NOT here: a player name is never AND-gated behind
 * a buzzword. "Herbert questionable, ankle" contains no buzzword and must
 * still get through. The buzzword requirement applies only to team-wide feeds.
 */
export function classify(item, m) {
  const hay = `${item.title} ${item.summary ?? ''}`;

  if (m.globalExclude?.test(hay)) return null;

  const hits = [];
  for (const pm of m.playerMatchers) {
    if (!pm.include?.test(hay)) continue;
    if (pm.exclude?.test(hay)) continue;
    hits.push(pm.name);
  }

  const buzz = m.buzzword ? m.buzzword.test(hay) : false;

  if (hits.length === 0) {
    // Tier 2: team feeds may pass on depth-chart signal alone. Roster feeds
    // may not -- no player, no entry.
    if (item.mode !== 'team' || !buzz) return null;
  }

  return { ...item, players: hits, urgent: m.urgent ? m.urgent.test(hay) : false, buzz };
}

// -------------------------------------------------------------------- dedupe

export const normalizeTitle = (t) =>
  String(t)
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d'"]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

/**
 * Two keys per item. The exact key catches the same URL reappearing; the fuzzy
 * key (first eight normalized title words) catches one insider post syndicated
 * across thirty aggregators, which is the actual noise problem.
 */
export function keysFor(item) {
  const norm = normalizeTitle(item.title);
  return {
    exact: sha(String(item.guid || item.link || norm)),
    fuzzy: sha(norm.split(' ').slice(0, 8).join(' ')),
  };
}

// ------------------------------------------------------------------- rss out

export function toRss({ title, description, items, filename, siteUrl }) {
  const now = new Date().toUTCString();
  const entries = items
    .map((i) => {
      const tags = i.players?.length ? ` [${i.players.join(', ')}]` : ' [depth chart]';
      const d = new Date(i.published);
      const date = Number.isNaN(d.getTime()) ? now : d.toUTCString();
      return `    <item>
      <title>${xmlEsc(i.title + tags)}</title>
      <link>${xmlEsc(i.link)}</link>
      <guid isPermaLink="false">${xmlEsc(i.key)}</guid>
      <pubDate>${date}</pubDate>
      <source>${xmlEsc(i.source)}</source>
      <description>${xmlEsc(i.summary || i.title)}</description>
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${xmlEsc(title)}</title>
    <link>${xmlEsc(siteUrl)}</link>
    <description>${xmlEsc(description)}</description>
    <lastBuildDate>${now}</lastBuildDate>
    <ttl>10</ttl>
    <atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="${xmlEsc(
      `${siteUrl}/${filename}`
    )}" rel="self" type="application/rss+xml" />
${entries}
  </channel>
</rss>
`;
}
