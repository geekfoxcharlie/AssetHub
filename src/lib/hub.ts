import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Finding, NamespaceInfo, ProvenanceEntry, RecordEnvelope } from "./types.js";
import { provenanceProblems } from "./provenance.js";
import {
  addSchema as addSchemaToRegistry,
  listSchemas,
  resolveSchema,
  validateData,
  type SchemaListEntry,
} from "./schema.js";
import {
  ensureDir,
  nsDir,
  nsMetaPath,
  nsSchemasDir,
  parseRelDir,
  resolveInside,
  validateNsId,
  validateSchemaId,
} from "./paths.js";
import { err } from "./errors.js";
import {
  checkShape,
  ingestAttachment,
  listDiskFiles,
  readEnvelope,
  recordTitle,
  rewriteRecordJson,
  sha256Bytes,
  tryReadEnvelope,
  writeRecordAtomic,
  type AttachmentSource,
} from "./format.js";
import { countRecordsUnder, listNamespaces, locateById, walkRecords, walkRecordsUnder, type FoundRecord } from "./walk.js";
import { isUlid, ulid, ulidFromKey } from "./ulid.js";

export interface NsMeta {
  name: string;
  goal: string;
  created_at: string;
}

export interface PutInput {
  ns: string;
  dir: string;
  schemaId?: string | undefined;
  id?: string | undefined;
  data: Record<string, unknown>;
  /** When given, replaces the attachment list; when omitted, previous files are kept. */
  files?: AttachmentSource[] | undefined;
  /** Omission preserves existing provenance; a supplied array replaces it; [] clears it. */
  provenance?: ProvenanceEntry[] | undefined;
}

export interface PutResult {
  created: boolean;
  record: RecordEnvelope;
  /** Path relative to the root, "/"-separated. */
  path: string;
}

export interface QueryInput {
  text?: string | undefined;
  ns?: string | undefined;
  schema?: string | undefined;
  limit?: number | undefined;
}

export interface QueryHit {
  id: string;
  namespace: string;
  schema: string;
  title: string;
  path: string;
  created_at: string;
  updated_at: string;
  data: Record<string, unknown>;
  provenance?: ProvenanceEntry[];
}

export interface ValidateResult {
  namespace: string | null;
  records: number;
  findings: Finding[];
}

export class Hub {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  // ------------------------------------------------------------- namespaces

  addNamespace(
    id: string,
    meta: { name?: string | undefined; goal?: string | undefined } = {},
  ): NamespaceInfo {
    validateNsId(id);
    const dir = nsDir(this.root, id);
    if (existsSync(dir)) {
      throw err("already_exists", `namespace '${id}' already exists at ${path.relative(this.root, dir) || id}`);
    }
    ensureDir(dir);
    const full: NsMeta = {
      name: meta.name ?? id,
      goal: meta.goal ?? "",
      created_at: new Date().toISOString(),
    };
    writeFileSync(nsMetaPath(this.root, id), JSON.stringify(full, null, 2) + "\n");
    return { id, name: full.name, goal: full.goal, records: 0, created_at: full.created_at, path: id };
  }

  private readNsMeta(id: string): NsMeta | null {
    const file = nsMetaPath(this.root, id);
    if (!existsSync(file)) return null;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (typeof parsed !== "object" || parsed === null) return null;
      const p = parsed as Partial<NsMeta>;
      return {
        name: typeof p.name === "string" ? p.name : id,
        goal: typeof p.goal === "string" ? p.goal : "",
        created_at: typeof p.created_at === "string" ? p.created_at : "",
      };
    } catch {
      return null;
    }
  }

  listNamespaces(): NamespaceInfo[] {
    return listNamespaces(this.root).map((entry) => {
      const meta = this.readNsMeta(entry.id);
      return {
        id: entry.id,
        name: meta?.name ?? entry.id,
        goal: meta?.goal ?? "",
        records: countRecordsUnder(entry.dir, entry.id),
        created_at: meta?.created_at ?? null,
        path: entry.id,
      };
    });
  }

  showNamespace(id: string): NamespaceInfo {
    validateNsId(id);
    const dir = nsDir(this.root, id);
    if (!existsSync(dir)) {
      throw err("not_found", `namespace '${id}' not found`);
    }
    const meta = this.readNsMeta(id);
    return {
      id,
      name: meta?.name ?? id,
      goal: meta?.goal ?? "",
      records: countRecordsUnder(dir, id),
      created_at: meta?.created_at ?? null,
      path: id,
    };
  }

  // ---------------------------------------------------------------- schemas

  addSchema(id: string, source: string | Record<string, unknown>, ns?: string): SchemaListEntry {
    if (ns !== undefined) {
      validateNsId(ns);
      if (!existsSync(nsDir(this.root, ns))) {
        throw err("not_found", `namespace '${ns}' not found`);
      }
    }
    validateSchemaId(id);
    const added = addSchemaToRegistry(this.root, id, source, ns);
    return { id: added.id, source: added.source, title: "", file: added.file };
  }

  listSchemas(ns?: string): SchemaListEntry[] {
    if (ns !== undefined) {
      validateNsId(ns);
      if (!existsSync(nsDir(this.root, ns))) {
        throw err("not_found", `namespace '${ns}' not found`);
      }
    }
    return listSchemas(this.root, ns);
  }

  showSchema(id: string, ns?: string) {
    if (ns !== undefined) {
      validateNsId(ns);
      if (!existsSync(nsDir(this.root, ns))) {
        throw err("not_found", `namespace '${ns}' not found`);
      }
    }
    return resolveSchema(this.root, id, ns);
  }

  // ---------------------------------------------------------------- records

  /** Locate a record by envelope id; optionally restricted to one namespace. */
  locate(id: string, ns?: string): (FoundRecord & { env: RecordEnvelope }) | null {
    const reader = (dir: string): { ok: true; id: string } | { ok: false } => {
      const parsed = tryReadEnvelope(dir);
      if (parsed.ok && parsed.env && typeof parsed.env.id === "string") {
        return { ok: true, id: parsed.env.id };
      }
      return { ok: false };
    };
    const found = locateById(this.root, id, reader, ns);
    if (!found) return null;
    const parsed = tryReadEnvelope(found.dir);
    if (!parsed.ok || !parsed.env) return null;
    return { ...found, env: parsed.env };
  }

  put(input: PutInput): PutResult {
    const { ns } = input;
    validateNsId(ns);
    const rootNs = nsDir(this.root, ns);
    if (!existsSync(rootNs)) {
      throw err("not_found", `namespace '${ns}' is not registered (run: namespace add ${ns})`);
    }
    const segments = parseRelDir(input.dir);
    const dirTarget = resolveInside(rootNs, segments);

    let id: string;
    if (input.id !== undefined) {
      if (!isUlid(input.id)) throw err("invalid_argument", `--id '${input.id}' is not a ULID`);
      id = input.id;
    } else {
      id = ulid();
    }

    // Identity survives moves: locate by envelope id across the whole root.
    const existingAll = this.locate(id);
    let existing: { dir: string; env: RecordEnvelope } | null = null;
    if (existingAll) {
      if (existingAll.namespace !== ns) {
        throw err("not_found", `record '${id}' belongs to namespace '${existingAll.namespace}'`);
      }
      existing = { dir: existingAll.dir, env: existingAll.env };
    }

    const schemaId = input.schemaId ?? existing?.env.schema;
    if (!schemaId) {
      throw err("invalid_argument", "--schema is required when creating a record");
    }
    if (existing && input.schemaId !== undefined && input.schemaId !== existing.env.schema) {
      throw err("invalid_argument", `schema is immutable on update (record uses '${existing.env.schema}')`);
    }

    const resolved = resolveSchema(this.root, schemaId, ns);
    const problems = validateData(resolved.schema, input.data);
    if (problems.length > 0) {
      throw err("invalid_data", `data does not match schema '${schemaId}': ${problems.join("; ")}`);
    }

    const provenance = input.provenance === undefined ? existing?.env.provenance : input.provenance;
    if (provenance !== undefined) {
      const issues = provenanceProblems(provenance);
      if (issues.length) throw err("invalid_data", issues.join("; "));
    }

    const now = new Date().toISOString();
    const fileBytes = new Map<string, Buffer>();
    let files: RecordEnvelope["files"];
    if (input.files !== undefined) {
      const names = new Set<string>();
      files = [];
      for (const source of input.files) {
        const ingested = ingestAttachment(source);
        if (names.has(ingested.attachment.name)) {
          throw err("invalid_argument", `duplicate attachment name '${ingested.attachment.name}'`);
        }
        names.add(ingested.attachment.name);
        files.push(ingested.attachment);
        fileBytes.set(ingested.attachment.name, ingested.bytes);
      }
    } else if (existing) {
      files = existing.env.files;
      for (const att of existing.env.files) {
        const file = path.join(existing.dir, att.name);
        try {
          fileBytes.set(att.name, readFileSync(file));
        } catch {
          throw err("io_error", `cannot keep attachment '${att.name}' (missing on disk): ${file}`);
        }
      }
    } else {
      files = [];
    }

    const env: RecordEnvelope = existing
      ? {
          ...existing.env,
          namespace: ns,
          data: input.data,
          files,
          updated_at: now,
        }
      : {
          schemaVersion: 1,
          id,
          namespace: ns,
          schema: schemaId,
          data: input.data,
          files,
          created_at: now,
          updated_at: now,
        };

    const targetDir = existing ? existing.dir : path.join(dirTarget, id);
    if (provenance !== undefined) env.provenance = provenance;
    writeRecordAtomic(targetDir, env, fileBytes);
    return { created: !existing, record: env, path: this.rel(targetDir) };
  }

  get(id: string): { record: RecordEnvelope; namespace: string; path: string } {
    if (!isUlid(id)) throw err("invalid_argument", `'${id}' is not a ULID`);
    const found = this.locate(id);
    if (!found) throw err("not_found", `record '${id}' not found`);
    return { record: readEnvelope(found.dir), namespace: found.namespace, path: this.rel(found.dir) };
  }

  query(input: QueryInput): QueryHit[] {
    if (input.ns !== undefined) validateNsId(input.ns);
    if (input.schema !== undefined) validateSchemaId(input.schema);
    const iterator =
      input.ns !== undefined
        ? walkRecordsUnder(nsDir(this.root, input.ns), input.ns)
        : walkRecords(this.root);
    const hits: QueryHit[] = [];
    for (const found of iterator) {
      const parsed = tryReadEnvelope(found.dir);
      if (!parsed.ok || !parsed.env) continue;
      const env = parsed.env;
      if (input.schema !== undefined && env.schema !== input.schema) continue;
      if (input.text !== undefined && input.text.length > 0 && !matchesText(env, input.text)) continue;
      hits.push({
        id: env.id,
        namespace: found.namespace,
        schema: env.schema,
        title: recordTitle(env),
        path: this.rel(found.dir),
        created_at: env.created_at,
        updated_at: env.updated_at,
        data: env.data,
        ...(env.provenance !== undefined ? { provenance: env.provenance } : {}),
      });
    }
    hits.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id < a.id ? -1 : b.id > a.id ? 1 : 0));
    const limit = input.limit ?? 100;
    return hits.slice(0, limit);
  }

  deleteRecord(ns: string, id: string): { id: string; path: string } {
    validateNsId(ns);
    if (!isUlid(id)) throw err("invalid_argument", `'${id}' is not a ULID`);
    const found = this.locate(id);
    if (!found || found.namespace !== ns) {
      throw err("not_found", `record '${id}' not found in namespace '${ns}'`);
    }
    rmSync(found.dir, { recursive: true, force: true });
    return { id, path: this.rel(found.dir) };
  }

  deleteAttachment(ns: string, id: string, name: string): { id: string; removed: string; path: string } {
    validateNsId(ns);
    if (!isUlid(id)) throw err("invalid_argument", `'${id}' is not a ULID`);
    const found = this.locate(id);
    if (!found || found.namespace !== ns) {
      throw err("not_found", `record '${id}' not found in namespace '${ns}'`);
    }
    const env = readEnvelope(found.dir);
    const entry = env.files.find((f) => f.name === name);
    if (!entry) {
      throw err("not_found", `attachment '${name}' is not registered on record '${id}'`);
    }
    rmSync(path.join(found.dir, name), { force: true });
    const next: RecordEnvelope = { ...env, files: env.files.filter((f) => f.name !== name), updated_at: new Date().toISOString() };
    rewriteRecordJson(found.dir, next);
    return { id, removed: name, path: this.rel(found.dir) };
  }

  // --------------------------------------------------------------- integrity

  validate(ns?: string): ValidateResult {
    if (ns !== undefined) {
      validateNsId(ns);
      if (!existsSync(nsDir(this.root, ns))) {
        throw err("not_found", `namespace '${ns}' not found`);
      }
    }
    const findings: Finding[] = [];
    const iterator = ns !== undefined ? walkRecordsUnder(nsDir(this.root, ns), ns) : walkRecords(this.root);
    let records = 0;
    for (const found of iterator) {
      records++;
      const rel = this.rel(found.dir);
      const dirname = path.basename(found.dir);
      const parsed = tryReadEnvelope(found.dir);
      if (!parsed.ok || !parsed.env) {
        findings.push({ code: "invalid_record", path: rel, message: parsed.error ?? "unreadable record" });
        continue;
      }
      const env = parsed.env;
      const shapeProblems = checkShape(env, dirname);
      if (shapeProblems.length > 0) {
        findings.push({ code: "invalid_record", path: rel, message: shapeProblems.join("; ") });
      }
      if (typeof env.namespace === "string" && env.namespace !== found.namespace) {
        findings.push({
          code: "namespace_mismatch",
          path: rel,
          message: `envelope namespace '${env.namespace}' does not match folder '${found.namespace}'`,
        });
      }
      if (typeof env.schema === "string") {
        try {
          const resolved = resolveSchema(this.root, env.schema, found.namespace);
          const problems = validateData(resolved.schema, env.data);
          if (problems.length > 0) {
            findings.push({ code: "invalid_data", path: rel, message: problems.join("; ") });
          }
        } catch (e) {
          findings.push({
            code: "not_found",
            path: rel,
            message: `schema '${env.schema}' cannot be resolved${(e as Error).message ? `: ${(e as Error).message}` : ""}`,
          });
        }
      }
      if (Array.isArray(env.files)) {
        const registered = new Set<string>();
        for (const att of env.files) {
          if (!att || typeof att.name !== "string") continue;
          registered.add(att.name);
          const file = path.join(found.dir, att.name);
          if (!existsSync(file)) {
            findings.push({ code: "missing_file", path: rel, message: `attachment '${att.name}' is registered but missing on disk` });
            continue;
          }
          try {
            const actual = sha256Bytes(readFileSync(file));
            if (typeof att.hash === "string" && actual !== att.hash) {
              findings.push({ code: "hash_mismatch", path: rel, message: `attachment '${att.name}' hash mismatch (expected ${att.hash}, found ${actual})` });
            }
          } catch (e) {
            findings.push({ code: "missing_file", path: rel, message: `attachment '${att.name}' cannot be read: ${(e as Error).message}` });
          }
        }
        for (const name of listDiskFiles(found.dir)) {
          if (!registered.has(name)) {
            findings.push({ code: "unregistered_file", path: rel, message: `file '${name}' sits in the record folder but is not registered in files[]` });
          }
        }
      }
    }
    return { namespace: ns ?? null, records, findings };
  }

  idfor(key: string): string {
    return ulidFromKey(key);
  }

  // ----------------------------------------------------------------- helpers

  private rel(dir: string): string {
    return path.relative(this.root, dir).split(path.sep).join("/");
  }
}

/** Substring match over the id plus content/provenance values (never JSON keys). */
function matchesText(env: RecordEnvelope, text: string): boolean {
  if (typeof env.id === "string" && env.id.includes(text)) return true;
  return leafValues([env.data, env.provenance]).some((v) => v.includes(text));
}

function leafValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "number" || typeof value === "boolean") out.push(String(value));
  else if (Array.isArray(value)) {
    for (const item of value) leafValues(item, out);
  } else if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) leafValues(item, out);
  }
  return out;
}
