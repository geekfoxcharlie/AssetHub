import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { err } from "./errors.js";
import { RECORD_FILE } from "./walk.js";
import type { Attachment, RecordEnvelope } from "./types.js";
import { isUlid } from "./ulid.js";
import { provenanceProblems } from "./provenance.js";

export type AttachmentSource = string | { name: string; bytes: Buffer };

export interface IngestedAttachment {
  attachment: Attachment;
  bytes: Buffer;
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".csv": "text/csv",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

export function mimeByExt(name: string): string {
  const ext = path.extname(name).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export function sha256Bytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function serializeEnvelope(env: RecordEnvelope): string {
  return JSON.stringify(env, null, 2) + "\n";
}

export interface TryRead {
  ok: boolean;
  env?: RecordEnvelope;
  error?: string;
}

/** Parse record.json; does not enforce the envelope shape. */
export function tryReadEnvelope(dir: string): TryRead {
  const file = path.join(dir, RECORD_FILE);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (e) {
    return { ok: false, error: `cannot read ${RECORD_FILE}: ${(e as Error).message}` };
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: `${RECORD_FILE} does not contain a JSON object` };
    }
    return { ok: true, env: parsed as RecordEnvelope };
  } catch (e) {
    return { ok: false, error: `${RECORD_FILE} is not valid JSON: ${(e as Error).message}` };
  }
}

/** Envelope shape problems, including id vs folder name; empty when healthy. */
export function checkShape(env: RecordEnvelope, dirname: string): string[] {
  const problems: string[] = [];
  if (env.schemaVersion !== 1) problems.push(`schemaVersion must be 1, got ${JSON.stringify(env.schemaVersion)}`);
  if (typeof env.id !== "string" || !isUlid(env.id)) problems.push(`id '${String(env.id)}' is not a ULID`);
  else if (env.id !== dirname) problems.push(`id '${env.id}' does not match folder name '${dirname}'`);
  if (typeof env.namespace !== "string" || env.namespace.length === 0) problems.push("namespace must be a non-empty string");
  if (typeof env.schema !== "string" || env.schema.length === 0) problems.push("schema must be a non-empty string");
  if (typeof env.data !== "object" || env.data === null || Array.isArray(env.data)) {
    problems.push("data must be an object");
  }
  if (!Array.isArray(env.files)) problems.push("files must be an array");
  else {
    const seen = new Set<string>();
    for (const f of env.files) {
      if (typeof f !== "object" || f === null) {
        problems.push("files entries must be objects");
        break;
      }
      const entry = f as Partial<Attachment>;
      if (typeof entry.name !== "string" || entry.name.length === 0) problems.push("a files entry has no name");
      else if (seen.has(entry.name)) problems.push(`duplicate attachment name '${entry.name}'`);
      else seen.add(entry.name);
      if (typeof entry.mime !== "string") problems.push(`attachment '${String(entry.name)}' has no mime`);
      if (typeof entry.bytes !== "number") problems.push(`attachment '${String(entry.name)}' has no bytes`);
      if (typeof entry.hash !== "string") problems.push(`attachment '${String(entry.name)}' has no hash`);
    }
  }
  if (typeof env.created_at !== "string") problems.push("created_at must be a string");
  if (typeof env.updated_at !== "string") problems.push("updated_at must be a string");
  if (env.provenance !== undefined) problems.push(...provenanceProblems(env.provenance));
  return problems;
}

/** Read and fully shape-check a record; throws invalid_record on any problem. */
export function readEnvelope(dir: string): RecordEnvelope {
  const parsed = tryReadEnvelope(dir);
  if (!parsed.ok || !parsed.env) {
    throw err("invalid_record", `${path.basename(dir)}: ${parsed.error ?? "unreadable record"}`);
  }
  const problems = checkShape(parsed.env, path.basename(dir));
  if (problems.length > 0) {
    throw err("invalid_record", `${path.basename(dir)}: ${problems.join("; ")}`);
  }
  return parsed.env;
}

/** Copy/hash an attachment from a path or in-memory bytes. Name uniqueness is the caller's job. */
export function ingestAttachment(source: AttachmentSource): IngestedAttachment {
  if (typeof source === "string") {
    let bytes: Buffer;
    try {
      bytes = readFileSync(source);
    } catch {
      throw err("invalid_argument", `cannot read attachment file: ${source}`);
    }
    const name = path.basename(source);
    return { attachment: { name, mime: mimeByExt(name), bytes: bytes.length, hash: sha256Bytes(bytes) }, bytes };
  }
  const name = source.name;
  if (name.length === 0 || name.startsWith(".") || name.includes("/")) {
    throw err("invalid_argument", `invalid attachment name '${name}'`);
  }
  return {
    attachment: { name, mime: mimeByExt(name), bytes: source.bytes.length, hash: sha256Bytes(source.bytes) },
    bytes: source.bytes,
  };
}

/**
 * Atomically write a record folder: assemble a dotfile temp sibling (skipped by
 * walkers), then rename it into place; an existing target is swapped out first.
 */
export function writeRecordAtomic(targetDir: string, env: RecordEnvelope, fileBytes: Map<string, Buffer>): void {
  const parent = path.dirname(targetDir);
  mkdirSync(parent, { recursive: true });
  const base = path.basename(targetDir);
  const uniq = `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const tmp = path.join(parent, `.${base}.tmp-${uniq}`);
  const gone = path.join(parent, `.${base}.old-${uniq}`);
  mkdirSync(tmp);
  try {
    writeFileSync(path.join(tmp, RECORD_FILE), serializeEnvelope(env));
    for (const [name, bytes] of fileBytes) {
      writeFileSync(path.join(tmp, name), bytes);
    }
    if (existsSync(targetDir)) {
      renameSync(targetDir, gone);
      renameSync(tmp, targetDir);
      rmSync(gone, { recursive: true, force: true });
    } else {
      renameSync(tmp, targetDir);
    }
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw err("io_error", `failed to write record ${base}: ${(e as Error).message}`);
  }
}

/** Rewrite only record.json via temp file + rename. */
export function rewriteRecordJson(dir: string, env: RecordEnvelope): void {
  const target = path.join(dir, RECORD_FILE);
  const tmp = path.join(dir, `.${RECORD_FILE}.tmp-${process.pid}-${Math.floor(Math.random() * 1e9)}`);
  writeFileSync(tmp, serializeEnvelope(env));
  renameSync(tmp, target);
}

/** Non-dotfile disk entries in a record folder. */
export function listDiskFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith(".") && e.name !== RECORD_FILE)
    .map((e) => e.name)
    .sort();
}

const BODY_KEYS = ["content", "text", "body", "bio", "excerpt", "description"];

/** Display title: title → name → first sentence of a body field → id. */
export function recordTitle(env: RecordEnvelope): string {
  const data = env.data ?? {};
  for (const key of ["title", "name"]) {
    const v = data[key];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  for (const key of BODY_KEYS) {
    const v = data[key];
    if (typeof v === "string" && v.trim().length > 0) {
      return v.length > 48 ? v.slice(0, 48) + "…" : v;
    }
  }
  return env.id;
}

/** First long-text field, for body rendering in the viewer. */
export function recordBody(env: RecordEnvelope): string {
  const data = env.data ?? {};
  for (const key of BODY_KEYS) {
    const v = data[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "";
}
