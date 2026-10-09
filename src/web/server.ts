import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { NS_PATTERN, isInside, safeSegment } from "../lib/paths.js";
import { isRecordDir, walkRecordsUnder } from "../lib/walk.js";
import { resolveSchema } from "../lib/schema.js";
import { recordSubtitle, recordTitle, tryReadEnvelope } from "../lib/format.js";
import { Hub } from "../lib/hub.js";
import { AppError } from "../lib/errors.js";
import { isUlid } from "../lib/ulid.js";
import {
  LIST_PAGE_SIZE,
  errorPage,
  folderPage,
  healthPage,
  namespacePage,
  recordPage,
  searchPage,
  tableColumnsFor,
  viewOf,
  type FolderEntry,
  type NamespaceCard,
  type RecordEntry,
  type TextAttachment,
} from "./html.js";

const HTML_HEADERS: Record<string, string | number> = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

const TEXT_INLINE_MAX = 200_000;
const TEXT_INLINE_MIMES = new Set(["text/markdown", "text/plain", "text/csv"]);

function isHead(res: ServerResponse): boolean {
  return res.req?.method === "HEAD";
}

function send(res: ServerResponse, status: number, body: string, headers: Record<string, string | number> = HTML_HEADERS): void {
  const chunk = isHead(res) ? "" : body;
  if (headers["Content-Length"] === undefined) {
    headers = { ...headers, "Content-Length": Buffer.byteLength(chunk) };
  }
  res.writeHead(status, headers);
  res.end(chunk);
}

function send404(res: ServerResponse): void {
  send(res, 404, errorPage(404, "Not found."));
}

function redirect(res: ServerResponse, location: string): void {
  const headers = { Location: location, "Cache-Control": "no-store", "Content-Length": 0 };
  res.writeHead(302, headers);
  res.end();
}

/** Split and decode a pathname into safe segments; null when malformed, dotted, or traversing. */
function decodeSegments(pathname: string): string[] | null {
  const segments: string[] = [];
  for (const raw of pathname.split("/")) {
    if (raw.length === 0) continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (!safeSegment(decoded)) return null; // rejects dotfiles and ".." alike
    segments.push(decoded);
  }
  return segments;
}

function sortedDirents(dir: string) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith("."))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function hrefFor(ns: string, segs: string[]): string {
  return `/n/${[ns, ...segs].map(encodeURIComponent).join("/")}`;
}

function pathToHref(rel: string): string {
  return `/n/${rel.split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;
}

function readNsMeta(root: string, ns: string): { name: string; goal: string } {
  let name = ns;
  let goal = "";
  try {
    const meta = JSON.parse(readFileSync(path.join(root, ns, ".ns.json"), "utf8")) as { name?: unknown; goal?: unknown };
    if (typeof meta.name === "string") name = meta.name;
    if (typeof meta.goal === "string") goal = meta.goal;
  } catch {
    // tolerate unreadable metadata
  }
  return { name, goal };
}

function summarizeFolder(dir: string, ns: string): { records: number; hint: string; schemas: { id: string; count: number }[] } {
  const tally = new Map<string, number>();
  let records = 0;
  for (const found of walkRecordsUnder(dir, ns)) {
    records++;
    const parsed = tryReadEnvelope(found.dir);
    const schema = parsed.ok && parsed.env && typeof parsed.env.schema === "string" ? parsed.env.schema : "?";
    tally.set(schema, (tally.get(schema) ?? 0) + 1);
  }
  const schemas = [...tally.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([id, count]) => ({ id, count }));
  const hint = schemas.map((s) => `${s.id} × ${s.count}`).join(" · ");
  return { records, hint, schemas };
}

function summarizeNamespace(dir: string, ns: string): Omit<NamespaceCard, "id" | "name" | "goal"> {
  const schemaTally = new Map<string, number>();
  const folderTally = new Map<string, { count: number; schemas: Map<string, number> }>();
  let topRecords = 0;
  for (const found of walkRecordsUnder(dir, ns)) {
    const parsed = tryReadEnvelope(found.dir);
    const schema = parsed.ok && parsed.env && typeof parsed.env.schema === "string" ? parsed.env.schema : "?";
    schemaTally.set(schema, (schemaTally.get(schema) ?? 0) + 1);
    const slash = found.rel.indexOf("/");
    if (slash === -1) {
      topRecords++;
      continue;
    }
    const top = found.rel.slice(0, slash);
    let entry = folderTally.get(top);
    if (!entry) {
      entry = { count: 0, schemas: new Map() };
      folderTally.set(top, entry);
    }
    entry.count++;
    entry.schemas.set(schema, (entry.schemas.get(schema) ?? 0) + 1);
  }
  const schemas = [...schemaTally.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([id, count]) => ({ id, count }));
  const folders = [...folderTally.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([name, tally]) => ({
      name,
      href: hrefFor(ns, [name]),
      records: tally.count,
      schemaHint: [...tally.schemas.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .map(([id, count]) => `${id} × ${count}`)
        .join(" · "),
    }));
  return { records: schemas.reduce((n, s) => n + s.count, 0), schemas, folders, topRecords };
}

function namespaceCards(root: string): NamespaceCard[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "schemas" && NS_PATTERN.test(e.name))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((e) => {
      const meta = readNsMeta(root, e.name);
      const summary = summarizeNamespace(path.join(root, e.name), e.name);
      return { id: e.name, name: meta.name, goal: meta.goal, ...summary };
    });
}

function toRecordEntry(ns: string, segs: string[], env: import("../lib/types.js").RecordEnvelope | undefined, folderName: string): RecordEntry {
  const created =
    env && typeof env.created_at === "string" && env.created_at.length >= 10 ? env.created_at.slice(0, 10) : "";
  return {
    id: env && typeof env.id === "string" ? env.id : folderName,
    href: hrefFor(ns, segs),
    title: env ? recordTitle(env) : folderName,
    schema: env && typeof env.schema === "string" ? env.schema : "?",
    created,
    subtitle: env ? recordSubtitle(env) : "",
    data: env?.data ?? {},
  };
}

function sortRecords(records: RecordEntry[]): RecordEntry[] {
  return records.sort((a, b) => {
    if (a.created !== b.created) return a.created < b.created ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

function parsePage(raw: string | null): number {
  const n = raw ? Number.parseInt(raw, 10) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function readTextAttachments(dir: string, files: { name: string; mime: string; bytes: number }[]): TextAttachment[] {
  const out: TextAttachment[] = [];
  for (const f of files) {
    if (!TEXT_INLINE_MIMES.has(f.mime) || f.bytes > TEXT_INLINE_MAX) continue;
    try {
      out.push({ name: f.name, mime: f.mime, text: readFileSync(path.join(dir, f.name), "utf8") });
    } catch {
      // skip unreadable attachments; the download link still works
    }
  }
  return out;
}

function handleNamespacePath(
  res: ServerResponse,
  root: string,
  ns: string,
  rest: string[],
  query: URLSearchParams,
): void {
  if (!NS_PATTERN.test(ns) || ns === "schemas") {
    send404(res);
    return;
  }
  const abs = path.resolve(root, ns, ...rest);
  if (!isInside(root, abs) || !existsSync(abs)) {
    send404(res);
    return;
  }
  if (isRecordDir(abs)) {
    const parsed = tryReadEnvelope(abs);
    if (!parsed.ok || !parsed.env) {
      send(res, 500, errorPage(500, "record.json is unreadable."));
      return;
    }
    let view: ReturnType<typeof viewOf> = "record";
    try {
      const resolved = resolveSchema(root, parsed.env.schema, ns);
      view = viewOf(resolved.schema);
    } catch {
      // unresolvable schema falls back to the default view
    }
    const rawBase = `/raw/${[ns, ...rest].map(encodeURIComponent).join("/")}`;
    const textFiles = readTextAttachments(abs, parsed.env.files ?? []);
    send(res, 200, recordPage({ env: parsed.env, ns, segs: rest, view, rawBase, textFiles }));
    return;
  }
  let dirents;
  try {
    dirents = sortedDirents(abs);
  } catch {
    send404(res);
    return;
  }
  const folders: FolderEntry[] = [];
  const collected: RecordEntry[] = [];
  for (const entry of dirents) {
    if (!entry.isDirectory()) continue; // stray files in containers are not listed
    const child = path.join(abs, entry.name);
    if (isRecordDir(child)) {
      const parsed = tryReadEnvelope(child);
      const env = parsed.ok ? parsed.env : undefined;
      collected.push(toRecordEntry(ns, [...rest, entry.name], env, entry.name));
    } else {
      const summary = summarizeFolder(child, ns);
      folders.push({
        name: entry.name,
        href: hrefFor(ns, [...rest, entry.name]),
        records: summary.records,
        schemaHint: summary.hint,
      });
    }
  }
  sortRecords(collected);
  const tally = new Map<string, number>();
  for (const r of collected) tally.set(r.schema, (tally.get(r.schema) ?? 0) + 1);
  const schemas = [...tally.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([id, count]) => ({ id, count }));
  const schemaFilter = query.get("schema") || undefined;
  const filtered = schemaFilter ? collected.filter((r) => r.schema === schemaFilter) : collected;
  const columns = tableColumnsFor(filtered);
  const totalRecords = filtered.length;
  const pageSize = LIST_PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(totalRecords / pageSize) || 1);
  const page = Math.min(parsePage(query.get("page")), pages);
  const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
  const pageInput: Parameters<typeof folderPage>[0] = {
    ns,
    sub: rest,
    folders,
    records: slice,
    page,
    pageSize,
    totalRecords,
    schemas,
    tableColumns: columns,
  };
  if (rest.length === 0) {
    const goal = readNsMeta(root, ns).goal;
    if (goal) pageInput.goal = goal;
  }
  if (schemaFilter) pageInput.schemaFilter = schemaFilter;
  send(res, 200, folderPage(pageInput));
}

function handleRaw(res: ServerResponse, root: string, rest: string[]): void {
  if (rest.length < 2) {
    send404(res);
    return;
  }
  const ns = rest[0] ?? "";
  const file = rest[rest.length - 1] ?? "";
  const dirSegs = rest.slice(0, -1);
  if (!NS_PATTERN.test(ns) || ns === "schemas" || !safeSegment(file)) {
    send404(res);
    return;
  }
  const abs = path.resolve(root, ...dirSegs);
  if (!isInside(root, abs) || !isRecordDir(abs)) {
    send404(res);
    return;
  }
  const parsed = tryReadEnvelope(abs);
  const entry =
    parsed.ok && parsed.env && Array.isArray(parsed.env.files)
      ? parsed.env.files.find((f) => f && typeof f.name === "string" && f.name === file)
      : undefined;
  if (!entry || typeof entry.mime !== "string" || typeof entry.bytes !== "number") {
    send404(res); // only registered attachments are served
    return;
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(path.join(abs, file));
  } catch {
    send404(res);
    return;
  }
  const inline = entry.mime.startsWith("image/");
  const headers: Record<string, string | number> = {
    "Content-Type": entry.mime,
    "Content-Length": isHead(res) ? 0 : bytes.length,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(file)}"`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'",
    "Cache-Control": "no-store",
  };
  res.writeHead(200, headers);
  res.end(isHead(res) ? undefined : bytes);
}

function handleSearch(res: ServerResponse, hub: Hub, query: URLSearchParams): void {
  const q = query.get("q") ?? "";
  const ns = query.get("namespace") || undefined;
  const schema = query.get("schema") || undefined;
  if (ns && (!NS_PATTERN.test(ns) || ns === "schemas")) {
    send404(res);
    return;
  }
  let hits;
  try {
    hits = q ? hub.query({ text: q, ns, schema, limit: 100 }) : [];
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") {
      send404(res);
      return;
    }
    throw e;
  }
  const records: RecordEntry[] = hits.map((h) => ({
    id: h.id,
    href: pathToHref(h.path),
    title: h.title,
    schema: h.schema,
    created: h.created_at.length >= 10 ? h.created_at.slice(0, 10) : h.created_at,
    subtitle: recordSubtitle({
      schemaVersion: 1,
      id: h.id,
      namespace: h.namespace,
      schema: h.schema,
      data: h.data,
      files: [],
      created_at: h.created_at,
      updated_at: h.updated_at,
      ...(h.provenance !== undefined ? { provenance: h.provenance } : {}),
    }),
    data: h.data,
  }));
  const searchInput: Parameters<typeof searchPage>[0] = { q, hits: records };
  if (ns) searchInput.ns = ns;
  if (schema) searchInput.schema = schema;
  send(res, 200, searchPage(searchInput));
}

function handleRecordId(res: ServerResponse, hub: Hub, id: string): void {
  if (!isUlid(id)) {
    send404(res);
    return;
  }
  try {
    const found = hub.get(id);
    redirect(res, pathToHref(found.path));
  } catch (e) {
    if (e instanceof AppError && (e.code === "not_found" || e.code === "invalid_argument")) {
      send404(res);
      return;
    }
    throw e;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse, root: string, hub: Hub): Promise<void> {
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD", "Content-Length": 0 });
    res.end();
    return;
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(req.url ?? "/", "http://127.0.0.1");
  } catch {
    send404(res);
    return;
  }
  const segments = decodeSegments(parsedUrl.pathname);
  if (segments === null) {
    send404(res);
    return;
  }
  const head = segments[0] ?? "";
  if (head === "n") {
    handleNamespacePath(res, root, segments[1] ?? "", segments.slice(2), parsedUrl.searchParams);
    return;
  }
  if (head === "raw") {
    handleRaw(res, root, segments.slice(1));
    return;
  }
  if (head === "q") {
    handleSearch(res, hub, parsedUrl.searchParams);
    return;
  }
  if (head === "r") {
    handleRecordId(res, hub, segments[1] ?? "");
    return;
  }
  if (head === "favicon.ico") {
    send404(res);
    return;
  }
  if (head === "healthz") {
    send(res, 200, healthPage());
    return;
  }
  if (head === "") {
    send(res, 200, namespacePage(namespaceCards(root)));
    return;
  }
  send404(res);
}

/** Start the read-only loopback viewer. GET/HEAD only; nothing ever writes. */
export function startServer(root: string, port = 4124): Promise<Server> {
  const hub = new Hub(root);
  const server = createServer((req, res) => {
    handle(req, res, root, hub).catch(() => {
      if (!res.headersSent) send(res, 500, errorPage(500, "Internal error."));
      else res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
