import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { NS_PATTERN, isInside, safeSegment } from "../lib/paths.js";
import { countRecordsUnder, isRecordDir } from "../lib/walk.js";
import { resolveSchema } from "../lib/schema.js";
import { recordTitle, tryReadEnvelope } from "../lib/format.js";
import {
  errorPage,
  folderPage,
  namespacePage,
  recordPage,
  viewOf,
  type FolderEntry,
  type NamespaceCard,
  type RecordEntry,
} from "./html.js";

const HTML_HEADERS: Record<string, string | number> = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

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

function namespaceCards(root: string): NamespaceCard[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "schemas" && NS_PATTERN.test(e.name))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((e) => {
      let name = e.name;
      let goal = "";
      try {
        const meta = JSON.parse(readFileSync(path.join(root, e.name, ".ns.json"), "utf8")) as { name?: unknown; goal?: unknown };
        if (typeof meta.name === "string") name = meta.name;
        if (typeof meta.goal === "string") goal = meta.goal;
      } catch {
        // tolerate unreadable metadata
      }
      return { id: e.name, name, goal, records: countRecordsUnder(path.join(root, e.name), e.name) };
    });
}

function handleNamespacePath(res: ServerResponse, root: string, ns: string, rest: string[]): void {
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
    send(res, 200, recordPage({ env: parsed.env, ns, segs: rest, view, rawBase }));
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
  const records: RecordEntry[] = [];
  for (const entry of dirents) {
    if (!entry.isDirectory()) continue; // stray files in containers are not listed
    const child = path.join(abs, entry.name);
    if (isRecordDir(child)) {
      const parsed = tryReadEnvelope(child);
      const env = parsed.ok ? parsed.env : undefined;
      records.push({
        id: env && typeof env.id === "string" ? env.id : entry.name,
        href: hrefFor(ns, [...rest, entry.name]),
        title: env ? recordTitle(env) : entry.name,
        schema: env && typeof env.schema === "string" ? env.schema : "?",
        created:
          env && typeof env.created_at === "string" && env.created_at.length >= 10
            ? env.created_at.slice(0, 10)
            : "",
      });
    } else {
      folders.push({
        name: entry.name,
        href: hrefFor(ns, [...rest, entry.name]),
        records: countRecordsUnder(child, ns),
      });
    }
  }
  send(res, 200, folderPage(ns, rest, folders, records));
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

async function handle(req: IncomingMessage, res: ServerResponse, root: string): Promise<void> {
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD", "Content-Length": 0 });
    res.end();
    return;
  }
  const segments = decodeSegments(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
  if (segments === null) {
    send404(res);
    return;
  }
  const head = segments[0] ?? "";
  if (head === "n") {
    handleNamespacePath(res, root, segments[1] ?? "", segments.slice(2));
    return;
  }
  if (head === "raw") {
    handleRaw(res, root, segments.slice(1));
    return;
  }
  if (head === "favicon.ico") {
    send404(res);
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
  const server = createServer((req, res) => {
    handle(req, res, root).catch(() => {
      if (!res.headersSent) send(res, 500, errorPage(500, "Internal error."));
      else res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
