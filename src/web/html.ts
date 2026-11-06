import type { Attachment, ProvenanceEntry, RecordEnvelope } from "../lib/types.js";
import {
  BODY_KEYS,
  TITLE_KEYS,
  looksLikeMarkdown,
  recordBody,
  recordTitle,
  recordUrl,
} from "../lib/format.js";
import { NS_PATTERN, safeSegment } from "../lib/paths.js";
import { isUlid } from "../lib/ulid.js";

export const VIEW_NAMES = new Set(["record", "card", "gallery", "article"]);
export type ViewName = "record" | "card" | "gallery" | "article";

export const LIST_PAGE_SIZE = 100;

export function esc(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/** Links are restricted to http/https/mailto; anything else renders as text. */
export function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:") {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve a `hub:` place reference to a same-origin `/n/` path.
 * `hub:<path>` uses `ns`. `hub://<namespace>/<path>` names the namespace and ignores `ns`.
 * Returns null when the value is not a hub reference or any segment is unsafe.
 */
export function hubHref(value: string, ns?: string | null): { href: string; label: string } | null {
  if (!value.startsWith("hub:")) return null;
  if (/[\s\\]/.test(value)) return null;

  let namespace: string;
  let pathPart: string;
  let label: string;
  if (value.startsWith("hub://")) {
    const rest = value.slice("hub://".length);
    const slash = rest.indexOf("/");
    if (slash === -1) {
      namespace = rest;
      pathPart = "";
      label = rest;
    } else {
      namespace = rest.slice(0, slash);
      pathPart = rest.slice(slash + 1);
      if (!pathPart) return null;
      label = rest;
    }
    if (!NS_PATTERN.test(namespace) || namespace === "schemas") return null;
  } else {
    if (!ns || !NS_PATTERN.test(ns) || ns === "schemas") return null;
    namespace = ns;
    pathPart = value.slice("hub:".length);
    if (!pathPart) return null;
    label = pathPart;
  }

  const segments = pathPart.length === 0 ? [] : pathPart.split("/");
  if (segments.some((segment) => !safeSegment(segment))) return null;
  return {
    href: `/n/${[namespace, ...segments].map((segment) => encodeURIComponent(segment)).join("/")}`,
    label,
  };
}

export function viewOf(schema: Record<string, unknown>): ViewName {
  const x = schema["x-assethub"];
  if (typeof x === "object" && x !== null && !Array.isArray(x)) {
    const view = (x as Record<string, unknown>)["view"];
    if (typeof view === "string" && VIEW_NAMES.has(view)) return view as ViewName;
  }
  return "record";
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

function fmtDate(iso: string): string {
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

function fmtNumber(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

const MARK = `<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="3.2"/><rect x="3" y="10.4" width="13.5" height="3.2"/><rect x="3" y="16.3" width="8.5" height="3.2"/></svg>`;

const CSS = `
:root{
  --bg:#e4ebe8; --surface:#f4f7f5;
  --ink:#15201c; --soft:#3a4a44; --mut:#5d6e67; --faint:#8a9a93;
  --line:#c9d5d0; --line-strong:#b3c2bc;
  --accent:#1e5f6b; --accent-soft:#d5e6e4;
  --display:"Iowan Old Style","Palatino Linotype","Palatino","Songti SC","STSong",serif;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
  --radius:3px;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.6 var(--sans);}
a{color:inherit;text-decoration:none}
a:hover{color:var(--accent)}
::selection{background:var(--accent-soft)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:var(--radius)}

.topbar{position:sticky;top:0;z-index:10;background:rgba(228,235,232,.94);border-bottom:1px solid var(--line)}
.topbar .inner{max-width:960px;margin:0 auto;display:flex;align-items:center;gap:12px;padding:11px 24px}
.brand{display:flex;align-items:center;gap:8px;font-family:var(--display);font-weight:600;font-size:18px;letter-spacing:-.02em;flex-shrink:0}
.brand .mark{width:20px;height:20px;fill:var(--accent);display:block}
.breadcrumbs{font-family:var(--mono);font-size:12.5px;color:var(--mut);display:flex;align-items:center;gap:7px;min-width:0;overflow:hidden;white-space:nowrap;flex:1}
.breadcrumbs a:hover{color:var(--ink)}
.breadcrumbs .sep{color:var(--faint)}
.breadcrumbs .tail{color:var(--ink);overflow:hidden;text-overflow:ellipsis}
.search{display:flex;gap:6px;flex-shrink:0;margin-left:auto}
.search input{width:180px;font:13px/1.4 inherit;padding:6px 10px;border:1px solid var(--line-strong);border-radius:var(--radius);background:var(--surface);color:var(--ink)}
.search input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
.search button{font:13px/1 inherit;font-weight:550;padding:6px 11px;border:1px solid var(--ink);border-radius:var(--radius);background:var(--ink);color:var(--surface);cursor:pointer}
.search button:hover{border-color:var(--accent);color:var(--accent)}

main{max-width:960px;margin:0 auto;padding:36px 24px 88px}

.page-head{margin:0 0 22px}
.page-head h1{font-family:var(--display);font-size:28px;font-weight:600;letter-spacing:-.02em;line-height:1.25;margin:0 0 8px}
.page-head .sub{color:var(--mut);font-size:13px;display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.muted{color:var(--mut)}
.mono{font-family:var(--mono)}

.section-title{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--mut);margin:30px 0 8px}

.list{border-top:1px solid var(--line)}
.row{display:flex;align-items:center;gap:14px;padding:13px 2px;border-bottom:1px solid var(--line)}
a.row:hover .title{color:var(--accent)}
.row .badge{flex-shrink:0}
.row .grow{flex:1;min-width:0}
.row .title{display:block;font-weight:550;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .desc{display:block;color:var(--mut);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .meta{flex-shrink:0;color:var(--mut);font-size:12.5px;font-variant-numeric:tabular-nums;white-space:nowrap}

details.ns{border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);margin:0 0 10px}
details.ns>summary{display:flex;align-items:center;gap:14px;padding:14px 16px;cursor:pointer;list-style:none}
details.ns>summary::-webkit-details-marker{display:none}
details.ns>summary .grow{flex:1;min-width:0}
details.ns>summary .title{display:block;font-weight:600;font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
details.ns>summary .desc{display:block;color:var(--mut);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
details.ns>summary .meta{flex-shrink:0;color:var(--mut);font-size:12.5px;font-variant-numeric:tabular-nums;white-space:nowrap}
details.ns>summary::after{content:"▸";flex-shrink:0;color:var(--faint);font-size:12px}
details.ns[open]>summary::after{content:"▾"}
details.ns>summary:hover .title{color:var(--accent)}
details.ns[open]>summary{border-bottom:1px solid var(--line)}
.ns-body{padding:14px 16px 16px}
.ns-body .list{border-top:0}
.ns-body .chips{margin-bottom:12px}
.ns-note{margin:10px 0 0;font-size:13px}
.ns-open{margin-top:14px}

.badge{display:inline-block;font-family:var(--mono);font-size:11px;line-height:1;padding:4px 7px;border:1px solid var(--line-strong);border-radius:var(--radius);color:var(--mut);background:var(--surface)}
.badge.accent{color:var(--accent);border-color:var(--accent);background:var(--accent-soft)}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-block;font-size:12px;line-height:1.2;padding:3px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent);border:1px solid transparent}
.chip.plain{background:var(--surface);color:var(--soft);border-color:var(--line-strong)}
details.chips-details>summary{display:flex;flex-wrap:wrap;gap:6px;align-items:center;cursor:pointer;list-style:none}
details.chips-details>summary::-webkit-details-marker{display:none}
details.chips-details>summary::after{content:"▾";flex-shrink:0;font-size:11px;color:var(--faint);padding:0 2px}
details.chips-details[open]>summary::after{content:"▴"}
details.chips-details[open]>summary{margin-bottom:6px}
details.chips-details[open]>summary .chip.more{display:none}
.filters{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}
.filters a{font-size:12.5px}
.filters a.is-on{color:var(--accent);font-weight:600}

table.fields{width:100%;border-collapse:collapse;font-size:14px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
table.fields th,table.fields td{text-align:left;padding:10px 16px;border-bottom:1px solid var(--line);vertical-align:top}
table.fields tr:last-child th,table.fields tr:last-child td{border-bottom:0}
table.fields th{font-family:var(--mono);font-weight:400;font-size:12px;color:var(--mut);white-space:nowrap;width:1%;padding-top:12px}
table.fields td{color:var(--ink)}
table.kv{display:inline-table;border-collapse:collapse;font-size:13px;border:1px solid var(--line);border-radius:6px;overflow:hidden}
table.kv td{padding:5px 12px;border-bottom:1px solid var(--line)}
table.kv tr:last-child td{border-bottom:0}
table.kv .kv-key{font-family:var(--mono);font-weight:500;color:var(--mut);white-space:nowrap;border-right:1px solid var(--line);background:var(--bg)}
table.kv .kv-val{font-variant-numeric:tabular-nums;color:var(--ink)}

.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}
table.records{width:100%;border-collapse:collapse;font-size:13.5px}
table.records th,table.records td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
table.records th{font-family:var(--mono);font-size:11px;font-weight:500;color:var(--mut);text-transform:uppercase;letter-spacing:.06em;background:var(--bg)}
table.records tr:last-child td{border-bottom:0}
table.records a.title{font-weight:550}
table.records a.title:hover{color:var(--accent)}
table.records .num{font-variant-numeric:tabular-nums;white-space:nowrap}

.prose{white-space:pre-wrap;line-height:1.75;font-size:15.5px;color:var(--soft)}
.prose.md{white-space:normal}
.prose.md h1,.prose.md h2,.prose.md h3{color:var(--ink);letter-spacing:-.01em;line-height:1.35;margin:1.4em 0 .5em}
.prose.md h1{font-size:1.35em}.prose.md h2{font-size:1.18em}.prose.md h3{font-size:1.05em}
.prose.md p{margin:.7em 0}
.prose.md ul,.prose.md ol{margin:.5em 0 .8em;padding-left:1.3em}
.prose.md li{margin:.25em 0}
.prose.md code{font-family:var(--mono);font-size:.86em;background:var(--surface);border:1px solid var(--line);border-radius:4px;padding:.05em .35em}
.prose.md pre{font-family:var(--mono);font-size:13px;line-height:1.55;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:14px 16px;overflow-x:auto;white-space:pre}
.prose.md pre code{background:none;border:0;padding:0;font-size:inherit}
.prose.md a{color:var(--accent);text-decoration:underline;text-underline-offset:3px}
.prose.md h1,.prose.md h2,.prose.md h3,.prose.md h4,.prose.md h5,.prose.md h6{scroll-margin-top:72px}
.prose.md h4,.prose.md h5,.prose.md h6{color:var(--ink);line-height:1.4;margin:1.2em 0 .4em}
.prose.md h4{font-size:1em}.prose.md h5,.prose.md h6{font-size:.95em;color:var(--soft)}
.prose.md li>ul,.prose.md li>ol{margin:.2em 0 .2em;padding-left:1.2em}
.prose.md li.task{list-style:none;margin-left:-1.1em}
.prose.md input[type=checkbox]{margin:0 .45em 0 0;vertical-align:middle}
.prose.md blockquote{margin:1em 0;padding:.1em 0 .1em 14px;border-left:3px solid var(--line-strong);color:var(--mut)}
.prose.md blockquote p{margin:.5em 0}
.prose.md hr{border:0;border-top:1px solid var(--line);margin:1.6em 0}
.prose.md img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}
.prose.md del{color:var(--mut)}
.prose.md .table-wrap{margin:1em 0;overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}
.prose.md table.md-table{width:100%;border-collapse:collapse;font-size:14px;line-height:1.55}
.prose.md table.md-table th,.prose.md table.md-table td{padding:7px 12px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}
.prose.md table.md-table th{font-family:var(--mono);font-size:11.5px;font-weight:500;text-transform:uppercase;letter-spacing:.05em;color:var(--mut);background:var(--bg);white-space:nowrap}
.prose.md table.md-table tr:last-child td{border-bottom:0}

.section-title.with-action{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.section-title .mini{font-size:11.5px;letter-spacing:0;text-transform:none;color:var(--accent)}
.section-title .mini:hover{text-decoration:underline;text-underline-offset:3px}

.doc{max-width:780px;margin:0 auto}
.doc-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:5px 16px;padding:0 0 14px;border-bottom:1px solid var(--line)}
.doc-file{font-family:var(--mono);font-size:13px;color:var(--ink)}
.doc-sub{color:var(--mut);font-size:12.5px}
.doc-sub a,.doc-actions a{color:var(--accent);text-decoration:underline;text-underline-offset:3px}
.doc-actions{margin-left:auto;display:flex;gap:14px;font-size:12.5px;white-space:nowrap}
.doc .prose.md{font-size:16.5px;line-height:1.85;color:var(--ink)}
.doc .prose.md h1{font-family:var(--display);font-size:2em;font-weight:600;letter-spacing:-.02em;line-height:1.3;margin:.25em 0 .55em}
.doc .prose.md h2{font-family:var(--display);font-size:1.42em;font-weight:600;line-height:1.4;margin:1.7em 0 .6em;padding-top:.35em;border-top:1px solid var(--line)}
.doc .prose.md h3{font-size:1.1em;margin-top:1.5em}
.doc .prose.md p{margin:.85em 0}
.doc .prose.md .table-wrap{margin:1.2em 0}
.doc .prose.md table.md-table{font-size:13.5px}
.toc{margin:16px 0 4px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);padding:10px 16px;font-size:13.5px}
.toc>summary{cursor:pointer;font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--mut)}
.toc>summary::-webkit-details-marker{display:none}
.toc>summary::after{content:"▾";float:right;color:var(--faint);font-size:11px}
.toc[open]>summary::after{content:"▴"}
.toc ol{list-style:none;margin:9px 0 2px;padding:0;display:flex;flex-direction:column;gap:4px}
.toc li.lvl-3{padding-left:16px}
.toc a{color:var(--soft)}
.toc a:hover{color:var(--accent)}

.imgs{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin:22px 0}
.imgs figure{margin:0}
.imgs img{width:100%;display:block;aspect-ratio:16/10;object-fit:cover;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}
.imgs figcaption{font-family:var(--mono);font-size:11.5px;color:var(--mut);margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

ul.atts{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}
ul.atts li{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:11px 16px;border-bottom:1px solid var(--line);font-size:14px}
ul.atts li:last-child{border-bottom:0}
ul.atts .name{font-family:var(--mono);font-size:13px;color:var(--ink)}
ul.atts a:hover .name{color:var(--accent)}
ul.atts .meta{color:var(--mut);font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums}
ul.atts .att-dl{font-size:12px;color:var(--accent);white-space:nowrap}
ul.atts .att-dl:hover{text-decoration:underline;text-underline-offset:3px}

.btn{display:inline-flex;align-items:center;gap:7px;font-size:13.5px;font-weight:550;padding:8px 15px;border:1px solid var(--ink);border-radius:var(--radius);background:var(--ink);color:var(--surface)}
.btn:hover{background:var(--accent);border-color:var(--accent);color:var(--surface)}
.btn .arrow{font-family:var(--mono)}

.view-card{max-width:640px;margin:0 auto;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:26px 28px}
.view-card .head{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.view-card .avatar{width:36px;height:36px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:650;font-size:15px;flex-shrink:0}
.view-card .who{flex:1;min-width:0;display:flex;flex-direction:column}
.view-card .author{font-weight:600;font-size:14.5px}
.view-card .time{color:var(--mut);font-size:12px}
.view-card .prose{font-size:15px}
.view-card .imgs{margin-top:18px}
.catalog{max-width:720px}
.catalog h1{font-family:var(--display);font-size:28px;font-weight:600;line-height:1.3;letter-spacing:-.02em;margin:0 0 12px}
.catalog .metrics{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}

.view-article{max-width:680px;margin:0 auto}
.view-article h1{font-family:var(--display);font-size:32px;font-weight:600;line-height:1.3;letter-spacing:-.025em;margin:0 0 10px}
.view-article .byline{color:var(--mut);font-size:13.5px;padding-bottom:18px;border-bottom:1px solid var(--line);margin-bottom:26px}
.view-article .prose{font-size:16.5px;line-height:1.9;color:var(--ink)}

.gallery-first .imgs{grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}

.obj-list{display:flex;flex-direction:column;gap:10px}
.obj-card{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px 14px}
.obj-card .obj-title{font-weight:600;margin:0 0 6px}
.obj-card .chips{margin-top:8px}
.obj-card .obj-note{color:var(--soft);font-size:13.5px;margin:8px 0 0}

.source-line{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:baseline;padding:12px 0;border-bottom:1px solid var(--line);font-size:13.5px}
.source-line:last-child{border-bottom:0}
.source-line .src-url{color:var(--accent);overflow:hidden;text-overflow:ellipsis}
.source-line .src-note{color:var(--soft);flex:1 1 100%}

.pager{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:22px 0 0;font-size:13px;color:var(--mut)}
.pager .btns{display:flex;gap:8px}

.empty{border:1px dashed var(--line-strong);border-radius:var(--radius);padding:46px 24px;text-align:center;color:var(--mut)}
.empty h1{font-size:18px;color:var(--ink);margin:0 0 8px}
.empty p{margin:0}
.empty code{font-family:var(--mono);font-size:12.5px;background:var(--surface);border:1px solid var(--line);border-radius:4px;padding:1px 5px;color:var(--soft)}

footer{max-width:960px;margin:0 auto;padding:0 24px 44px;color:var(--faint);font-size:12px;font-family:var(--mono)}
@media(max-width:640px){
  .topbar .inner{padding:10px 16px;gap:8px}
  .search input{width:120px}
  main{padding:28px 16px 72px}
  .row .meta{display:none}
}
`;

export interface Crumb {
  label: string;
  href?: string;
}

export interface LayoutOpts {
  searchNs?: string;
  searchQ?: string;
}

function renderBreadcrumbs(crumbs: Crumb[]): string {
  const parts = crumbs.map((c, i) => {
    const last = i === crumbs.length - 1;
    const label = esc(c.label);
    if (last) return `<span class="tail">${label}</span>`;
    return c.href !== undefined ? `<a href="${esc(c.href)}">${label}</a>` : `<span>${label}</span>`;
  });
  return `<nav class="breadcrumbs" aria-label="path">${parts.join('<span class="sep">/</span>')}</nav>`;
}

function searchForm(opts: LayoutOpts): string {
  const ns = opts.searchNs ? `<input type="hidden" name="namespace" value="${esc(opts.searchNs)}">` : "";
  const q = opts.searchQ ?? "";
  return `<form class="search" action="/q" method="get" role="search"><input type="search" name="q" placeholder="搜索" value="${esc(q)}" aria-label="搜索">${ns}<button type="submit">搜索</button></form>`;
}

export function layout(title: string, crumbs: Crumb[], body: string, opts: LayoutOpts = {}): string {
  const trail = crumbs.length ? renderBreadcrumbs(crumbs) : "";
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · AssetHub</title>
<style>${CSS}</style>
</head>
<body>
<!-- THESIS: a local archive you read, not a JSON admin. OWN-WORLD: cool green-gray paper, forest accent, Iowan/Songti titles, three-bar stack. STORY: browse namespaces, open a record, read. FIRST VIEWPORT: brand, path, search, catalog heading. FORM: catalog hall. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md -->
<header class="topbar"><div class="inner"><a class="brand" href="/">${MARK}AssetHub</a>${trail}${searchForm(opts)}</div></header>
<main>
${body}
</main>
<footer>read-only view · writes happen through the assethub CLI</footer>
</body>
</html>`;
}

export function errorPage(status: number, message: string): string {
  return layout(`Error ${status}`, [{ label: "error" }], `<div class="empty"><h1>${status}</h1><p>${esc(message)}</p></div>`);
}

/** Cheap readiness page: no directory walk, so a health probe stays fast even on huge trees. */
export function healthPage(): string {
  return `<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>AssetHub</title></head>
<body>ok</body>
</html>`;
}

// ------------------------------------------------------------------ home page

export interface NamespaceFolder {
  name: string;
  href: string;
  records: number;
  schemaHint: string;
}

export interface NamespaceCard {
  id: string;
  name: string;
  goal: string;
  records: number;
  schemas: { id: string; count: number }[];
  folders: NamespaceFolder[];
  topRecords: number;
}

function namespaceBody(n: NamespaceCard): string {
  const parts: string[] = [];
  if (n.schemas.length) {
    parts.push(
      `      <div class="chips">${n.schemas
        .map((s) => `<span class="chip plain">${esc(s.id)} ${fmtNumber(s.count)}</span>`)
        .join("")}</div>`,
    );
  }
  if (n.folders.length) {
    const rows = n.folders
      .map(
        (f) => `        <a class="row" href="${esc(f.href)}">
          <span class="grow"><span class="title">${esc(f.name)}</span>${f.schemaHint ? `<span class="desc">${esc(f.schemaHint)}</span>` : ""}</span>
          <span class="meta">${f.records} records</span>
        </a>`,
      )
      .join("\n");
    parts.push(`      <div class="list">\n${rows}\n      </div>`);
  }
  if (n.topRecords) {
    parts.push(`      <p class="muted ns-note">${n.topRecords} records 直接放在该空间下。</p>`);
  }
  if (!n.records) {
    parts.push(`      <p class="muted ns-note">空空间。</p>`);
  }
  return parts.join("\n");
}

export function namespacePage(items: NamespaceCard[]): string {
  const rows = items
    .map(
      (n) => `    <details class="ns">
      <summary>
        <span class="grow"><span class="title">${esc(n.name)}</span><span class="desc">${esc(n.id)}${n.goal ? ` · ${esc(n.goal)}` : ""}</span></span>
        <span class="meta">${n.records} records</span>
      </summary>
      <div class="ns-body">
${namespaceBody(n)}
        <a class="btn ns-open" href="/n/${encodeURIComponent(n.id)}">打开项目空间 <span class="arrow">→</span></a>
      </div>
    </details>`,
    )
    .join("\n");
  const body = items.length
    ? `  <div class="page-head"><h1>项目空间</h1><div class="sub">数据根下的第一层文件夹，一个项目一份。点击展开看栏目与 schema。</div></div>\n  <div class="nss">\n${rows}\n  </div>`
    : `  <div class="empty"><h1>还没有项目空间</h1><p>用 <code>assethub namespace add &lt;id&gt;</code> 创建，或运行 <code>assethub demo</code>。</p></div>`;
  return layout("项目空间", [], body);
}

// -------------------------------------------------------------- folder browser

export interface FolderEntry {
  name: string;
  href: string;
  records: number;
  schemaHint?: string;
}

export interface RecordEntry {
  id: string;
  href: string;
  title: string;
  schema: string;
  created: string;
  subtitle: string;
  data: Record<string, unknown>;
}

export interface FolderPageInput {
  ns: string;
  sub: string[];
  folders: FolderEntry[];
  records: RecordEntry[];
  goal?: string;
  page: number;
  pageSize: number;
  totalRecords: number;
  schemaFilter?: string;
  schemas?: { id: string; count: number }[];
  tableColumns?: string[] | null;
}

function pageHref(base: string, page: number, schema?: string): string {
  const params = new URLSearchParams();
  if (schema) params.set("schema", schema);
  if (page > 1) params.set("page", String(page));
  const q = params.toString();
  return q ? `${base}?${q}` : base;
}

function schemaFilters(base: string, schemas: { id: string; count: number }[], current?: string): string {
  if (schemas.length <= 1) return "";
  const all = schemas.reduce((n, s) => n + s.count, 0);
  const pills = [
    `<a class="${current ? "" : "is-on"}" href="${esc(pageHref(base, 1))}">all ${all}</a>`,
    ...schemas.map(
      (s) =>
        `<a class="${current === s.id ? "is-on" : ""}" href="${esc(pageHref(base, 1, s.id))}">${esc(s.id)} ${s.count}</a>`,
    ),
  ];
  return `  <nav class="filters" aria-label="schema">${pills.join("\n    ")}</nav>`;
}

function pager(base: string, page: number, pageSize: number, total: number, schema?: string): string {
  if (total <= pageSize) return "";
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const prev = page > 1 ? `<a class="btn" href="${esc(pageHref(base, page - 1, schema))}">← previous</a>` : "";
  const next = page < pages ? `<a class="btn" href="${esc(pageHref(base, page + 1, schema))}">next →</a>` : "";
  return `  <div class="pager"><span>${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}</span><span class="btns">${prev}${next}</span></div>`;
}

function isShortValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (typeof value === "string") return value.length <= 80 && !value.includes("\n");
  // Long arrays (e.g. thousands of chapter titles) never make good table columns.
  if (Array.isArray(value)) return value.length <= 8 && value.every((v) => typeof v === "string" || typeof v === "number");
  return false;
}

/** Choose compact table columns when a folder is a homogeneous short-field inventory. */
export function tableColumnsFor(records: RecordEntry[]): string[] | null {
  if (records.length < 4) return null;
  const schemas = new Set(records.map((r) => r.schema));
  if (schemas.size !== 1) return null;
  const longCount = records.filter((r) => {
    const fake: RecordEnvelope = {
      schemaVersion: 1,
      id: r.id,
      namespace: "",
      schema: r.schema,
      data: r.data,
      files: [],
      created_at: r.created,
      updated_at: r.created,
    };
    return recordBody(fake).length > 160;
  }).length;
  if (longCount > records.length * 0.2) return null;
  const keyCounts = new Map<string, number>();
  for (const r of records) {
    for (const [k, v] of Object.entries(r.data ?? {})) {
      if (!isShortValue(v)) continue;
      if (TITLE_KEYS.includes(k as (typeof TITLE_KEYS)[number]) && recordTitle({
        schemaVersion: 1, id: r.id, namespace: "", schema: r.schema, data: r.data, files: [], created_at: "", updated_at: "",
      }) === String(v)) continue;
      keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
    }
  }
  const keys = [...keyCounts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([k]) => k)
    .filter((k) => k !== "tags" || keyCounts.size <= 6)
    .slice(0, 6);
  if (keys.length < 3) return null;
  return keys;
}

function recordsTable(records: RecordEntry[], columns: string[], ns: string): string {
  const head = columns.map((c) => `<th>${esc(c)}</th>`).join("");
  const rows = records
    .map((r) => {
      const cells = columns
        .map((c) => {
          const rendered = renderValue(r.data?.[c], { compact: true, ns });
          const num = typeof r.data?.[c] === "number" ? " class=\"num\"" : "";
          return `<td${num}>${rendered}</td>`;
        })
        .join("");
      return `    <tr><td><a class="title" href="${esc(r.href)}" title="${esc(r.id)}">${esc(r.title)}</a></td>${cells}</tr>`;
    })
    .join("\n");
  return `  <div class="table-wrap"><table class="records">\n    <thead><tr><th>title</th>${head}</tr></thead>\n    <tbody>\n${rows}\n    </tbody></table></div>`;
}

function recordsList(records: RecordEntry[]): string {
  return `  <div class="list">\n${records
    .map(
      (r) => `    <a class="row" href="${esc(r.href)}" title="${esc(r.id)}">
      <span class="badge accent">${esc(r.schema)}</span>
      <span class="grow"><span class="title">${esc(r.title)}</span>${r.subtitle ? `<span class="desc">${esc(r.subtitle)}</span>` : ""}</span>
      <span class="meta">${esc(r.created)}</span>
    </a>`,
    )
    .join("\n")}\n  </div>`;
}

export function folderPage(input: FolderPageInput): string {
  const { ns, sub, folders, records, goal, page, pageSize, totalRecords, schemaFilter, schemas, tableColumns } = input;
  const crumbs: Crumb[] = [{ label: ns, href: `/n/${encodeURIComponent(ns)}` }];
  sub.forEach((segment, i) => {
    const href = `/n/${[ns, ...sub.slice(0, i + 1)].map(encodeURIComponent).join("/")}`;
    crumbs.push({ label: segment, href });
  });
  const base = `/n/${[ns, ...sub].map(encodeURIComponent).join("/")}`;
  const parts: string[] = [];
  if (folders.length) {
    parts.push(
      `  <div class="section-title">目录</div>\n  <div class="list">\n${folders
        .map(
          (f) => `    <a class="row" href="${esc(f.href)}">
      <span class="grow"><span class="title">${esc(f.name)}</span>${f.schemaHint ? `<span class="desc">${esc(f.schemaHint)}</span>` : ""}</span>
      <span class="meta">${f.records} records</span>
    </a>`,
        )
        .join("\n")}\n  </div>`,
    );
  }
  if (schemas && schemas.length) parts.push(schemaFilters(base, schemas, schemaFilter));
  if (records.length) {
    parts.push(`  <div class="section-title">记录</div>`);
    parts.push(tableColumns && tableColumns.length ? recordsTable(records, tableColumns, ns) : recordsList(records));
    parts.push(pager(base, page, pageSize, totalRecords, schemaFilter));
  } else if (!folders.length) {
    parts.push(`  <div class="empty"><p>This folder is empty.</p></div>`);
  }
  const heading = sub.length ? sub[sub.length - 1] ?? ns : ns;
  const subBits = [`<span class="badge">${esc(ns)}</span>`];
  if (goal) subBits.push(`<span>${esc(goal)}</span>`);
  if (totalRecords) subBits.push(`<span class="muted">${totalRecords} records</span>`);
  const body = `  <div class="page-head"><h1>${esc(heading)}</h1><div class="sub">${subBits.join("")}</div></div>\n${parts.join("\n")}`;
  return layout(`${ns}/${sub.join("/")}`, crumbs, body, { searchNs: ns });
}

export interface SearchPageInput {
  q: string;
  ns?: string;
  schema?: string;
  hits: RecordEntry[];
}

export function searchPage(input: SearchPageInput): string {
  const { q, ns, schema, hits } = input;
  const crumbs: Crumb[] = [{ label: "search" }];
  const scope = [ns ? `namespace ${ns}` : "all namespaces", schema ? `schema ${schema}` : ""].filter(Boolean).join(" · ");
  const head = `  <div class="page-head"><h1>${q ? esc(q) : "Search"}</h1><div class="sub">${esc(scope)} · ${hits.length} hits</div></div>`;
  const list = hits.length
    ? recordsList(hits)
    : `  <div class="empty"><p>${q ? "No records match this query." : "Type a query in the search box."}</p></div>`;
  const layoutOpts: LayoutOpts = { searchQ: q };
  if (ns) layoutOpts.searchNs = ns;
  return layout(q ? `Search · ${q}` : "Search", crumbs, `${head}\n${list}`, layoutOpts);
}

// ----------------------------------------------------------------- record page

export interface TextAttachment {
  name: string;
  mime: string;
  text: string;
}

export interface RecordPageInput {
  env: RecordEnvelope;
  ns: string;
  /** Record folder path under the namespace, including the record folder name. */
  segs: string[];
  view: ViewName;
  rawBase: string;
  /** Base href of the attachment reader under /n; when set, text attachments link there. */
  readBase?: string;
  textFiles?: TextAttachment[];
}

const PROSE_KEY_SET = new Set<string>(BODY_KEYS);

function imageGrid(files: Attachment[], rawBase: string): string {
  const images = files.filter((f) => f.mime.startsWith("image/"));
  if (!images.length) return "";
  return images
    .map(
      (f) => `      <figure><img src="${esc(`${rawBase}/${encodeURIComponent(f.name)}`)}" alt="${esc(f.name)}" loading="lazy"><figcaption>${esc(f.name)}</figcaption></figure>`,
    )
    .join("\n");
}

const READABLE_MIMES = new Set(["text/markdown", "text/plain", "text/csv"]);

function attachmentsList(files: Attachment[], rawBase: string, readBase?: string): string {
  if (!files.length) return "";
  const rows = files
    .map((f) => {
      const href = `${rawBase}/${encodeURIComponent(f.name)}`;
      const readable = readBase !== undefined && READABLE_MIMES.has(f.mime);
      const nameHref = readable ? `${readBase}/${encodeURIComponent(f.name)}` : href;
      const image = f.mime.startsWith("image/");
      const hint = readable ? " · 阅读" : image ? "" : " · download";
      const download = readable ? `<a class="att-dl" href="${esc(href)}">下载</a>` : "";
      return `    <li><a class="att-name" href="${esc(nameHref)}"><span class="name">${esc(f.name)}</span></a><span class="meta">${esc(f.mime)} · ${fmtBytes(f.bytes)}${hint}</span>${download}</li>`;
    })
    .join("\n");
  return `  <div class="section-title">Attachments</div>\n  <ul class="atts">\n${rows}\n  </ul>`;
}

function textPreviews(files: TextAttachment[] | undefined, readBase?: string, rawBase?: string, ns?: string): string {
  if (!files?.length) return "";
  return files
    .map((f) => {
      const markdown = f.mime === "text/markdown" || looksLikeMarkdown(f.text);
      const rendered = markdown
        ? renderMarkdown(f.text, rawBase !== undefined ? { base: rawBase, ns } : { ns })
        : `<pre>${esc(f.text)}</pre>`;
      const action = readBase
        ? `<a class="mini" href="${esc(`${readBase}/${encodeURIComponent(f.name)}`)}">独立阅读 →</a>`
        : "";
      const title = action
        ? `<div class="section-title with-action"><span>${esc(f.name)}</span>${action}</div>`
        : `<div class="section-title">${esc(f.name)}</div>`;
      return `  ${title}\n  <div class="prose md">${rendered}</div>`;
    })
    .join("\n");
}

/** Chip rows longer than `max` collapse: preview in the row, the rest behind a details toggle (or a plain "+N more" when not expandable). */
function chipsFor(value: unknown, opts: { max?: number; expandable?: boolean; ns?: string | undefined } = {}): string {
  if (!Array.isArray(value) || value.length === 0) return "";
  const bits = value
    .filter((v) => typeof v === "string" && v.trim())
    .map((v) => {
      const s = String(v);
      if (isUlid(s)) return `<a class="chip" href="/r/${encodeURIComponent(s)}">${esc(s)}</a>`;
      const place = hubHref(s, opts.ns);
      if (place) return `<a class="chip" href="${esc(place.href)}">${esc(place.label)}</a>`;
      return `<span class="chip">${esc(s)}</span>`;
    });
  if (!bits.length) return "";
  const max = opts.max;
  if (max === undefined || bits.length <= max) return `<span class="chips">${bits.join("")}</span>`;
  const head = bits.slice(0, max);
  const rest = bits.slice(max);
  const more = `<span class="chip plain more">+${rest.length} more</span>`;
  if (!opts.expandable) return `<span class="chips">${head.join("")}${more}</span>`;
  return `<details class="chips-details"><summary>${head.join("")}${more}</summary><div class="chips">${rest.join("")}</div></details>`;
}

function objectCards(value: unknown, ns?: string | undefined): string {
  if (!Array.isArray(value) || value.length === 0) return "";
  if (!value.every((v) => typeof v === "object" && v !== null && !Array.isArray(v))) return "";
  const cards = (value as Record<string, unknown>[]).map((obj) => {
    const title = typeof obj.label === "string" ? obj.label : typeof obj.title === "string" ? obj.title : typeof obj.name === "string" ? obj.name : "";
    const note = typeof obj.note === "string" ? obj.note : "";
    const keywords = Array.isArray(obj.keywords) ? chipsFor(obj.keywords, { ns }) : "";
    const rest = Object.entries(obj)
      .filter(([k]) => !["label", "title", "name", "note", "keywords"].includes(k))
      .map(([k, v]) => {
        const shown = typeof v === "string" ? renderValue(v, { compact: true, ns }) : esc(typeof v === "number" ? fmtNumber(v) : typeof v === "boolean" ? String(v) : JSON.stringify(v));
        return `<span class="chip plain">${esc(k)}: ${shown}</span>`;
      })
      .join("");
    return `<div class="obj-card">${title ? `<div class="obj-title">${esc(title)}</div>` : ""}${keywords}${rest ? `<div class="chips">${rest}</div>` : ""}${note ? `<p class="obj-note">${esc(note)}</p>` : ""}</div>`;
  });
  return `<div class="obj-list">${cards.join("")}</div>`;
}

function ulidHref(value: string): string | null {
  return isUlid(value) ? `/r/${encodeURIComponent(value)}` : null;
}

function renderValue(value: unknown, opts: { compact?: boolean; ns?: string | undefined } = {}): string {
  if (typeof value === "string") {
    const href = safeHref(value);
    if (href) return `<a href="${esc(href)}" rel="noreferrer">${esc(value)}</a>`;
    const idHref = ulidHref(value);
    if (idHref) return `<a href="${esc(idHref)}" class="mono">${esc(value)}</a>`;
    const place = hubHref(value, opts.ns);
    if (place) return `<a href="${esc(place.href)}">${esc(place.label)}</a>`;
    const trimmed = value.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          return renderKV(parsed, opts.ns);
        }
      } catch { /* not valid JSON, fall through */ }
    }
    if (!opts.compact && (value.includes("\n") || value.length > 160)) {
      return looksLikeMarkdown(value) ? `<div class="prose md">${renderMarkdown(value, { ns: opts.ns })}</div>` : `<div class="prose">${esc(value)}</div>`;
    }
    return esc(value);
  }
  if (typeof value === "number") return esc(fmtNumber(value));
  if (typeof value === "boolean") return esc(String(value));
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string")) {
      return chipsFor(value, { max: opts.compact ? 8 : 12, expandable: !opts.compact, ns: opts.ns }) || `<span class="muted">—</span>`;
    }
    const cards = objectCards(value, opts.ns);
    if (cards) return cards;
    if (value.every((v) => typeof v === "number")) return esc(value.map((v) => fmtNumber(v as number)).join(", "));
    return esc(value.map((v) => String(v)).join(", "));
  }
  if (value === null || value === undefined) return `<span class="muted">—</span>`;
  if (typeof value === "object") return renderKV(value as Record<string, unknown>, opts.ns);
  return esc(JSON.stringify(value));
}

function renderKV(obj: Record<string, unknown>, ns?: string | undefined): string {
  const entries = Object.entries(obj);
  if (entries.length === 0) return `<span class="muted">—</span>`;
  const rows = entries.map(([k, v]) => {
    const display = typeof v === "string"
      ? renderValue(v, { compact: true, ns })
      : esc(typeof v === "number" ? fmtNumber(v) : String(v));
    return `<tr><td class="kv-key">${esc(k)}</td><td class="kv-val">${display}</td></tr>`;
  });
  return `<table class="kv">${rows.join("")}</table>`;
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

function fieldsTable(env: RecordEnvelope, skip: string[] = [], ns: string = env.namespace): string {
  const skipSet = new Set(skip);
  const rows = Object.entries(env.data ?? {})
    .filter(([key, value]) => !skipSet.has(key) && !isEmptyValue(value))
    .map(([key, value]) => {
      const rendered = renderValue(value, { ns });
      return `    <tr><th>${esc(key)}</th><td>${rendered}</td></tr>`;
    })
    .join("\n");
  if (!rows) return "";
  return `  <table class="fields">\n${rows}\n  </table>`;
}

function proseBlocks(env: RecordEnvelope, skip: string[] = [], ns: string = env.namespace): { html: string; used: string[] } {
  const skipSet = new Set(skip);
  const used: string[] = [];
  const parts: string[] = [];
  for (const [key, value] of Object.entries(env.data ?? {})) {
    if (skipSet.has(key) || typeof value !== "string" || !value.trim()) continue;
    const long = PROSE_KEY_SET.has(key) || value.includes("\n") || value.length > 160;
    if (!long) continue;
    used.push(key);
    const body = looksLikeMarkdown(value) ? `<div class="prose md">${renderMarkdown(value, { ns })}</div>` : `<div class="prose">${esc(value)}</div>`;
    const label = key === "content" || key === "excerpt" || key === "summary" || used.length === 1 && skipSet.has("title") ? "" : `  <div class="section-title">${esc(key)}</div>\n`;
    parts.push(`${label}${body}`);
  }
  return { html: parts.join("\n"), used };
}

function firstUrl(env: RecordEnvelope): string | null {
  const raw = recordUrl(env);
  return raw ? safeHref(raw) : null;
}

function recordAuthor(env: RecordEnvelope): string {
  for (const key of ["author", "name"]) {
    const v = env.data?.[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return env.namespace;
}

function cardTime(env: RecordEnvelope): string {
  for (const key of ["published_at", "fetched_at", "captured_at", "created_at"]) {
    const v = env.data?.[key];
    if (typeof v === "string" && v.length > 0) return fmtDate(v);
  }
  return fmtDate(env.created_at);
}

function badges(env: RecordEnvelope, extra: string[] = []): string {
  const parts = [`<span class="badge accent">${esc(env.schema)}</span>`];
  for (const b of extra) parts.push(`<span class="badge">${esc(b)}</span>`);
  const status = env.data?.["status"];
  if (typeof status === "string" && status) parts.push(`<span class="badge">${esc(status)}</span>`);
  return parts.join("");
}

function metaLine(env: RecordEnvelope, extra: string[] = []): string {
  const chips = [badges(env, extra)];
  if (typeof env.created_at === "string") chips.push(`<span class="muted">created ${esc(fmtDate(env.created_at))}</span>`);
  return chips.join(" ");
}

function originalButton(env: RecordEnvelope): string {
  const link = firstUrl(env);
  return link ? `    <p><a class="btn" href="${esc(link)}" rel="noreferrer">查看原文 <span class="arrow">→</span></a></p>` : "";
}

function metricChips(env: RecordEnvelope, ns: string = env.namespace): { html: string; used: string[] } {
  const used: string[] = [];
  const bits: string[] = [];
  for (const [key, value] of Object.entries(env.data ?? {})) {
    if (typeof value === "number") {
      used.push(key);
      bits.push(`<span class="chip plain">${esc(fmtNumber(value))} ${esc(key)}</span>`);
    }
    if (key === "metrics" && typeof value === "object" && value !== null && !Array.isArray(value)) {
      used.push(key);
      for (const [mk, mv] of Object.entries(value as Record<string, unknown>)) {
        if (typeof mv === "number") bits.push(`<span class="chip plain">${esc(fmtNumber(mv))} ${esc(mk)}</span>`);
      }
    }
  }
  const tags = chipsFor(env.data?.["tags"], { ns });
  if (tags) used.push("tags");
  const html = bits.length || tags ? `<div class="metrics">${bits.join("")}${tags}</div>` : "";
  return { html, used };
}

function provenanceBlock(entries: ProvenanceEntry[] | undefined): string {
  if (!entries?.length) return "";
  const lines = entries.map((source) => {
    const href = safeHref(source.url);
    const urlBit = href
      ? `<a class="src-url" href="${esc(href)}" rel="noreferrer">${esc(source.url)}</a>`
      : `<span class="mono">${esc(source.url)}</span>`;
    const who = source.author ? `<span>${esc(source.author)}</span>` : "";
    const when = source.published_at || source.fetched_at
      ? `<span class="muted">${esc(fmtDate(source.published_at || source.fetched_at))}</span>`
      : "";
    const srcId = source.source_id
      ? `<a class="mono" href="/r/${encodeURIComponent(source.source_id)}">${esc(source.source_id)}</a>`
      : "";
    const note = source.notes ? `<span class="src-note">${esc(source.notes)}</span>` : "";
    return `    <div class="source-line">${urlBit}${who}${when}${srcId}${note}</div>`;
  });
  return `  <div class="section-title">Sources</div>\n  <div>${lines.join("\n")}\n  </div>`;
}

function socialCard(env: RecordEnvelope, body: string, title: string, grid: string): string {
  const platform = typeof env.data?.["platform"] === "string" ? String(env.data["platform"]) : "";
  const author = recordAuthor(env);
  const initial = [...author.trim()][0] ?? "?";
  return `  <article class="view-card">
    <div class="head">
      <span class="avatar">${esc(initial)}</span>
      <span class="who"><span class="author">${esc(author)}</span><span class="time">${esc(platform ? `${platform} · ` : "")}${esc(cardTime(env))}</span></span>
    </div>
    <div class="prose">${esc(body || title)}</div>
    ${grid ? `    <div class="imgs">\n${grid}\n    </div>` : ""}
    ${originalButton(env)}
  </article>`;
}

function catalogCard(env: RecordEnvelope, body: string, title: string, grid: string, ns: string = env.namespace): { html: string; used: string[] } {
  const metrics = metricChips(env, ns);
  const prose = body
    ? looksLikeMarkdown(body)
      ? `<div class="prose md">${renderMarkdown(body, { ns })}</div>`
      : `<div class="prose">${esc(body)}</div>`
    : "";
  const used = [...metrics.used, ...BODY_KEYS.filter((k) => env.data?.[k] === body), ...TITLE_KEYS.filter((k) => env.data?.[k] === title), ...["url", "html_url", "github_url", "skill_md_url", "link", "source"]];
  const html = `  <article class="catalog">
    <h1>${esc(title)}</h1>
    ${metrics.html}
    ${prose}
    ${grid ? `    <div class="imgs">\n${grid}\n    </div>` : ""}
    ${originalButton(env)}
  </article>`;
  return { html, used };
}

export interface MarkdownHeading {
  id: string;
  level: number;
  text: string;
}

export interface MarkdownOptions {
  /** Href of the folder that holds the document's attachments, for relative image paths. */
  base?: string;
  /** Namespace used to resolve relative `hub:` links. */
  ns?: string | undefined;
  /** When given, headings are collected for a document outline. */
  headings?: MarkdownHeading[];
}

interface MarkdownContext {
  headingCounts: Map<string, number>;
}

function plainHeadingText(src: string): string {
  return src
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim();
}

function headingId(src: string, ctx: MarkdownContext): string {
  const slug =
    plainHeadingText(src)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-")
      .slice(0, 72) || "section";
  const n = (ctx.headingCounts.get(slug) ?? 0) + 1;
  ctx.headingCounts.set(slug, n);
  return n === 1 ? slug : `${slug}-${n}`;
}

/** GFM-style table row split: outer pipes are optional, `\|` is a literal pipe. */
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let k = 0; k < s.length; k++) {
    const ch = s[k] ?? "";
    if (ch === "\\" && s[k + 1] === "|") {
      cur += "|";
      k++;
      continue;
    }
    if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

type Align = "left" | "center" | "right" | null;

function tableDelimiter(line: string | undefined): Align[] | null {
  if (line === undefined || !line.includes("|")) return null;
  const cells = splitTableRow(line);
  if (cells.length === 0) return null;
  if (!cells.every((c) => /^:?-{1,}:?$/.test(c))) return null;
  return cells.map((c) => {
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : null;
  });
}

interface ListMarker {
  indent: number;
  ordered: boolean;
  start: number;
  rest: string;
}

function listMarker(line: string): ListMarker | null {
  const m = /^([ \t]*)([-+*]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(line);
  if (!m) return null;
  const indent = (m[1] ?? "").replace(/\t/g, "    ").length;
  const marker = m[2] ?? "";
  const ordered = /\d/.test(marker);
  return {
    indent,
    ordered,
    start: ordered ? Number.parseInt(marker, 10) : 1,
    rest: m[4] ?? "",
  };
}

function isRule(line: string): boolean {
  return /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line);
}

function interruptsParagraph(line: string): boolean {
  if (!line.trim()) return true;
  if (/^ {0,3}#{1,6}\s/.test(line)) return true;
  if (/^ {0,3}(?:```|~~~)/.test(line)) return true;
  if (/^ {0,3}>/.test(line)) return true;
  if (isRule(line)) return true;
  return listMarker(line) !== null;
}

function joinParagraph(lines: string[]): string {
  let text = "";
  for (let k = 0; k < lines.length; k++) {
    const raw = lines[k] ?? "";
    const hard = / {2,}$/.test(raw) || raw.endsWith("\\");
    const clean = raw.replace(/\\$/, "").replace(/[ \t]+$/, "");
    text += k === lines.length - 1 ? clean : clean + (hard ? "\n" : " ");
  }
  return text;
}

interface ListNode {
  indent: number;
  ordered: boolean;
  start: number;
  lines: string[];
  children: ListNode[];
}

function renderListGroup(nodes: ListNode[], opts: MarkdownOptions): string {
  let html = "";
  let k = 0;
  while (k < nodes.length) {
    const ordered = nodes[k]!.ordered;
    const start = nodes[k]!.start;
    const group: ListNode[] = [];
    while (k < nodes.length && nodes[k]!.ordered === ordered) {
      group.push(nodes[k]!);
      k++;
    }
    const tag = ordered ? "ol" : "ul";
    const startAttr = ordered && start !== 1 ? ` start="${start}"` : "";
    const items = group
      .map((node) => {
        let text = node.lines.join(" ").trim();
        let task = "";
        const box = /^\[([ xX])\]\s+/.exec(text);
        if (box) {
          task = `<input type="checkbox" disabled${box[1]!.toLowerCase() === "x" ? " checked" : ""}> `;
          text = text.slice(box[0].length);
        }
        const kids = node.children.length ? renderListGroup(node.children, opts) : "";
        return `<li${box ? ' class="task"' : ""}>${task}${inlineMarkdown(text, opts)}${kids}</li>`;
      })
      .join("");
    html += `<${tag}${startAttr}>${items}</${tag}>`;
  }
  return html;
}

function parseList(lines: string[], start: number, opts: MarkdownOptions): { html: string; next: number } {
  interface RawItem {
    indent: number;
    ordered: boolean;
    start: number;
    lines: string[];
  }
  const raws: RawItem[] = [];
  let i = start;
  let cur: RawItem | null = null;
  const first = listMarker(lines[start] ?? "");
  const baseIndent = first?.indent ?? 0;
  const baseOrdered = first?.ordered ?? false;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const marker = listMarker(line);
    if (marker) {
      if (marker.indent <= baseIndent && marker.ordered !== baseOrdered) break;
      cur = { indent: marker.indent, ordered: marker.ordered, start: marker.start, lines: [marker.rest] };
      raws.push(cur);
      i++;
      continue;
    }
    if (!line.trim()) {
      const next = lines[i + 1];
      if (next === undefined) {
        i++;
        break;
      }
      if (listMarker(next)) {
        i++;
        continue;
      }
      if (cur && /^\s{2,}\S/.test(next)) {
        cur.lines.push("");
        i++;
        continue;
      }
      break;
    }
    if (!cur) break;
    if (
      /^ {0,3}#{1,6}\s/.test(line) ||
      /^ {0,3}(?:```|~~~)/.test(line) ||
      /^ {0,3}>/.test(line) ||
      isRule(line)
    ) {
      break;
    }
    cur.lines.push(line.trim());
    i++;
  }

  const roots: ListNode[] = [];
  const stack: ListNode[] = [];
  for (const raw of raws) {
    while (stack.length && raw.indent < stack[stack.length - 1]!.indent) stack.pop();
    const node: ListNode = { indent: raw.indent, ordered: raw.ordered, start: raw.start, lines: raw.lines, children: [] };
    if (stack.length && raw.indent > stack[stack.length - 1]!.indent) {
      stack[stack.length - 1]!.children.push(node);
    } else {
      if (stack.length) stack.pop();
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    stack.push(node);
  }
  return { html: renderListGroup(roots, opts), next: i };
}

function renderBlocks(lines: string[], opts: MarkdownOptions, ctx: MarkdownContext): string {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = /^ {0,3}(`{3,}|~{3,})\s*(.*)$/.exec(line);
    if (fence) {
      const marker = fence[1] ?? "```";
      const lang = esc((fence[2] ?? "").trim());
      i++;
      const code: string[] = [];
      while (i < lines.length && !(lines[i] ?? "").trimStart().startsWith(marker.slice(0, 3))) {
        code.push(lines[i] ?? "");
        i++;
      }
      if (i < lines.length) i++;
      out.push(`<pre${lang ? ` data-lang="${lang}"` : ""}><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const source = heading[2] ?? "";
      const id = headingId(source, ctx);
      opts.headings?.push({ id, level, text: plainHeadingText(source) });
      out.push(`<h${level} id="${esc(id)}">${inlineMarkdown(source, opts)}</h${level}>`);
      i++;
      continue;
    }

    if (isRule(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length) {
        const m = /^ {0,3}>[ \t]?(.*)$/.exec(lines[i] ?? "");
        if (!m) break;
        quoted.push(m[1] ?? "");
        i++;
      }
      out.push(`<blockquote>${renderBlocks(quoted, opts, ctx)}</blockquote>`);
      continue;
    }

    const aligns = tableDelimiter(lines[i + 1]);
    if (line.includes("|") && aligns) {
      const header = splitTableRow(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length) {
        const row = lines[i] ?? "";
        if (!row.trim() || !row.includes("|")) break;
        body.push(splitTableRow(row));
        i++;
      }
      const cell = (tag: "th" | "td", value: string, index: number): string => {
        const align = aligns[index] ?? null;
        const style = align ? ` style="text-align:${align}"` : "";
        return `<${tag}${style}>${inlineMarkdown(value, opts)}</${tag}>`;
      };
      const head = header.map((value, index) => cell("th", value, index)).join("");
      const rows = body
        .map((values) => {
          const cells = header.map((_unused, index) => cell("td", values[index] ?? "", index)).join("");
          return `<tr>${cells}</tr>`;
        })
        .join("");
      out.push(
        `<div class="table-wrap"><table class="md-table"><thead><tr>${head}</tr></thead>${rows ? `<tbody>${rows}</tbody>` : ""}</table></div>`,
      );
      continue;
    }

    if (listMarker(line)) {
      const parsed = parseList(lines, i, opts);
      out.push(parsed.html);
      i = parsed.next;
      continue;
    }

    const para: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (interruptsParagraph(next)) break;
      if (next.includes("|") && tableDelimiter(lines[i + 1])) break;
      para.push(next);
      i++;
    }
    out.push(`<p>${inlineMarkdown(joinParagraph(para), opts)}</p>`);
  }
  return out.join("\n");
}

/** Render a useful subset of GFM: headings, lists, tables, fenced code, quotes, rules, links, images. Raw HTML is escaped. */
export function renderMarkdown(src: string, opts: MarkdownOptions = {}): string {
  const lines = src.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  return renderBlocks(lines, opts, { headingCounts: new Map() });
}

function resolveImageSrc(raw: string, base?: string): string | null {
  const url = raw.replace(/&amp;/g, "&").trim();
  if (!url) return null;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null; // external images stay links (CSP keeps the page local)
  if (!base) return null;
  const clean = url.replace(/^\.\//, "");
  return `${base}/${clean.split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;
}

/** Same-origin viewer links stay bare. Outbound links keep noreferrer. */
function linkRel(href: string): string {
  return href.startsWith("/") ? "" : ` rel="noreferrer"`;
}

/** Markdown link target: external URL, hub: place, or a bare record id. */
function markdownTarget(raw: string, ns?: string | undefined): string | null {
  const url = raw.replace(/&amp;/g, "&");
  const external = safeHref(url);
  if (external) return external;
  const place = hubHref(url, ns);
  if (place) return place.href;
  if (isUlid(url)) return `/r/${encodeURIComponent(url)}`;
  return null;
}

function inlineMarkdown(src: string, opts: MarkdownOptions = {}): string {
  const stash: string[] = [];
  const keep = (html: string): string => `\u0000${stash.push(html) - 1}\u0000`;
  let out = esc(src);

  // Code spans are protected before any other inline rule runs.
  out = out.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    const body = isUlid(code) ? `<a href="/r/${encodeURIComponent(code)}"><code>${code}</code></a>` : `<code>${code}</code>`;
    return keep(body);
  });

  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_m, alt: string, rawSrc: string) => {
    const resolved = resolveImageSrc(rawSrc, opts.base);
    if (!resolved) {
      const href = markdownTarget(rawSrc, opts.ns);
      return keep(href ? `<a href="${esc(href)}"${linkRel(href)}>${alt || rawSrc}</a>` : alt);
    }
    return keep(`<img src="${esc(resolved)}" alt="${alt}" loading="lazy">`);
  });

  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_m, text: string, url: string) => {
    const href = markdownTarget(url, opts.ns);
    return keep(href ? `<a href="${esc(href)}"${linkRel(href)}>${text}</a>` : text);
  });

  out = out.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");

  out = out.replace(/\u0000(\d+)\u0000/g, (_m, n: string) => stash[Number(n)] ?? "");
  return out.replace(/\n/g, "<br>");
}

export function recordPage(input: RecordPageInput): string {
  const { env, ns, segs, view, rawBase, readBase, textFiles } = input;
  const crumbs: Crumb[] = [{ label: ns, href: `/n/${encodeURIComponent(ns)}` }];
  segs.forEach((segment, i) => {
    const href = `/n/${[ns, ...segs.slice(0, i + 1)].map(encodeURIComponent).join("/")}`;
    const last = i === segs.length - 1;
    crumbs.push({ label: last ? recordTitle(env) : segment, href });
  });
  const title = recordTitle(env);
  const body = recordBody(env);
  const grid = imageGrid(env.files, rawBase);
  const atts = attachmentsList(env.files, rawBase, readBase);
  const texts = textPreviews(textFiles, readBase, rawBase, ns);
  const platform = typeof env.data?.["platform"] === "string" ? String(env.data["platform"]) : "";
  let html: string;

  if (view === "card" && platform) {
    html = `${socialCard(env, body, title, grid)}
${fieldsTable(env, ["content", "author", "platform", "url", "published_at", "summary", "description"], ns)}
${atts}
${texts}`;
  } else if (view === "card") {
    const card = catalogCard(env, body, title, grid, ns);
    html = `${card.html}
${fieldsTable(env, [...card.used, "content", "author", "platform", "published_at", "fetched_at"], ns)}
${atts}
${texts}`;
  } else if (view === "gallery") {
    html = `  <div class="page-head"><h1>${esc(title)}</h1><div class="sub">${metaLine(env, [ns])}</div></div>
${grid ? `  <div class="imgs gallery-first">\n${grid}\n  </div>` : `  <div class="empty"><p>No images.</p></div>`}
  <div class="section-title">Metadata</div>
${fieldsTable(env, ["title"], ns)}
${atts}
${texts}`;
  } else if (view === "article") {
    const articleBody = body
      ? looksLikeMarkdown(body)
        ? `<div class="prose md">${renderMarkdown(body, { ns })}</div>`
        : `<div class="prose">${esc(body)}</div>`
      : "";
    const author = recordAuthor(env);
    html = `  <article class="view-article">
    <h1>${esc(title)}</h1>
    <p class="byline">${esc(author)} · ${esc(cardTime(env))} · <span class="mono">${esc(env.schema)}</span></p>
    ${articleBody}
    ${originalButton(env)}
  </article>
${fieldsTable(env, ["title", "content", "excerpt", "summary", "author", "published_at", "name", "display_name", "url", "html_url", "github_url", "skill_md_url"], ns)}
${atts}
${texts}`;
  } else {
    const prose = proseBlocks(env, ["title", "name", "display_name", "full_name"], ns);
    const skip = ["title", "name", "display_name", "full_name", ...prose.used];
    if (firstUrl(env)) skip.push("url", "html_url", "github_url", "skill_md_url", "link", "source");
    html = `  <div class="page-head"><h1>${esc(title)}</h1><div class="sub">${metaLine(env, [ns])}</div></div>
${originalButton(env)}
${prose.html}
${grid ? `  <div class="imgs">\n${grid}\n  </div>` : ""}
${fieldsTable(env, skip, ns)}
${atts}
${texts}`;
  }

  html += `\n${provenanceBlock(env.provenance)}`;
  return layout(title, crumbs, html.trimEnd(), { searchNs: ns });
}

export interface DocPageInput {
  env: RecordEnvelope;
  ns: string;
  /** Record folder path under the namespace, including the record folder name. */
  segs: string[];
  file: string;
  mime: string;
  bytes: number;
  text: string;
}

/** Standalone reading page for one text attachment, with an outline for longer documents. */
export function docPage(input: DocPageInput): string {
  const { env, ns, segs, file, mime, bytes, text } = input;
  const recordHref = `/n/${[ns, ...segs].map(encodeURIComponent).join("/")}`;
  const rawHref = `/raw/${[ns, ...segs, file].map(encodeURIComponent).join("/")}`;
  const rawBase = `/raw/${[ns, ...segs].map(encodeURIComponent).join("/")}`;
  const headings: MarkdownHeading[] = [];
  const markdown = mime === "text/markdown" || looksLikeMarkdown(text);
  const rendered = markdown
    ? renderMarkdown(text, { base: rawBase, headings, ns })
    : `<pre>${esc(text)}</pre>`;
  const toc = headings.filter((h) => h.level === 2 || h.level === 3);
  const tocHtml =
    toc.length >= 3
      ? `<details class="toc"><summary>目录 · ${toc.length}</summary><ol>${toc
          .map((h) => `<li class="lvl-${h.level}"><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`)
          .join("")}</ol></details>`
      : "";
  const crumbs: Crumb[] = [{ label: ns, href: `/n/${encodeURIComponent(ns)}` }];
  segs.forEach((segment, i) => {
    const last = i === segs.length - 1;
    const href = `/n/${[ns, ...segs.slice(0, i + 1)].map(encodeURIComponent).join("/")}`;
    crumbs.push({ label: last ? recordTitle(env) : segment, href });
  });
  crumbs.push({ label: file });
  const body = `  <div class="doc">
    <div class="doc-head">
      <span class="doc-file">${esc(file)}</span>
      <span class="doc-sub">${esc(recordTitle(env))} · ${esc(mime)} · ${fmtBytes(bytes)}</span>
      <span class="doc-actions"><a href="${esc(recordHref)}">返回记录</a><a href="${esc(rawHref)}">下载原文</a></span>
    </div>
${tocHtml ? `${tocHtml}\n` : ""}    <div class="prose md">${rendered}</div>
  </div>`;
  return layout(`${recordTitle(env)} · ${file}`, crumbs, body, { searchNs: ns });
}
