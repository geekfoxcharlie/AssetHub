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
:root { --ink:#1d2833; --mut:#68758a; --line:#e2e7ee; --bg:#f6f8fa; --card:#ffffff; --accent:#1c5fd6; }
* { box-sizing:border-box; }
body { margin:0; color:var(--ink); background:var(--bg); font:15px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif; }
a { color:var(--accent); text-decoration:none; }
a:hover { text-decoration:underline; }
header { background:var(--card); border-bottom:1px solid var(--line); }
header .wrap { display:flex; align-items:baseline; gap:8px; padding:12px 20px; font-size:13px; color:var(--mut); flex-wrap:wrap; }
.brand { font-weight:650; font-size:14px; color:var(--ink); letter-spacing:.02em; }
main.wrap { max-width:920px; margin:0 auto; padding:28px 20px 72px; }
footer { max-width:920px; margin:0 auto; padding:0 20px 40px; color:var(--mut); font-size:12px; }
h1 { font-size:24px; line-height:1.35; margin:0 0 6px; }
.muted { color:var(--mut); }
.mono { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; }
.badges { display:flex; gap:8px; flex-wrap:wrap; margin:6px 0 18px; }
.badge { display:inline-block; padding:2px 9px; border:1px solid var(--line); border-radius:999px; background:var(--card); font-size:12px; color:var(--mut); }
.badge.schema { color:var(--accent); border-color:#c9dcf7; }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:14px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; }
.card h3 { margin:0 0 4px; font-size:15px; }
.card .sub { color:var(--mut); font-size:12.5px; }
.count { float:right; font-size:12px; color:var(--mut); }
table.fields { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden; font-size:14px; }
table.fields th, table.fields td { text-align:left; padding:8px 12px; border-bottom:1px solid var(--line); vertical-align:top; }
table.fields tr:last-child th, table.fields tr:last-child td { border-bottom:0; }
table.fields th { color:var(--mut); font-weight:500; white-space:nowrap; width:1%; }
.prose { white-space:pre-wrap; font-size:15.5px; }
.imgs { display:grid; gap:10px; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); margin:14px 0; }
.imgs figure { margin:0; }
.imgs img { width:100%; display:block; border:1px solid var(--line); border-radius:10px; background:var(--card); }
.imgs figcaption { font-size:12px; color:var(--mut); margin-top:4px; }
ul.atts { list-style:none; padding:0; margin:8px 0 0; }
ul.atts li { padding:7px 0; border-bottom:1px solid var(--line); font-size:14px; display:flex; justify-content:space-between; gap:12px; }
ul.atts li:last-child { border-bottom:0; }
ul.atts .meta { color:var(--mut); font-size:12.5px; white-space:nowrap; }
.btn { display:inline-block; padding:7px 16px; border-radius:9px; border:1px solid #c9dcf7; background:#eef4fd; color:var(--accent); font-size:14px; }
.btn:hover { text-decoration:none; background:#e2edfc; }
.folder-list { display:flex; flex-direction:column; gap:6px; margin:0 0 22px; }
.folder-list a { display:block; background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 14px; }
.folder-list a:hover { border-color:var(--accent); text-decoration:none; }
.view-card { max-width:560px; margin:0 auto; background:var(--card); border:1px solid var(--line); border-radius:14px; padding:22px 24px; }
.view-card .head { display:flex; justify-content:space-between; align-items:baseline; gap:10px; margin-bottom:10px; }
.view-card .author { font-weight:650; }
.view-article { max-width:680px; margin:0 auto; }
.view-article .prose { font-size:17px; line-height:1.9; }
.view-article .byline { color:var(--mut); font-size:13.5px; margin:0 0 26px; }
.gallery-first .imgs { grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); }
section.block { margin:26px 0; }
h2.block { font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--mut); margin:30px 0 10px; }
.empty { color:var(--mut); background:var(--card); border:1px dashed var(--line); border-radius:12px; padding:28px; text-align:center; }
`;

export interface Crumb {
  label: string;
  href?: string;
}

export function layout(title: string, crumbs: Crumb[], body: string): string {
  const trail = crumbs
    .map((c) =>
      c.href !== undefined ? `<a href="${esc(c.href)}">${esc(c.label)}</a>` : `<span>${esc(c.label)}</span>`,
    )
    .join('<span class="muted">/</span>');
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · AssetHub</title>
<style>${CSS}</style>
</head>
<body>
<header><div class="wrap"><a class="brand" href="/">AssetHub</a>${trail ? `<span class="muted">·</span>${trail}` : ""}</div></header>
<main class="wrap">
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
  const cards = items
    .map(
      (n) => `    <a class="card" href="/n/${encodeURIComponent(n.id)}">
      <h3>${esc(n.id)} <span class="count">${n.records} records</span></h3>
      <div class="sub">${esc(n.name)}${n.goal ? ` — ${esc(n.goal)}` : ""}</div>
    </a>`,
    )
    .join("\n");
  const body = items.length
    ? `  <h1>Namespaces</h1>\n  <div class="grid">\n${cards}\n  </div>`
    : `  <div class="empty"><h1>No namespaces yet</h1><p>Create one with <span class="mono">assethub namespace add &lt;id&gt;</span>, or run <span class="mono">assethub demo</span>.</p></div>`;
  return layout("Namespaces", [{ label: "namespaces" }], body);
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
      `  <div class="folder-list">\n${folders
        .map((f) => `    <a href="${esc(f.href)}">📁 ${esc(f.name)} <span class="count">${f.records} records</span></a>`)
        .join("\n")}\n  </div>`,
    );
  }
  if (records.length) {
    parts.push(
      `  <div class="grid">\n${records
        .map(
          (r) => `    <a class="card" href="${esc(r.href)}">
      <h3>${esc(r.title)}</h3>
      <div class="sub"><span class="badge schema">${esc(r.schema)}</span> ${esc(r.created)}</div>
      <div class="sub mono">${esc(r.id)}</div>
    </a>`,
        )
        .join("\n")}\n  </div>`,
    );
  }
  if (!parts.length) {
    parts.push(`  <div class="empty"><p>This folder is empty.</p></div>`);
  }
  const heading = sub.length ? esc(sub[sub.length - 1] ?? ns) : esc(ns);
  return layout(`${ns}/${sub.join("/")}`, crumbs, `  <h1>${heading}</h1>\n  <div class="badges"><span class="badge">namespace ${esc(ns)}</span></div>\n${parts.join("\n")}`);
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
      return `    <li><a href="${esc(href)}">${inline ? "🖼" : "📄"} ${esc(f.name)}</a><span class="meta">${esc(f.mime)} · ${fmtBytes(f.bytes)}</span></li>`;
    })
    .join("\n");
  return `  <h2 class="block">Attachments</h2>\n  <ul class="atts">\n${rows}\n  </ul>`;
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
    return esc(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return esc(String(value));
  if (Array.isArray(value)) return esc(value.map((v) => String(v)).join(", "));
  if (value === null || value === undefined) return `<span class="muted">—</span>`;
  return esc(JSON.stringify(value));
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
  const parts = [`<span class="badge schema">${esc(env.schema)}</span>`];
  for (const b of extra) parts.push(`<span class="badge">${esc(b)}</span>`);
  return `  <div class="badges">${parts.join("")}\n  </div>`;
}

export function recordPage(input: RecordPageInput): string {
  const { env, ns, segs, view, rawBase } = input;
  const crumbs: Crumb[] = [{ label: ns, href: `/n/${encodeURIComponent(ns)}` }];
  segs.slice(0, -1).forEach((segment, i) => {
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
    html = `  <article class="view-card">
    <div class="head"><span class="author">${esc(recordAuthor(env))}</span><span class="muted">${esc(platform ? `${platform} · ` : "")}${esc(cardTime(env))}</span></div>
    <div class="prose">${esc(body || title)}</div>
    ${grid ? `    <div class="imgs">\n${grid}\n    </div>` : ""}
    ${link ? `    <p><a class="btn" href="${esc(link)}" rel="noreferrer">查看原文 →</a></p>` : ""}
  </article>
${fieldsTable(env, ["content", "author", "platform", "url", "published_at"])}
${atts}`;
  } else if (view === "gallery") {
    html = `  <h1>${esc(title)}</h1>
${badges(env, [ns])}
${grid ? `  <div class="imgs gallery-first">\n${grid}\n  </div>` : `  <div class="empty"><p>No images.</p></div>`}
  <h2 class="block">Metadata</h2>
${fieldsTable(env)}
${atts}`;
  } else if (view === "article") {
    html = `  <article class="view-article">
    <h1>${esc(title)}</h1>
    <p class="byline">${esc(recordAuthor(env))} · ${esc(cardTime(env))}</p>
    <div class="prose">${esc(body)}</div>
  </article>
${fieldsTable(env, ["title", "content", "author", "published_at"])}
${atts}`;
  } else {
    html = `  <h1>${esc(title)}</h1>
${badges(env, [`view ${view}`, ns])}
${fieldsTable(env, ["title", "name", "content"])}
${body ? `  <section class="block"><div class="prose">${esc(body)}</div></section>` : ""}
${grid ? `  <div class="imgs">\n${grid}\n  </div>` : ""}
${atts}`;
  }

  const crumbPath = `/n/${[ns, ...segs].map(encodeURIComponent).join("/")}`;
  crumbs.push({ label: title, href: crumbPath });
  return layout(`${title}`, crumbs, html.trimEnd());
}
