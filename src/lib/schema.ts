import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Ajv } from "ajv";
import type { FormatsPlugin } from "ajv-formats";
import { err } from "./errors.js";
import {
  ensureDir,
  globalSchemasDir,
  nsSchemasDir,
  presetSchemasDir,
  schemaFileName,
  validateSchemaId,
} from "./paths.js";

export type SchemaSource = "project" | "global" | "preset";

export interface ResolvedSchema {
  id: string;
  source: SchemaSource;
  /** Absolute path; null for presets bundled in dist/. */
  file: string | null;
  schema: Record<string, unknown>;
}

export interface SchemaListEntry {
  id: string;
  source: SchemaSource;
  title: string;
  file: string | null;
}

const ajv = new Ajv({ allErrors: true });
// ajv-formats ships CJS typings without `export =`; load it through require with its own type.
const require = createRequire(import.meta.url);
const addFormats = require("ajv-formats") as FormatsPlugin;
addFormats(ajv);
// x-assethub carries view hints; declare it so Ajv ignores it quietly.
void ajv.addKeyword("x-assethub");

type ValidateFn = ReturnType<typeof ajv.compile>;
const compileCache = new Map<string, ValidateFn>();

function compileCached(schema: Record<string, unknown>): ValidateFn {
  const key = createHash("sha256").update(JSON.stringify(schema)).digest("hex");
  const hit = compileCache.get(key);
  if (hit) return hit;
  let fn: ValidateFn;
  try {
    fn = ajv.compile(schema);
  } catch (e) {
    throw err("invalid_schema", `schema does not compile: ${(e as Error).message}`);
  }
  compileCache.set(key, fn);
  return fn;
}

/** Validate data against a schema; returns human-readable errors (empty when valid). */
export function validateData(schema: Record<string, unknown>, data: unknown): string[] {
  const fn = compileCached(schema);
  if (fn(data)) return [];
  return (fn.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`.trim());
}

function parseSchemaFile(file: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw err("invalid_schema", `cannot read schema file: ${file}`);
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("schema must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    throw err("invalid_schema", `schema file is not valid JSON: ${file} (${(e as Error).message})`);
  }
}

function tryParseSchemaFile(file: string): Record<string, unknown> | null {
  try {
    return parseSchemaFile(file);
  } catch {
    return null;
  }
}

/** Resolve a schema id: project → global → preset. Throws not_found when unresolvable. */
export function resolveSchema(root: string, id: string, ns?: string): ResolvedSchema {
  validateSchemaId(id);
  const candidates: { source: SchemaSource; file: string }[] = [];
  if (ns) {
    candidates.push({ source: "project", file: path.join(nsSchemasDir(root, ns), schemaFileName(id)) });
  }
  candidates.push({ source: "global", file: path.join(globalSchemasDir(root), schemaFileName(id)) });
  candidates.push({ source: "preset", file: path.join(presetSchemasDir(), schemaFileName(id)) });
  for (const c of candidates) {
    if (existsSync(c.file)) {
      return { id, source: c.source, file: c.source === "preset" ? null : c.file, schema: parseSchemaFile(c.file) };
    }
  }
  throw err("not_found", `schema '${id}' not found`);
}

function idsIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".schema.json"))
    .map((e) => e.name.slice(0, -".schema.json".length))
    .sort();
}

/** Merge the three registries; each id appears once, marked with its winning source. */
export function listSchemas(root: string, ns?: string): SchemaListEntry[] {
  const merged = new Map<string, { source: SchemaSource; file: string | null }>();
  for (const id of idsIn(presetSchemasDir())) {
    merged.set(id, { source: "preset", file: null });
  }
  for (const id of idsIn(globalSchemasDir(root))) {
    merged.set(id, { source: "global", file: path.join(globalSchemasDir(root), schemaFileName(id)) });
  }
  if (ns) {
    for (const id of idsIn(nsSchemasDir(root, ns))) {
      merged.set(id, { source: "project", file: path.join(nsSchemasDir(root, ns), schemaFileName(id)) });
    }
  }
  return [...merged.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([id, loc]) => {
      const schema = loc.file !== null ? tryParseSchemaFile(loc.file) : tryParseSchemaFile(path.join(presetSchemasDir(), schemaFileName(id)));
      const title = schema && typeof schema["title"] === "string" ? schema["title"] : "";
      return { id, source: loc.source, title, file: loc.file };
    });
}

export interface AddedSchema {
  id: string;
  source: SchemaSource;
  file: string;
}

/**
 * Register a schema after verifying it compiles. Source is a file path or an
 * already-parsed schema object (used by demo/tests). Duplicate id in the same
 * registry is already_exists.
 */
export function addSchema(
  root: string,
  id: string,
  source: string | Record<string, unknown>,
  ns?: string,
): AddedSchema {
  validateSchemaId(id);
  const schema = typeof source === "string" ? parseSchemaFile(source) : source;
  compileCached(schema); // throws invalid_schema when it does not compile
  const registryDir = ns ? nsSchemasDir(root, ns) : globalSchemasDir(root);
  const target = path.join(registryDir, schemaFileName(id));
  if (existsSync(target)) {
    throw err(
      "already_exists",
      `schema '${id}' already exists in the ${ns ? "project" : "global"} registry`,
    );
  }
  ensureDir(registryDir);
  writeFileSync(target, JSON.stringify(schema, null, 2) + "\n");
  return { id, source: ns ? "project" : "global", file: target };
}
