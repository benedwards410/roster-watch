<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="html" encoding="UTF-8" />
<xsl:template match="/">
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title><xsl:value-of select="/rss/channel/title" /></title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;600&amp;family=IBM+Plex+Mono:wght@400;500;600&amp;display=swap" rel="stylesheet" />
<style>
  :root {
    --field:   #10161f;
    --chalk:   #e8eaed;
    --dim:     #6f7b8a;
    --rule:    #232d3a;
    --signal:  #f0a828;
    --live:    #3fb8a0;
    --pad: clamp(1.1rem, 4vw, 3rem);
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    background: var(--field);
    color: var(--chalk);
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 14px;
    line-height: 1.5;
    padding: var(--pad);
    max-width: 60rem;
  }
  .eyebrow {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    letter-spacing: .16em;
    text-transform: uppercase;
    color: var(--dim);
    margin: 0 0 .2rem;
  }
  h1 {
    font-family: 'Oswald', 'Arial Narrow', sans-serif;
    font-weight: 600;
    font-size: clamp(2.1rem, 8vw, 3.4rem);
    letter-spacing: -.01em;
    line-height: .95;
    margin: .2rem 0 .6rem;
    text-transform: uppercase;
  }
  .desc {
    color: var(--dim);
    font-size: 12px;
    margin: 0 0 1.2rem;
  }
  .filter-bar {
    display: flex;
    flex-wrap: wrap;
    gap: .5rem;
    align-items: center;
    margin-bottom: 1.2rem;
  }
  .filter-bar select, .filter-bar input {
    background: var(--field);
    color: var(--chalk);
    border: 1px solid var(--rule);
    padding: .5rem .75rem;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    letter-spacing: .05em;
    outline: none;
  }
  .filter-bar select { text-transform: uppercase; cursor: pointer; }
  .filter-bar input { flex: 1; min-width: 10rem; }
  .filter-bar select:focus, .filter-bar input:focus {
    border-color: var(--signal);
  }
  .filter-count {
    font-size: 11px;
    color: var(--dim);
    letter-spacing: .1em;
    text-transform: uppercase;
    margin-bottom: 1rem;
  }
  .nav {
    display: flex;
    flex-wrap: wrap;
    gap: .5rem;
    margin-bottom: 2.4rem;
  }
  .nav a {
    display: inline-block;
    padding: .5rem .85rem;
    border: 1px solid var(--rule);
    color: var(--chalk);
    text-decoration: none;
    font-size: 12px;
    letter-spacing: .05em;
    text-transform: uppercase;
  }
  .nav a:hover, .nav a:focus-visible {
    border-color: var(--signal);
    color: var(--signal);
  }
  .item {
    border-bottom: 1px solid var(--rule);
    padding: 1rem 0;
  }
  .item.hidden { display: none; }
  .item-title {
    font-family: 'Oswald', 'Arial Narrow', sans-serif;
    font-weight: 400;
    font-size: 1.15rem;
    line-height: 1.3;
    margin: 0 0 .3rem;
  }
  .item-title a {
    color: var(--chalk);
    text-decoration: none;
  }
  .item-title a:hover, .item-title a:focus-visible {
    color: var(--signal);
  }
  .item-meta {
    font-size: 11px;
    color: var(--dim);
    letter-spacing: .05em;
    margin-bottom: .4rem;
  }
  .item-meta .source {
    color: var(--live);
  }
  .item-summary {
    font-size: 13px;
    color: var(--dim);
    line-height: 1.55;
    margin: 0;
  }
  footer {
    margin-top: 3rem;
    color: var(--dim);
    font-size: 11px;
    line-height: 1.7;
  }
  footer a { color: var(--signal); }
</style>
</head>
<body>
  <p class="eyebrow">RSS Feed</p>
  <h1><xsl:value-of select="/rss/channel/title" /></h1>
  <p class="desc"><xsl:value-of select="/rss/channel/description" /></p>

  <div class="filter-bar">
    <select id="player-filter"><option value="">All players</option></select>
    <input id="text-filter" type="text" placeholder="Search headlines..." />
  </div>
  <div class="filter-count" id="filter-count"></div>

  <nav class="nav">
    <a href="all.xml">all.xml</a>
    <a href="urgent.xml">urgent.xml</a>
    <a href="status.json">status.json</a>
    <a href="./">status page</a>
    <a href="./#manage" onclick="this.href='./?manage=1'">manage</a>
  </nav>

  <div id="items">
    <xsl:for-each select="/rss/channel/item">
      <div class="item">
        <h2 class="item-title">
          <a target="_blank" rel="noopener">
            <xsl:attribute name="href"><xsl:value-of select="link" /></xsl:attribute>
            <xsl:value-of select="title" />
          </a>
        </h2>
        <div class="item-meta">
          <span class="source"><xsl:value-of select="source" /></span>
          <xsl:text> &#183; </xsl:text>
          <xsl:value-of select="pubDate" />
        </div>
        <p class="item-summary"><xsl:value-of select="description" /></p>
      </div>
    </xsl:for-each>
  </div>

  <footer>
    This is an RSS feed. Subscribe by copying the URL into your RSS reader.
    <br />
    <a href="./">Back to status page</a>
  </footer>

<script>
(function () {
  var items = document.querySelectorAll('#items .item');
  var playerSelect = document.getElementById('player-filter');
  var textInput = document.getElementById('text-filter');
  var countEl = document.getElementById('filter-count');
  var total = items.length;

  // Extract unique player names from [tag] brackets in titles
  var players = {};
  for (var i = 0; i &lt; items.length; i++) {
    var title = items[i].querySelector('.item-title').textContent;
    var m = title.match(/\[([^\]]+)\]/);
    if (m) {
      var names = m[1].split(', ');
      for (var j = 0; j &lt; names.length; j++) {
        var n = names[j].trim();
        if (n !== 'depth chart') players[n] = (players[n] || 0) + 1;
      }
    }
  }

  var sorted = Object.keys(players).sort();
  for (var k = 0; k &lt; sorted.length; k++) {
    var opt = document.createElement('option');
    opt.value = sorted[k];
    opt.textContent = sorted[k] + ' (' + players[sorted[k]] + ')';
    playerSelect.appendChild(opt);
  }

  function applyFilter() {
    var player = playerSelect.value.toLowerCase();
    var text = textInput.value.toLowerCase();
    var shown = 0;
    for (var i = 0; i &lt; items.length; i++) {
      var content = items[i].textContent.toLowerCase();
      var title = items[i].querySelector('.item-title').textContent;
      var tag = title.match(/\[([^\]]+)\]/);
      var tagText = tag ? tag[1].toLowerCase() : '';
      var matchPlayer = !player || tagText.indexOf(player) !== -1;
      var matchText = !text || content.indexOf(text) !== -1;
      if (matchPlayer &amp;&amp; matchText) {
        items[i].classList.remove('hidden');
        shown++;
      } else {
        items[i].classList.add('hidden');
      }
    }
    if (player || text) {
      countEl.textContent = shown + ' of ' + total + ' items';
    } else {
      countEl.textContent = '';
    }
  }

  playerSelect.addEventListener('change', applyFilter);
  textInput.addEventListener('input', applyFilter);
})();
</script>
</body>
</html>
</xsl:template>
</xsl:stylesheet>
