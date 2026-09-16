import type { Attachment, ProvenanceEntry, RecordEnvelope } from "../lib/types.js";
import {
  BODY_KEYS,
  TITLE_KEYS,
  looksLikeMarkdown,
  recordBody,
  recordTitle,
  recordUrl,
} from "../lib/format.js";
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

.badge{display:inline-block;font-family:var(--mono);font-size:11px;line-height:1;padding:4px 7px;border:1px solid var(--line-strong);border-radius:var(--radius);color:var(--mut);background:var(--surface)}
.badge.accent{color:var(--accent);border-color:var(--accent);background:var(--accent-soft)}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-block;font-size:12px;line-height:1.2;padding:3px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent);border:1px solid transparent}
.chip.plain{background:var(--surface);color:var(--soft);border-color:var(--line-strong)}
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

// ------------------------------------------------------------------ home page

export interface NamespaceCard {
  id: string;
  name: string;
  goal: string;
  records: number;
}

export function namespacePage(items: NamespaceCard[]): string {
  const rows = items
    .map(
      (n) => `    <a class="row" href="/n/${encodeURIComponent(n.id)}">
      <span class="grow"><span class="title">${esc(n.name)}</span><span class="desc">${esc(n.id)}${n.goal ? ` · ${esc(n.goal)}` : ""}</span></span>
      <span class="meta">${n.records} records</span>
    </a>`,
    )
    .join("\n");
  const body = items.length
    ? `  <div class="page-head"><h1>项目空间</h1><div class="sub">数据根下的第一层文件夹，一个项目一份。</div></div>\n  <div class="list">\n${rows}\n  </div>`
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
  if (Array.isArray(value)) return value.length === 0 || value.every((v) => typeof v === "string" || typeof v === "number");
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

function recordsTable(records: RecordEntry[], columns: string[]): string {
  const head = columns.map((c) => `<th>${esc(c)}</th>`).join("");
  const rows = records
    .map((r) => {
      const cells = columns
        .map((c) => {
          const rendered = renderValue(r.data?.[c], { compact: true });
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
    parts.push(tableColumns && tableColumns.length ? recordsTable(records, tableColumns) : recordsList(records));
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

function attachmentsList(files: Attachment[], rawBase: string): string {
  if (!files.length) return "";
  const rows = files
    .map((f) => {
      const href = `${rawBase}/${encodeURIComponent(f.name)}`;
      const inline = f.mime.startsWith("image/");
      return `    <li><a href="${esc(href)}"><span class="name">${esc(f.name)}</span></a><span class="meta">${esc(f.mime)} · ${fmtBytes(f.bytes)}${inline ? "" : " · download"}</span></li>`;
    })
    .join("\n");
  return `  <div class="section-title">Attachments</div>\n  <ul class="atts">\n${rows}\n  </ul>`;
}

function textPreviews(files: TextAttachment[] | undefined): string {
  if (!files?.length) return "";
  return files
    .map((f) => {
      const rendered =
        f.mime === "text/markdown" || looksLikeMarkdown(f.text)
          ? renderMarkdown(f.text)
          : `<pre>${esc(f.text)}</pre>`;
      return `  <div class="section-title">${esc(f.name)}</div>\n  <div class="prose md">${rendered}</div>`;
    })
    .join("\n");
}

function chipsFor(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "";
  const bits = value
    .filter((v) => typeof v === "string" && v.trim())
    .map((v) => {
      const s = String(v);
      if (isUlid(s)) return `<a class="chip" href="/r/${encodeURIComponent(s)}">${esc(s)}</a>`;
      return `<span class="chip">${esc(s)}</span>`;
    });
  return bits.length ? `<span class="chips">${bits.join("")}</span>` : "";
}

function objectCards(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "";
  if (!value.every((v) => typeof v === "object" && v !== null && !Array.isArray(v))) return "";
  const cards = (value as Record<string, unknown>[]).map((obj) => {
    const title = typeof obj.label === "string" ? obj.label : typeof obj.title === "string" ? obj.title : typeof obj.name === "string" ? obj.name : "";
    const note = typeof obj.note === "string" ? obj.note : "";
    const keywords = Array.isArray(obj.keywords) ? chipsFor(obj.keywords) : "";
    const rest = Object.entries(obj)
      .filter(([k]) => !["label", "title", "name", "note", "keywords"].includes(k))
      .map(([k, v]) => `<span class="chip plain">${esc(k)}: ${esc(typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v))}</span>`)
      .join("");
    return `<div class="obj-card">${title ? `<div class="obj-title">${esc(title)}</div>` : ""}${keywords}${rest ? `<div class="chips">${rest}</div>` : ""}${note ? `<p class="obj-note">${esc(note)}</p>` : ""}</div>`;
  });
  return `<div class="obj-list">${cards.join("")}</div>`;
}

function ulidHref(value: string): string | null {
  return isUlid(value) ? `/r/${encodeURIComponent(value)}` : null;
}

function renderValue(value: unknown, opts: { compact?: boolean } = {}): string {
  if (typeof value === "string") {
    const href = safeHref(value);
    if (href) return `<a href="${esc(href)}" rel="noreferrer">${esc(value)}</a>`;
    const idHref = ulidHref(value);
    if (idHref) return `<a href="${esc(idHref)}" class="mono">${esc(value)}</a>`;
    const trimmed = value.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          return renderKV(parsed);
        }
      } catch { /* not valid JSON, fall through */ }
    }
    if (!opts.compact && (value.includes("\n") || value.length > 160)) {
      return looksLikeMarkdown(value) ? `<div class="prose md">${renderMarkdown(value)}</div>` : `<div class="prose">${esc(value)}</div>`;
    }
    return esc(value);
  }
  if (typeof value === "number") return esc(fmtNumber(value));
  if (typeof value === "boolean") return esc(String(value));
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string")) return chipsFor(value) || `<span class="muted">—</span>`;
    const cards = objectCards(value);
    if (cards) return cards;
    if (value.every((v) => typeof v === "number")) return esc(value.map((v) => fmtNumber(v as number)).join(", "));
    return esc(value.map((v) => String(v)).join(", "));
  }
  if (value === null || value === undefined) return `<span class="muted">—</span>`;
  if (typeof value === "object") return renderKV(value as Record<string, unknown>);
  return esc(JSON.stringify(value));
}

function renderKV(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj);
  if (entries.length === 0) return `<span class="muted">—</span>`;
  const rows = entries.map(([k, v]) => {
    const display = typeof v === "number" ? fmtNumber(v) : String(v);
    return `<tr><td class="kv-key">${esc(k)}</td><td class="kv-val">${esc(display)}</td></tr>`;
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

function fieldsTable(env: RecordEnvelope, skip: string[] = []): string {
  const skipSet = new Set(skip);
  const rows = Object.entries(env.data ?? {})
    .filter(([key, value]) => !skipSet.has(key) && !isEmptyValue(value))
    .map(([key, value]) => {
      const rendered = renderValue(value);
      return `    <tr><th>${esc(key)}</th><td>${rendered}</td></tr>`;
    })
    .join("\n");
  if (!rows) return "";
  return `  <table class="fields">\n${rows}\n  </table>`;
}

function proseBlocks(env: RecordEnvelope, skip: string[] = []): { html: string; used: string[] } {
  const skipSet = new Set(skip);
  const used: string[] = [];
  const parts: string[] = [];
  for (const [key, value] of Object.entries(env.data ?? {})) {
    if (skipSet.has(key) || typeof value !== "string" || !value.trim()) continue;
    const long = PROSE_KEY_SET.has(key) || value.includes("\n") || value.length > 160;
    if (!long) continue;
    used.push(key);
    const body = looksLikeMarkdown(value) ? `<div class="prose md">${renderMarkdown(value)}</div>` : `<div class="prose">${esc(value)}</div>`;
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

function metricChips(env: RecordEnvelope): { html: string; used: string[] } {
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
  const tags = chipsFor(env.data?.["tags"]);
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

function catalogCard(env: RecordEnvelope, body: string, title: string, grid: string): { html: string; used: string[] } {
  const metrics = metricChips(env);
  const prose = body
    ? looksLikeMarkdown(body)
      ? `<div class="prose md">${renderMarkdown(body)}</div>`
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

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let para: string[] = [];
  const flushPara = () => {
    if (!para.length) return;
    out.push(`<p>${inlineMarkdown(para.join("\n"))}</p>`);
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith("```")) {
      flushPara();
      const fenceLang = esc(line.slice(3).trim());
      i++;
      const code: string[] = [];
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) {
        code.push(lines[i] ?? "");
        i++;
      }
      if (i < lines.length) i++;
      out.push(`<pre${fenceLang ? ` data-lang="${fenceLang}"` : ""}><code>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushPara();
      const level = heading[1]!.length;
      out.push(`<h${level}>${inlineMarkdown(heading[2]!)}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*[-*]\s+\S/.test(line) || /^\s*\d+\.\s+\S/.test(line)) {
      flushPara();
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+\.\s+\S/.test(lines[i] ?? "") : /^\s*[-*]\s+\S/.test(lines[i] ?? ""))) {
        items.push(`<li>${inlineMarkdown((lines[i] ?? "").replace(/^\s*(?:[-*]|\d+\.)\s+/, ""))}</li>`);
        i++;
      }
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      i++;
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara();
  return out.join("\n");
}

function inlineMarkdown(src: string): string {
  let out = esc(src);
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => {
    if (isUlid(code)) return `<a href="/r/${encodeURIComponent(code)}"><code>${esc(code)}</code></a>`;
    return `<code>${code}</code>`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, url: string) => {
    const href = safeHref(url.replace(/&amp;/g, "&"));
    return href ? `<a href="${esc(href)}" rel="noreferrer">${text}</a>` : text;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  return out;
}

export function recordPage(input: RecordPageInput): string {
  const { env, ns, segs, view, rawBase, textFiles } = input;
  const crumbs: Crumb[] = [{ label: ns, href: `/n/${encodeURIComponent(ns)}` }];
  segs.forEach((segment, i) => {
    const href = `/n/${[ns, ...segs.slice(0, i + 1)].map(encodeURIComponent).join("/")}`;
    const last = i === segs.length - 1;
    crumbs.push({ label: last ? recordTitle(env) : segment, href });
  });
  const title = recordTitle(env);
  const body = recordBody(env);
  const grid = imageGrid(env.files, rawBase);
  const atts = attachmentsList(env.files, rawBase);
  const texts = textPreviews(textFiles);
  const platform = typeof env.data?.["platform"] === "string" ? String(env.data["platform"]) : "";
  let html: string;

  if (view === "card" && platform) {
    html = `${socialCard(env, body, title, grid)}
${fieldsTable(env, ["content", "author", "platform", "url", "published_at", "summary", "description"])}
${atts}
${texts}`;
  } else if (view === "card") {
    const card = catalogCard(env, body, title, grid);
    html = `${card.html}
${fieldsTable(env, [...card.used, "content", "author", "platform", "published_at", "fetched_at"])}
${atts}
${texts}`;
  } else if (view === "gallery") {
    html = `  <div class="page-head"><h1>${esc(title)}</h1><div class="sub">${metaLine(env, [ns])}</div></div>
${grid ? `  <div class="imgs gallery-first">\n${grid}\n  </div>` : `  <div class="empty"><p>No images.</p></div>`}
  <div class="section-title">Metadata</div>
${fieldsTable(env, ["title"])}
${atts}
${texts}`;
  } else if (view === "article") {
    const articleBody = body
      ? looksLikeMarkdown(body)
        ? `<div class="prose md">${renderMarkdown(body)}</div>`
        : `<div class="prose">${esc(body)}</div>`
      : "";
    const author = recordAuthor(env);
    html = `  <article class="view-article">
    <h1>${esc(title)}</h1>
    <p class="byline">${esc(author)} · ${esc(cardTime(env))} · <span class="mono">${esc(env.schema)}</span></p>
    ${articleBody}
    ${originalButton(env)}
  </article>
${fieldsTable(env, ["title", "content", "excerpt", "summary", "author", "published_at", "name", "display_name", "url", "html_url", "github_url", "skill_md_url"])}
${atts}
${texts}`;
  } else {
    const prose = proseBlocks(env, ["title", "name", "display_name", "full_name"]);
    const skip = ["title", "name", "display_name", "full_name", ...prose.used];
    if (firstUrl(env)) skip.push("url", "html_url", "github_url", "skill_md_url", "link", "source");
    html = `  <div class="page-head"><h1>${esc(title)}</h1><div class="sub">${metaLine(env, [ns])}</div></div>
${originalButton(env)}
${prose.html}
${grid ? `  <div class="imgs">\n${grid}\n  </div>` : ""}
${fieldsTable(env, skip)}
${atts}
${texts}`;
  }

  html += `\n${provenanceBlock(env.provenance)}`;
  return layout(title, crumbs, html.trimEnd(), { searchNs: ns });
}
