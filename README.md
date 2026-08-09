# Roster Watch

Filtered, deduped RSS for one fantasy football roster. Two output feeds, one
roster file, no monthly bill.

```
data/roster.json ──┐
                   ├─► scripts/build.mjs ──► public/all.xml     ──► your RSS reader
data/config.json ──┘      (GitHub Actions)   public/urgent.xml  ──► Blogtrottr ──► email
                                             public/status.json ──► the status page
```

Netlify runs no code. The Action builds the XML and commits it; Netlify serves
`public/` as static files. That keeps everything on the static free tier
instead of burning function credits.

## Setup

**1. Create a *public* GitHub repo and push this directory.**

Public is not optional. At `*/10` this runs ~4,300 build-minutes a month, and
private repos on the free plan cap at 2,000. Public repos get unlimited Actions
minutes. There are no secrets in here — nothing to protect.

**2. Enable Actions write access.**
Settings → Actions → General → Workflow permissions → *Read and write*.
The workflow commits the generated feeds back to the repo.

**3. Run it once by hand.**
Actions tab → *Build roster feeds* → Run workflow. Then read the log. Every
source that 403s or times out is listed at the end. Delete the dead ones from
`data/config.json` and re-run. Expect to lose one or two — publishers change
their feed URLs constantly.

**4. Connect Netlify.**
Add new site → import from GitHub → pick the repo. `netlify.toml` already sets
publish directory and content types, so accept the defaults. Then set the
`SITE_URL` Actions variable (Settings → Secrets and variables → Actions →
Variables) to your Netlify URL so the feeds carry correct self-links.

**5. Wire up email.**
Sign up at Blogtrottr (free), subscribe to `https://YOURSITE.netlify.app/urgent.xml`,
delivery *realtime*. Point it at `urgent.xml` only — `all.xml` will bury you.

**6. Subscribe in your reader.**
Add `https://YOURSITE.netlify.app/all.xml` to any free reader on your phone.
No paid rules engine needed; the filtering already happened.

## Editing your roster

`data/roster.json` is the only file you touch. Change a name, push, and every
Google News query, Reddit search, team feed, and filter regex regenerates. Run
`npm test` before pushing — the suite catches typos that would otherwise fail
silently.

Each player takes:

| Field | Purpose |
|---|---|
| `aliases` | Every form the news uses. Full name always; add a last name only if it's distinctive (`Okonkwo`, `Etienne`, `Joly`) — never `Williams` or `Taylor`. |
| `exclude` | Terms that mean this is a different person. |
| `team` | Drives the tier-2 team feed only. |
| `verified` | Whether the team was confirmed against a primary source. |

**Weekly routine, ~2 minutes:** after waivers process, edit `roster.json`,
`npm test`, push. Feeds catch up on the next run.

**Late August:** final cuts will churn several of these players. Re-check the
whole file once after cuts, not player by player before then.

## Why the exclusion list is short

The obvious instinct is to block everything annoying. Don't. Most filter
engines match substrings, so `line` silently kills *goal line*, *offensive
line*, *sideline* and *deadline*; `jersey` kills *New Jersey*; `shop` kills
*workshop*. This build matches on word boundaries and keeps the block list to
gambling and merchandise, where false positives are cheap. `npm test` asserts
each of those cases.

The other rule: **player names are never AND-gated behind a buzzword.** A
requirement like `"Justin Herbert" AND ("depth chart" OR "snaps")` reads as
precision but discards *"Herbert questionable, ankle"* — the one item that
actually matters. Buzzwords gate only the team-wide feeds, where there's no
player name to anchor on.

## Tuning

| Symptom | Fix |
|---|---|
| Too much volume | Trim `buzzwords` in `config.json`; drop the noisiest team feeds (the status page ranks them by kept/raw). |
| Missing a player entirely | Their name isn't in `aliases` in a form the press uses, or an `exclude` term is too broad. |
| Same story five times | Lengthen the fuzzy dedupe window in `lib.mjs` (`slice(0, 8)` → `slice(0, 6)`). |
| Email too chatty | Remove soft terms from `urgent` — `touches`, `workload`, `signed`. |
| Feed goes stale | Check `/status.json`. A source that's been failing for days needs replacing. |

## Known limits

- **Feed reachability is unverified.** The seeded URLs in `config.json` are
  best-known-good patterns, not confirmed live. Your first Actions run is the
  real test.
- **Reddit may 403 datacenter IPs.** If the Reddit sources fail persistently,
  set `redditSearch.enabled: false` and lean on Google News. Reddit is a
  nice-to-have, not load-bearing.
- **GitHub cron is best-effort** and can lag 5–15 minutes under load. The
  workflow tightens to `*/5` during the Sunday 10am–4pm ET window, but that
  narrows the gap rather than closing it. Keep your league app's native push
  notification as the backstop for inactives.
- **Actions disables scheduled workflows after 60 days of repo inactivity.**
  Your weekly roster edits will normally prevent this. In the offseason it
  will go quiet — expect to click the re-enable button in August.
- **18 of 23 team assignments are marked `verified: false`.** They came from
  your original notes and pre-season knowledge. A wrong team only degrades the
  tier-2 feed, not name matching, so it fails soft — but the status page flags
  them so you can fix them as you notice.
- **Bluesky handles are empty on purpose.** Add insiders you've confirmed
  yourself in a browser; guessed handles produce silent dead feeds.

## Commands

```bash
npm install
npm test      # 33 assertions on the filter logic, no network
npm run build # full fetch + build, writes public/ and state/
```
