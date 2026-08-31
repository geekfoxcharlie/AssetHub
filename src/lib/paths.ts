import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { err } from "./errors.js";

export const NS_PATTERN = /^[a-z][a-z0-9-]*$/;
export const SCHEMA_ID_PATTERN = /^[a-z][a-z0-9_-]*$/;
export const RESERVED_IDS = new Set(["schemas"]);

export function resolveRoot(explicit?: string): string {
  const dir =
    explicit ??
    process.env.ASSETHUB_DATA_DIR ??
    (process.env.XDG_DATA_HOME
      ? path.join(process.env.XDG_DATA_HOME, "assethub")
      : path.join(homedir(), ".local", "share", "assethub"));
  return path.resolve(dir);
}

export function nsDir(root: string, ns: string): string {
  return path.join(root, ns);
}

export function nsMetaPath(root: string, ns: string): string {
  return path.join(root, ns, ".ns.json");
}

export function nsSchemasDir(root: string, ns: string): string {
  return path.join(root, ns, ".schemas");
}

export function globalSchemasDir(root: string): string {
  return path.join(root, "schemas");
}

export function schemaFileName(id: string): string {
  return `${id}.schema.json`;
}

export function presetSchemasDir(): string {
  return fileURLToPath(new URL("../assets/schemas", import.meta.url));
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function isDotName(name: string): boolean {
  return name.startsWith(".");
}

export function validateNsId(ns: string): void {
  if (!NS_PATTERN.test(ns)) {
    throw err("invalid_argument", `invalid namespace id '${ns}' (expected ${NS_PATTERN.source})`);
  }
  if (RESERVED_IDS.has(ns)) {
    throw err("invalid_argument", `namespace id '${ns}' is reserved`);
  }
}

export function validateSchemaId(id: string): void {
  if (!SCHEMA_ID_PATTERN.test(id)) {
    throw err("invalid_argument", `invalid schema id '${id}' (expected ${SCHEMA_ID_PATTERN.source})`);
  }
}

/** A safe folder segment: non-empty, not a dotfile (which also excludes ".."). */
export function safeSegment(segment: string): boolean {
  return segment.length > 0 && !isDotName(segment);
}

/**
 * Split a user-supplied relative dir ("a/b") into segments; rejects absolute
 * paths; "." and "" mean the namespace root; traversal segments are rejected.
 */
export function parseRelDir(dir: string): string[] {
  if (path.isAbsolute(dir)) {
    throw err("invalid_argument", `dir must be relative to the namespace, got '${dir}'`);
  }
  const parts = dir
    .split("/")
    .filter((s) => s.length > 0 && s !== "."); // "." is the current dir, harmless
  for (const part of parts) {
    if (!safeSegment(part)) {
      throw err("invalid_argument", `invalid path segment '${part}'`);
    }
  }
  return parts;
}

/** Resolve segments under base, guaranteeing the result stays inside base. */
export function resolveInside(base: string, segments: string[]): string {
  const resolved = path.resolve(base, ...segments);
  const anchored = path.resolve(base);
  if (resolved !== anchored && !resolved.startsWith(anchored + path.sep)) {
    throw err("invalid_argument", "path escapes the namespace");
  }
  return resolved;
}

/** Check that an absolute path stays inside the root (defense in depth). */
export function isInside(base: string, target: string): boolean {
  const anchored = path.resolve(base);
  const resolved = path.resolve(target);
  return resolved === anchored || resolved.startsWith(anchored + path.sep);
}
