/**
 * Single-file site template (design doc §B.2). Deterministic: no timestamps,
 * fixed structure — same input always renders byte-identical HTML. The data
 * is embedded as <script type="application/json" id="aitp-data"> (non
 * executable) and rendered by one inline vanilla-JS script (no framework, no
 * build step). Visual tokens reuse the panel design system (§A.2, dark).
 *
 * Note: the renderer script deliberately avoids backslashes and template
 * literals so the emitted HTML stays free of scanner-tripping sequences.
 */
import type { SiteData } from './site-entry.js';

export interface RenderOptions {
  siteTitle: string;
  siteUrl?: string;
}

export function renderHtml(data: SiteData, options: RenderOptions): string {
  const title = escapeHtml(options.siteTitle);
  const canonical = options.siteUrl
    ? `  <link rel="canonical" href="${escapeHtml(options.siteUrl)}">\n`
    : '';
  const json = JSON.stringify({ entries: data.entries }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#0d1117">
  <meta name="description" content="AI Tools Panel 静态目录：只读展示已编目的 Skill、Plugin、Marketplace、Hook 与 RuleFragment 条目。">
${canonical}  <title>${title}</title>
  <style>
:root {
  color-scheme: dark;
  /* 画布（GitHub Dark 系）— 与面板 §A.2 tokens 保持一致（测试护栏） */
  --bg: #0d1117;
  --surface: #161b22;
  --raised: #21262d;
  --border: #30363d;
  --border-strong: #484f58;
  --text: #e6edf3;
  --text-muted: #8b949e;
  --accent: #58a6ff;
  --accent-emphasis: #1f6feb;
  --success: #3fb950; --success-bg: rgba(63,185,80,.15);
  --warning: #d29922; --warning-bg: rgba(210,153,34,.15);
  --danger: #f85149;  --danger-bg: rgba(248,81,73,.15);
  --purple: #a371f7;  --teal: #39c5cf; --orange: #f0883e;
  --font-sans: system-ui, 'Segoe UI', sans-serif;
  --font-mono: ui-monospace, 'Cascadia Code', Consolas, monospace;
  --radius: 6px; --radius-lg: 10px;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font-sans); line-height: 1.5; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code { font-family: var(--font-mono); font-size: 0.8em; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: var(--radius); }

header.site { border-bottom: 1px solid var(--border); background: var(--surface); padding: 1.25rem 1.5rem; }
header.site h1 { margin: 0; font-size: 1.25rem; letter-spacing: 0.01em; }
header.site .tagline { margin: 0.15rem 0 0; color: var(--text-muted); font-size: 0.85rem; }

main { max-width: 1200px; margin: 0 auto; padding: 1.25rem 1.5rem 3rem; }

.toolbar { display: flex; flex-direction: column; gap: 0.6rem; margin-bottom: 1rem; }
.toolbar input[type="search"] { background: var(--raised); border: 1px solid var(--border); color: var(--text); border-radius: var(--radius); padding: 0.45rem 0.75rem; font-size: 0.95rem; max-width: 420px; }
.toolbar input[type="search"]:focus { border-color: var(--accent); outline: none; }
.chips { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
.chips .chip-label { color: var(--text-muted); font-size: 0.8rem; margin-right: 0.15rem; }
button.chip { background: var(--raised); border: 1px solid var(--border); color: var(--text); border-radius: 999px; padding: 0.2rem 0.75rem; font-size: 0.82rem; cursor: pointer; }
button.chip:hover { border-color: var(--border-strong); }
button.chip[aria-pressed="true"] { background: var(--accent-emphasis); border-color: var(--accent); color: #ffffff; }
.count { color: var(--text-muted); font-size: 0.8rem; font-family: var(--font-mono); margin: 0; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 0.75rem; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 0.85rem 0.9rem; display: flex; flex-direction: column; gap: 0.4rem; transition: transform 80ms ease, border-color 80ms ease; }
.card:hover { border-color: var(--accent); transform: translateY(-1px); }
.card h3 { margin: 0; font-size: 1rem; }
.card h3 a { color: var(--text); }
.card h3 a:hover { color: var(--accent); }
.card .desc { margin: 0; color: var(--text-muted); font-size: 0.88rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.card .eid { color: var(--text-muted); font-size: 0.75rem; word-break: break-all; }
.tags { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.tag { border: 1px solid var(--border); border-radius: 999px; padding: 0 0.5rem; font-size: 0.72rem; color: var(--text-muted); }

.badge { display: inline-block; font-family: var(--font-mono); font-size: 0.72rem; border-radius: var(--radius); padding: 0 0.45rem; border: 1px solid; width: fit-content; }
.badge.kind-skill { color: var(--accent); border-color: var(--accent); background: rgba(88,166,255,.15); }
.badge.kind-plugin { color: var(--purple); border-color: var(--purple); background: rgba(163,113,247,.15); }
.badge.kind-marketplace { color: var(--teal); border-color: var(--teal); background: rgba(57,197,207,.15); }
.badge.kind-hook { color: var(--orange); border-color: var(--orange); background: rgba(240,136,62,.15); }
.badge.kind-rulefragment { color: var(--warning); border-color: var(--warning); background: var(--warning-bg); }
.badge.status-confirmed { color: var(--success); border-color: var(--success); background: var(--success-bg); }
.badge.status-candidate { color: var(--warning); border-color: var(--warning); background: var(--warning-bg); }
.badge.status-incompatible { color: var(--danger); border-color: var(--danger); background: var(--danger-bg); }
.badge.status-unknown { color: var(--text-muted); border-color: var(--border-strong); }

.detail { max-width: 860px; }
.detail .head { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.detail h2 { margin: 0; font-size: 1.3rem; }
.detail section { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 0.9rem 1rem; margin-top: 0.9rem; }
.detail section h3 { margin: 0 0 0.5rem; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.detail dl { margin: 0; display: grid; grid-template-columns: minmax(120px, max-content) 1fr; gap: 0.35rem 1rem; }
.detail dt { color: var(--text-muted); font-size: 0.85rem; }
.detail dd { margin: 0; font-size: 0.92rem; overflow-wrap: anywhere; }
.muted { color: var(--text-muted); }
a.back { display: inline-block; margin-bottom: 0.75rem; font-size: 0.9rem; }

.empty { text-align: center; padding: 3.5rem 1rem; color: var(--text-muted); }
.empty h2 { color: var(--text); margin: 0 0 0.35rem; }
.empty p { margin: 0; }

footer.site { border-top: 1px solid var(--border); color: var(--text-muted); font-size: 0.78rem; text-align: center; padding: 1rem; }

@media (max-width: 640px) {
  main { padding: 1rem; }
  .detail dl { grid-template-columns: 1fr; }
  .detail dt { margin-top: 0.4rem; }
}
  </style>
</head>
<body>
  <header class="site">
    <h1>${title}</h1>
    <p class="tagline">只读静态目录 · 数据经字段白名单投影与安全门扫描后生成</p>
  </header>
  <main id="app" aria-live="polite"></main>
  <footer class="site">aitp-site-gen 生成 · 仅包含白名单字段 · 未展示内容不代表不存在</footer>
  <script type="application/json" id="aitp-data">${json}</script>
  <script>
${renderer()}
  </script>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The ~200-line vanilla renderer. Plain ES2017, no framework. */
function renderer(): string {
  return String.raw`
(function () {
  'use strict';
  var KINDS = ['Skill', 'Plugin', 'Marketplace', 'Hook', 'RuleFragment'];
  var dataEl = document.getElementById('aitp-data');
  var ENTRIES = [];
  try { ENTRIES = (JSON.parse(dataEl.textContent) || {}).entries || []; } catch (e) { ENTRIES = []; }
  var state = { kind: 'all', tag: '', q: '' };
  var app = document.getElementById('app');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function presentKinds() {
    var seen = {};
    ENTRIES.forEach(function (e) { seen[e.kind] = true; });
    return KINDS.filter(function (k) { return seen[k]; });
  }

  function presentTags() {
    var seen = {};
    ENTRIES.forEach(function (e) { (e.tags || []).forEach(function (t) { seen[t] = true; }); });
    return Object.keys(seen).sort();
  }

  function filtered() {
    var q = state.q.toLowerCase();
    return ENTRIES.filter(function (e) {
      if (state.kind !== 'all' && e.kind !== state.kind) return false;
      if (state.tag && (e.tags || []).indexOf(state.tag) === -1) return false;
      if (q) {
        var hay = [e.displayName, e.shortDescription, e.id].concat(e.tags || []).join(' | ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function badge(kind) {
    return '<span class="badge kind-' + esc(kind.toLowerCase()) + '">' + esc(kind) + '</span>';
  }

  function cardHtml(e) {
    var tags = (e.tags || []).map(function (t) { return '<span class="tag">#' + esc(t) + '</span>'; }).join('');
    return '<article class="card" aria-label="' + esc(e.displayName) + ' (' + esc(e.kind) + ')">' +
      badge(e.kind) +
      '<h3><a href="#/entry/' + encodeURIComponent(e.id) + '">' + esc(e.displayName) + '</a></h3>' +
      '<p class="desc">' + esc(e.shortDescription || '（无简述）') + '</p>' +
      (tags ? '<div class="tags">' + tags + '</div>' : '') +
      '<code class="eid">' + esc(e.id) + '</code>' +
      '</article>';
  }

  function emptyHtml(title, hint) {
    return '<div class="empty" role="status"><h2>' + esc(title) + '</h2><p>' + esc(hint) + '</p></div>';
  }

  function renderToolbar() {
    var kinds = ['all'].concat(presentKinds());
    var tags = presentTags();
    var html = '<section class="toolbar">' +
      '<input id="q" type="search" placeholder="搜索名称、简述、标签、ID…" aria-label="全文搜索" value="' + esc(state.q) + '">' +
      '<div class="chips" role="group" aria-label="kind 筛选"><span class="chip-label">类型</span>' +
      kinds.map(function (k) {
        var label = k === 'all' ? '全部' : k;
        return '<button type="button" class="chip" data-kind="' + esc(k) + '" aria-pressed="' + (state.kind === k) + '">' + esc(label) + '</button>';
      }).join('') +
      '</div>';
    if (tags.length) {
      html += '<div class="chips" role="group" aria-label="标签筛选"><span class="chip-label">标签</span>' +
        tags.map(function (t) {
          return '<button type="button" class="chip" data-tag="' + esc(t) + '" aria-pressed="' + (state.tag === t) + '">#' + esc(t) + '</button>';
        }).join('') +
        '</div>';
    }
    html += '<p class="count" role="status" id="count"></p></section><div id="results"></div>';
    app.innerHTML = html;
    document.getElementById('q').addEventListener('input', function (ev) {
      state.q = ev.target.value;
      updateResults();
    });
    app.querySelector('.toolbar').addEventListener('click', function (ev) {
      var btn = ev.target.closest('button.chip');
      if (!btn) return;
      if (btn.hasAttribute('data-kind')) {
        var k = btn.getAttribute('data-kind');
        state.kind = state.kind === k ? 'all' : k;
      }
      if (btn.hasAttribute('data-tag')) {
        var t = btn.getAttribute('data-tag');
        state.tag = state.tag === t ? '' : t;
      }
      syncChips();
      updateResults();
    });
    updateResults();
  }

  function syncChips() {
    app.querySelectorAll('button.chip[data-kind]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-kind') === state.kind));
    });
    app.querySelectorAll('button.chip[data-tag]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-tag') === state.tag));
    });
  }

  function updateResults() {
    var list = filtered();
    document.getElementById('count').textContent = list.length + ' / ' + ENTRIES.length + ' 个条目';
    document.getElementById('results').innerHTML = list.length
      ? '<div class="grid">' + list.map(cardHtml).join('') + '</div>'
      : (ENTRIES.length
        ? emptyHtml('没有匹配的条目', '请调整类型、标签或搜索关键词。')
        : emptyHtml('暂无目录条目', 'catalog/ 目录当前为空；将条目纳入目录并提交后，这里会展示只读卡片。'));
  }

  function detailRow(dt, dd) {
    return '<dt>' + esc(dt) + '</dt><dd>' + dd + '</dd>';
  }

  function renderDetail(idRaw) {
    var id = decodeURIComponent(idRaw);
    var e = null;
    for (var i = 0; i < ENTRIES.length; i++) { if (ENTRIES[i].id === id) { e = ENTRIES[i]; break; } }
    if (!e) {
      app.innerHTML = '<a class="back" href="#">返回列表</a>' + emptyHtml('条目不存在', '哈希指向的条目不在本快照中：' + id);
      return;
    }
    var lic = e.license && e.license.expression
      ? e.license.status + '（' + esc(e.license.expression) + '）'
      : e.license.status;
    var src = esc(e.source.type);
    if (e.source.url) {
      src += ' · <a href="' + esc(e.source.url) + '" rel="noopener noreferrer">' + esc(e.source.url) + '</a>';
    }
    if (e.source.identifier) src += ' · <code>' + esc(e.source.identifier) + '</code>';
    var instKeys = Object.keys(e.installInstructions || {}).sort();
    var inst = instKeys.length
      ? '<dl>' + instKeys.map(function (k) {
          return detailRow(k, '<code>' + esc(e.installInstructions[k]) + '</code>');
        }).join('') + '</dl>'
      : '<p class="muted">（无安装说明）</p>';
    var tags = (e.tags || []).map(function (t) { return '<span class="tag">#' + esc(t) + '</span>'; }).join(' ');
    var targets = (e.targets || []).map(function (t) { return '<code>' + esc(t) + '</code>'; }).join(' ');
    app.innerHTML =
      '<div class="detail">' +
      '<a class="back" href="#">返回列表</a>' +
      '<div class="head">' + badge(e.kind) + '<h2>' + esc(e.displayName) + '</h2></div>' +
      '<p class="muted"><code>' + esc(e.id) + '</code></p>' +
      (e.shortDescription ? '<p>' + esc(e.shortDescription) + '</p>' : '') +
      (tags ? '<div class="tags">' + tags + '</div>' : '') +
      '<section><h3>来源</h3><dl>' +
        detailRow('类型 / URL', src) +
        detailRow('ownership', esc(e.ownership)) +
        detailRow('contentPolicy', esc(e.contentPolicy)) +
        (targets ? detailRow('targets', targets) : '') +
      '</dl></section>' +
      '<section><h3>许可证</h3><dl>' +
        detailRow('状态', '<span class="badge status-' + esc(e.license.status) + '">' + esc(e.license.status) + '</span>' + (e.license.expression ? ' <code>' + esc(e.license.expression) + '</code>' : '')) +
      '</dl></section>' +
      '<section><h3>安装说明</h3>' + inst + '</section>' +
      '<section><h3>备注</h3>' + (e.notes ? '<p>' + esc(e.notes) + '</p>' : '<p class="muted">（无备注）</p>') + '</section>' +
      '</div>';
  }

  function route() {
    var m = /^#\/entry\/(.+)$/.exec(location.hash);
    if (m) renderDetail(m[1]);
    else renderToolbar();
  }

  window.addEventListener('hashchange', route);
  route();
})();
`;
}
