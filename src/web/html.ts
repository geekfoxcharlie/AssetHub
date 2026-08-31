import type { Attachment, RecordEnvelope } from "../lib/types.js";
import { recordBody, recordTitle } from "../lib/format.js";

export const VIEW_NAMES = new Set(["record", "card", "gallery", "article"]);
export type ViewName = "record" | "card" | "gallery" | "article";

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

const CSS = `
:root{
  --bg:#faf9f7; --surface:#ffffff;
  --ink:#1b1d20; --soft:#3c434c; --mut:#707780; --faint:#9aa0a8;
  --line:#e8e5df; --line-strong:#d6d2c9;
  --accent:#0f766e; --accent-soft:#e3f0ee;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;}
a{color:inherit;text-decoration:none}
a:hover{color:var(--accent)}
::selection{background:var(--accent-soft)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}

.topbar{position:sticky;top:0;z-index:10;background:rgba(250,249,247,.92);backdrop-filter:blur(6px);border-bottom:1px solid var(--line)}
.topbar .inner{max-width:880px;margin:0 auto;display:flex;align-items:center;gap:16px;padding:11px 24px}
.brand{display:flex;align-items:center;gap:8px;font-weight:650;font-size:14px;letter-spacing:.01em;flex-shrink:0}
.brand .dot{width:9px;height:9px;border-radius:3px;background:var(--accent)}
.breadcrumbs{font-family:var(--mono);font-size:12.5px;color:var(--mut);display:flex;align-items:center;gap:7px;min-width:0;overflow:hidden;white-space:nowrap}
.breadcrumbs a:hover{color:var(--ink)}
.breadcrumbs .sep{color:var(--faint)}
.breadcrumbs .tail{color:var(--ink);overflow:hidden;text-overflow:ellipsis}

main{max-width:880px;margin:0 auto;padding:36px 24px 88px}

.page-head{margin:0 0 22px}
.page-head h1{font-size:22px;font-weight:650;letter-spacing:-.01em;line-height:1.3;margin:0 0 6px}
.page-head .sub{color:var(--mut);font-size:13px;display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.muted{color:var(--mut)}
.mono{font-family:var(--mono)}

.section-title{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--mut);margin:30px 0 6px}

.list{border-top:1px solid var(--line)}
.row{display:flex;align-items:center;gap:14px;padding:13px 2px;border-bottom:1px solid var(--line)}
a.row:hover .title{color:var(--accent)}
.row .badge{flex-shrink:0}
.row .grow{flex:1;min-width:0}
.row .title{display:block;font-weight:550;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .desc{display:block;color:var(--mut);font-size:12.5px;font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .meta{flex-shrink:0;color:var(--mut);font-size:12.5px;font-variant-numeric:tabular-nums;white-space:nowrap}

.badge{display:inline-block;font-family:var(--mono);font-size:11px;line-height:1;padding:4px 7px;border:1px solid var(--line-strong);border-radius:4px;color:var(--mut);background:var(--surface)}
.badge.accent{color:var(--accent);border-color:var(--accent);background:var(--accent-soft)}

table.fields{width:100%;border-collapse:collapse;font-size:14px;background:var(--surface);border:1px solid var(--line);border-radius:8px;overflow:hidden}
table.fields th,table.fields td{text-align:left;padding:10px 16px;border-bottom:1px solid var(--line);vertical-align:top}
table.fields tr:last-child th,table.fields tr:last-child td{border-bottom:0}
table.fields th{font-family:var(--mono);font-weight:400;font-size:12px;color:var(--mut);white-space:nowrap;width:1%;padding-top:12px}
table.fields td{color:var(--ink)}
table.kv{display:inline-table;border-collapse:collapse;font-size:13px;border:1px solid var(--line);border-radius:6px;overflow:hidden}
table.kv td{padding:5px 12px;border-bottom:1px solid var(--line)}
table.kv tr:last-child td{border-bottom:0}
table.kv .kv-key{font-family:var(--mono);font-weight:500;color:var(--mut);white-space:nowrap;border-right:1px solid var(--line);background:var(--bg)}
table.kv .kv-val{font-variant-numeric:tabular-nums;color:var(--ink)}

.prose{white-space:pre-wrap;line-height:1.75;font-size:15.5px;color:var(--soft)}

.imgs{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin:22px 0}
.imgs figure{margin:0}
.imgs img{width:100%;display:block;aspect-ratio:16/10;object-fit:cover;border:1px solid var(--line);border-radius:8px;background:var(--surface)}
.imgs figcaption{font-family:var(--mono);font-size:11.5px;color:var(--mut);margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

ul.atts{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:8px;background:var(--surface)}
ul.atts li{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:11px 16px;border-bottom:1px solid var(--line);font-size:14px}
ul.atts li:last-child{border-bottom:0}
ul.atts .name{font-family:var(--mono);font-size:13px;color:var(--ink)}
ul.atts a:hover .name{color:var(--accent)}
ul.atts .meta{color:var(--mut);font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums}

.btn{display:inline-flex;align-items:center;gap:7px;font-size:13.5px;font-weight:550;padding:8px 15px;border:1px solid var(--line-strong);border-radius:6px;background:var(--surface);color:var(--ink)}
.btn:hover{border-color:var(--accent);color:var(--accent)}
.btn .arrow{font-family:var(--mono)}

.view-card{max-width:640px;margin:0 auto;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:26px 28px}
.view-card .head{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.view-card .avatar{width:36px;height:36px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:650;font-size:15px;flex-shrink:0}
.view-card .who{flex:1;min-width:0;display:flex;flex-direction:column}
.view-card .author{font-weight:600;font-size:14.5px}
.view-card .time{color:var(--mut);font-size:12px}
.view-card .prose{font-size:15px}
.view-card .imgs{margin-top:18px}

.view-article{max-width:680px;margin:0 auto}
.view-article h1{font-size:26px;line-height:1.4;letter-spacing:-.01em;margin:0 0 8px}
.view-article .byline{color:var(--mut);font-size:13.5px;padding-bottom:18px;border-bottom:1px solid var(--line);margin-bottom:26px}
.view-article .prose{font-size:16.5px;line-height:1.9;color:var(--ink)}

.gallery-first .imgs{grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}

.empty{border:1px dashed var(--line-strong);border-radius:10px;padding:46px 24px;text-align:center;color:var(--mut)}
.empty h1{font-size:18px;color:var(--ink);margin:0 0 8px}
.empty p{margin:0}
.empty code{font-family:var(--mono);font-size:12.5px;background:var(--surface);border:1px solid var(--line);border-radius:4px;padding:1px 5px;color:var(--soft)}

footer{max-width:880px;margin:0 auto;padding:0 24px 44px;color:var(--faint);font-size:12px;font-family:var(--mono)}
`;

export interface Crumb {
  label: string;
  href?: string;
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

export function layout(title: string, crumbs: Crumb[], body: string): string {
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
<header class="topbar"><div class="inner"><a class="brand" href="/"><span class="dot"></span>AssetHub</a>${trail}</div></header>
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
    ? `  <div class="page-head"><h1>Namespaces</h1><div class="sub">First-level folders under the data root — one per project.</div></div>\n  <div class="list">\n${rows}\n  </div>`
    : `  <div class="empty"><h1>No namespaces yet</h1><p>Create one with <code>assethub namespace add &lt;id&gt;</code>, or run <code>assethub demo</code>.</p></div>`;
  return layout("Namespaces", [], body);
}

// -------------------------------------------------------------- folder browser

export interface FolderEntry {
  name: string;
  href: string;
  records: number;
}

export interface RecordEntry {
  id: string;
  href: string;
  title: string;
  schema: string;
  created: string;
}

export function folderPage(ns: string, sub: string[], folders: FolderEntry[], records: RecordEntry[]): string {
  const crumbs: Crumb[] = [{ label: ns, href: `/n/${encodeURIComponent(ns)}` }];
  sub.forEach((segment, i) => {
    const href = `/n/${[ns, ...sub.slice(0, i + 1)].map(encodeURIComponent).join("/")}`;
    crumbs.push({ label: segment, href });
  });
  const parts: string[] = [];
  if (folders.length) {
    parts.push(
      `  <div class="section-title">Folders</div>\n  <div class="list">\n${folders
        .map(
          (f) => `    <a class="row" href="${esc(f.href)}">
      <span class="grow"><span class="title">${esc(f.name)}</span></span>
      <span class="meta">${f.records} records</span>
    </a>`,
        )
        .join("\n")}\n  </div>`,
    );
  }
  if (records.length) {
    parts.push(
      `  <div class="section-title">Records</div>\n  <div class="list">\n${records
        .map(
          (r) => `    <a class="row" href="${esc(r.href)}">
      <span class="badge accent">${esc(r.schema)}</span>
      <span class="grow"><span class="title">${esc(r.title)}</span><span class="desc">${esc(r.id)}</span></span>
      <span class="meta">${esc(r.created)}</span>
    </a>`,
        )
        .join("\n")}\n  </div>`,
    );
  }
  if (!parts.length) {
    parts.push(`  <div class="empty"><p>This folder is empty.</p></div>`);
  }
  const heading = sub.length ? sub[sub.length - 1] ?? ns : ns;
  const body = `  <div class="page-head"><h1>${esc(heading)}</h1><div class="sub"><span class="badge">${esc(ns)}</span></div></div>\n${parts.join("\n")}`;
  return layout(`${ns}/${sub.join("/")}`, crumbs, body);
}

// ----------------------------------------------------------------- record page

export interface RecordPageInput {
  env: RecordEnvelope;
  ns: string;
  /** Record folder path under the namespace, including the record folder name. */
  segs: string[];
  view: ViewName;
  rawBase: string;
}

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

function fieldsTable(env: RecordEnvelope, skip: string[] = []): string {
  const rows = Object.entries(env.data ?? {})
    .filter(([key]) => !skip.includes(key))
    .map(([key, value]) => {
      const rendered = renderValue(value);
      return `    <tr><th>${esc(key)}</th><td>${rendered}</td></tr>`;
    })
    .join("\n");
  if (!rows) return "";
  return `  <table class="fields">\n${rows}\n  </table>`;
}

function renderValue(value: unknown): string {
  if (typeof value === "string") {
    const href = safeHref(value);
    if (href) return `<a href="${esc(href)}" rel="noreferrer">${esc(value)}</a>`;
    const trimmed = value.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          return renderKV(parsed);
        }
      } catch { /* not valid JSON, fall through */ }
    }
    return esc(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return esc(String(value));
  if (Array.isArray(value)) return esc(value.map((v) => String(v)).join(", "));
  if (value === null || value === undefined) return `<span class="muted">—</span>`;
  if (typeof value === "object") return renderKV(value as Record<string, unknown>);
  return esc(JSON.stringify(value));
}

function renderKV(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj);
  if (entries.length === 0) return `<span class="muted">—</span>`;
  const rows = entries.map(([k, v]) => {
    const display = typeof v === "number" ? v.toLocaleString() : String(v);
    return `<tr><td class="kv-key">${esc(k)}</td><td class="kv-val">${esc(display)}</td></tr>`;
  });
  return `<table class="kv">${rows.join("")}</table>`;
}

function firstUrl(env: RecordEnvelope): string | null {
  for (const key of ["url", "link", "source"]) {
    const v = env.data?.[key];
    if (typeof v === "string") {
      const href = safeHref(v);
      if (href) return href;
    }
  }
  return null;
}

function recordAuthor(env: RecordEnvelope): string {
  for (const key of ["author", "name"]) {
    const v = env.data?.[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return env.namespace;
}

function cardTime(env: RecordEnvelope): string {
  for (const key of ["published_at", "created_at"]) {
    const v = env.data?.[key];
    if (typeof v === "string" && v.length > 0) return fmtDate(v);
  }
  return fmtDate(env.created_at);
}

function badges(env: RecordEnvelope, extra: string[] = []): string {
  const parts = [`<span class="badge accent">${esc(env.schema)}</span>`];
  for (const b of extra) parts.push(`<span class="badge">${esc(b)}</span>`);
  return parts.join("");
}

function metaLine(env: RecordEnvelope, extra: string[] = []): string {
  const chips = [badges(env, extra)];
  if (typeof env.created_at === "string") chips.push(`<span class="muted">created ${esc(fmtDate(env.created_at))}</span>`);
  return chips.join(" ");
}

export function recordPage(input: RecordPageInput): string {
  const { env, ns, segs, view, rawBase } = input;
  const crumbs: Crumb[] = [{ label: ns, href: `/n/${encodeURIComponent(ns)}` }];
  segs.forEach((segment, i) => {
    const href = `/n/${[ns, ...segs.slice(0, i + 1)].map(encodeURIComponent).join("/")}`;
    crumbs.push({ label: segment, href });
  });
  const title = recordTitle(env);
  const body = recordBody(env);
  const grid = imageGrid(env.files, rawBase);
  const atts = attachmentsList(env.files, rawBase);
  let html: string;

  if (view === "card") {
    const link = firstUrl(env);
    const platform = typeof env.data?.["platform"] === "string" ? String(env.data["platform"]) : "";
    const author = recordAuthor(env);
    const initial = [...author.trim()][0] ?? "?";
    html = `  <article class="view-card">
    <div class="head">
      <span class="avatar">${esc(initial)}</span>
      <span class="who"><span class="author">${esc(author)}</span><span class="time">${esc(platform ? `${platform} · ` : "")}${esc(cardTime(env))}</span></span>
    </div>
    <div class="prose">${esc(body || title)}</div>
    ${grid ? `    <div class="imgs">\n${grid}\n    </div>` : ""}
    ${link ? `    <p><a class="btn" href="${esc(link)}" rel="noreferrer">查看原文 <span class="arrow">→</span></a></p>` : ""}
  </article>
${fieldsTable(env, ["content", "author", "platform", "url", "published_at"])}
${atts}`;
  } else if (view === "gallery") {
    html = `  <div class="page-head"><h1>${esc(title)}</h1><div class="sub">${metaLine(env, [ns])}</div></div>
${grid ? `  <div class="imgs gallery-first">\n${grid}\n  </div>` : `  <div class="empty"><p>No images.</p></div>`}
  <div class="section-title">Metadata</div>
${fieldsTable(env)}
${atts}`;
  } else if (view === "article") {
    html = `  <article class="view-article">
    <h1>${esc(title)}</h1>
    <p class="byline">${esc(recordAuthor(env))} · ${esc(cardTime(env))} · <span class="mono">${esc(env.schema)}</span></p>
    <div class="prose">${esc(body)}</div>
  </article>
${fieldsTable(env, ["title", "content", "author", "published_at"])}
${atts}`;
  } else {
    html = `  <div class="page-head"><h1>${esc(title)}</h1><div class="sub">${metaLine(env, [`view ${view}`, ns])}</div></div>
${fieldsTable(env, ["title", "name", "content"])}
${body ? `  <div class="section-title">Body</div>\n  <div class="prose">${esc(body)}</div>` : ""}
${grid ? `  <div class="imgs">\n${grid}\n  </div>` : ""}
${atts}`;
  }

  return layout(title, crumbs, html.trimEnd());
}
