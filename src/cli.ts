#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Hub } from "./lib/hub.js";
import { AppError, err } from "./lib/errors.js";
import { resolveRoot } from "./lib/paths.js";
import { seedDemo } from "./lib/demo.js";
import { buildContext, renderContextHuman } from "./lib/context.js";
import { startServer } from "./web/server.js";
import type { CliEnvelope, ProvenanceEntry } from "./lib/types.js";
import { provenanceProblems } from "./lib/provenance.js";

// ------------------------------------------------------------------ arg parsing

const BOOLEAN_OPTS = new Set(["json"]);
const REPEAT_OPTS = new Set(["file", "data-inline"]);

interface Parsed {
  positionals: string[];
  opts: Map<string, string | true | string[]>;
}

function parseArgv(argv: string[]): Parsed {
  const positionals: string[] = [];
  const opts = new Map<string, string | true | string[]>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? "";
    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    let name = token;
    let inline: string | undefined;
    const eq = token.indexOf("=");
    if (eq >= 0) {
      name = token.slice(0, eq);
      inline = token.slice(eq + 1);
    }
    const key = name.slice(2);
    if (!/^[a-z][a-z0-9-]*$/.test(key)) {
      throw err("invalid_argument", `unknown option '${token}'`);
    }
    if (BOOLEAN_OPTS.has(key)) {
      if (inline !== undefined) throw err("invalid_argument", `option '--${key}' does not take a value`);
      opts.set(key, true);
      continue;
    }
    let value = inline;
    if (value === undefined) {
      const next = argv[++i];
      if (next === undefined) throw err("invalid_argument", `option '--${key}' requires a value`);
      value = next;
    }
    if (REPEAT_OPTS.has(key)) {
      const list = Array.isArray(opts.get(key)) ? (opts.get(key) as string[]) : [];
      list.push(value);
      opts.set(key, list);
    } else {
      opts.set(key, value);
    }
  }
  return { positionals, opts };
}

function checkAllowed(opts: Map<string, string | true | string[]>, allowed: Set<string>): void {
  for (const key of opts.keys()) {
    if (!allowed.has(key)) {
      throw err("invalid_argument", `option '--${key}' is not valid for this command`);
    }
  }
}

function optString(opts: Map<string, string | true | string[]>, name: string): string | undefined {
  const v = opts.get(name);
  if (v === undefined || v === true) return undefined;
  return Array.isArray(v) ? v[v.length - 1] : v;
}

function optList(opts: Map<string, string | true | string[]>, name: string): string[] {
  const v = opts.get(name);
  if (v === undefined || v === true) return [];
  return Array.isArray(v) ? v : [v];
}

function requireArg(args: string[], index: number, what: string): string {
  const v = args[index];
  if (v === undefined) throw err("invalid_argument", `missing <${what}> argument`);
  return v;
}

function noExtraArgs(args: string[], used: number, command: string): void {
  if (args.length > used) {
    throw err("invalid_argument", `unexpected argument '${args[used]}' for '${command}'`);
  }
}

// ------------------------------------------------------------------- put input

function buildData(opts: Map<string, string | true | string[]>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const raw = optString(opts, "data");
  if (raw !== undefined) {
    let source = raw;
    if (source.startsWith("@")) {
      const file = source.slice(1);
      try {
        source = readFileSync(file, "utf8");
      } catch {
        throw err("invalid_argument", `cannot read --data file '${file}'`);
      }
    }
    try {
      const parsed = JSON.parse(source);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("must be a JSON object");
      }
      Object.assign(data, parsed as Record<string, unknown>);
    } catch (e) {
      throw err("invalid_argument", `--data is not a valid JSON object: ${(e as Error).message}`);
    }
  }
  for (const pair of optList(opts, "data-inline")) {
    const eq = pair.indexOf("=");
    if (eq < 1) throw err("invalid_argument", `--data-inline expects k=v, got '${pair}'`);
    const key = pair.slice(0, eq);
    data[key] = pair.slice(eq + 1); // inline values stay strings
  }
  if (Object.keys(data).length === 0) {
    throw err("invalid_argument", "provide --data @file.json or --data-inline k=v");
  }
  return data;
}

// ---------------------------------------------------------------- human output

function buildProvenance(raw: string | undefined): ProvenanceEntry[] | undefined {
  if (raw === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw);
  } catch {
    throw err("invalid_argument", "--provenance requires a JSON array or a readable @file.json");
  }
  const problems = provenanceProblems(value);
  if (problems.length) throw err("invalid_data", problems.join("; "));
  return value as ProvenanceEntry[];
}

function human(command: string, data: unknown): string {
  const lines: string[] = [];
  switch (command) {
    case "namespace add": {
      const d = data as { id: string; path: string };
      lines.push(`namespace '${d.id}' added at ${d.path}`);
      break;
    }
    case "namespace list": {
      const items = data as { id: string; name: string; goal: string; records: number }[];
      if (!items.length) lines.push("no namespaces (create one with: namespace add <id>)");
      for (const n of items) lines.push(`${n.id.padEnd(20)}${String(n.records).padStart(5)}  ${n.name}${n.goal ? ` — ${n.goal}` : ""}`);
      break;
    }
    case "namespace show": {
      const n = data as { id: string; name: string; goal: string; records: number; created_at: string | null; path: string };
      lines.push(`id        ${n.id}`);
      lines.push(`name      ${n.name}`);
      lines.push(`goal      ${n.goal || "(none)"}`);
      lines.push(`records   ${n.records}`);
      lines.push(`created   ${n.created_at ?? "(unknown)"}`);
      lines.push(`path      ${n.path}`);
      break;
    }
    case "schema add": {
      const d = data as { id: string; source: string; file: string };
      lines.push(`schema '${d.id}' registered in the ${d.source} registry`);
      lines.push(`  ${d.file}`);
      break;
    }
    case "schema list": {
      const items = data as { id: string; source: string; title: string }[];
      if (!items.length) lines.push("no schemas registered");
      for (const s of items) lines.push(`${s.id.padEnd(20)}${s.source.padEnd(8)}${s.title}`);
      break;
    }
    case "schema show": {
      const d = data as { id: string; source: string; file: string | null; schema: unknown };
      lines.push(`id       ${d.id}`);
      lines.push(`source   ${d.source}${d.file ? ` (${d.file})` : " (built-in)"}`);
      lines.push(JSON.stringify(d.schema, null, 2));
      break;
    }
    case "put": {
      const d = data as { created: boolean; record: { id: string; schema: string; files: { name: string }[] }; path: string };
      lines.push(`${d.created ? "created" : "updated"} ${d.record.id} [${d.record.schema}] at ${d.path}`);
      if (d.record.files.length) lines.push(`  files: ${d.record.files.map((f) => f.name).join(", ")}`);
      break;
    }
    case "get": {
      const d = data as { record: unknown; namespace: string; path: string };
      lines.push(`path      ${d.path}`);
      lines.push(`namespace ${d.namespace}`);
      lines.push(JSON.stringify(d.record, null, 2));
      break;
    }
    case "query": {
      const hits = data as { id: string; created_at: string; namespace: string; schema: string; title: string; path: string }[];
      lines.push(`${hits.length} record${hits.length === 1 ? "" : "s"}`);
      for (const h of hits) lines.push(`${h.created_at}  ${h.id}  ${(`${h.namespace}/${h.schema}`).padEnd(24)}  ${h.title}  → ${h.path}`);
      break;
    }
    case "delete": {
      const d = data as { id: string; path: string; removed?: string };
      if (d.removed !== undefined) lines.push(`deleted file '${d.removed}' from record ${d.id} (${d.path})`);
      else lines.push(`deleted record ${d.id} (${d.path})`);
      break;
    }
    case "idfor": {
      lines.push(String(data));
      break;
    }
    case "validate": {
      const d = data as { namespace: string | null; records: number; findings: { code: string; path: string; message: string }[] };
      lines.push(`checked ${d.records} record${d.records === 1 ? "" : "s"}${d.namespace ? ` in '${d.namespace}'` : ""}`);
      if (!d.findings.length) lines.push("no findings — the tree is healthy");
      for (const f of d.findings) lines.push(`${f.path}  [${f.code}]  ${f.message}`);
      if (d.findings.length) lines.push(`${d.findings.length} finding${d.findings.length === 1 ? "" : "s"}`);
      break;
    }
    case "demo": {
      const d = data as { namespace: string; schemas: string[]; records: { id: string; schema: string; path: string; files: string[] }[] };
      lines.push(`namespace '${d.namespace}' ready; schemas: ${d.schemas.join(", ")}`);
      for (const r of d.records) lines.push(`  ${r.id}  [${r.schema}]  ${r.path}${r.files.length ? `  (${r.files.join(", ")})` : ""}`);
      break;
    }
    case "context": {
      lines.push(renderContextHuman(data as ReturnType<typeof buildContext>));
      break;
    }
    default:
      lines.push(JSON.stringify(data, null, 2));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------- usage

const USAGE = `AssetHub — local structured-data storage; records are folders.

Usage: assethub <command> [args] [--data-dir <dir>] [--json]

Commands:
  namespace add <id> [--name <n>] [--goal <g>]   register a project namespace
  namespace list                                  list namespaces with counts
  namespace show <id>                             show one namespace
  schema add <id> --file <f.json> [--namespace <ns>]
                                                 register a schema (compiles first)
  schema list [--namespace <ns>]                  merged registries, winner marked
  schema show <id> [--namespace <ns>]             resolved schema and its source
  put <ns> <dir> --data @file.json|--data-inline k=v
       [--schema <id>] [--id <ulid>] [--file <path>]... [--provenance @sources.json]
                                                 create or upsert a record
  get <id>                                        read one record anywhere
  query [text] [--namespace <ns>] [--schema <id>] [--limit <n>]
                                                 substring search over values
  delete <ns> <id> [--file <name>]                remove a record or attachment
  idfor <key>                                     deterministic ULID for a key
  validate [--namespace <ns>]                     walk and report integrity issues
  web [--port <n>]                                read-only viewer (loopback)
  demo                                            seed the reference scenario
  context                                         agent briefing

Data root: --data-dir > ASSETHUB_DATA_DIR > $XDG_DATA_HOME/assethub > ~/.local/share/assethub
`;

// -------------------------------------------------------------------- dispatch

const GLOBAL_OPTS = new Set(["data-dir", "json"]);

interface CommandResult {
  data?: unknown;
  keepAlive?: Promise<void>;
}

async function run(parsed: Parsed): Promise<CommandResult> {
  const opts = parsed.opts;
  const dataDir = optString(opts, "data-dir");
  const command = parsed.positionals[0] ?? "help";
  const args = parsed.positionals.slice(1);
  const root = resolveRoot(dataDir);
  const hub = new Hub(root);

  switch (command) {
    case "help":
    case "--help":
      return { data: USAGE };

    case "namespace": {
      const sub = requireArg(args, 0, "subcommand");
      const rest = args.slice(1);
      if (sub === "add") {
        checkAllowed(opts, new Set([...GLOBAL_OPTS, "name", "goal"]));
        const id = requireArg(rest, 0, "id");
        noExtraArgs(rest, 1, "namespace add");
        return { data: hub.addNamespace(id, { name: optString(opts, "name"), goal: optString(opts, "goal") }) };
      }
      if (sub === "list") {
        checkAllowed(opts, new Set(GLOBAL_OPTS));
        noExtraArgs(rest, 0, "namespace list");
        return { data: hub.listNamespaces() };
      }
      if (sub === "show") {
        checkAllowed(opts, new Set(GLOBAL_OPTS));
        const id = requireArg(rest, 0, "id");
        noExtraArgs(rest, 1, "namespace show");
        return { data: hub.showNamespace(id) };
      }
      throw err("invalid_argument", `unknown namespace subcommand '${sub}' (add | list | show)`);
    }

    case "schema": {
      const sub = requireArg(args, 0, "subcommand");
      const rest = args.slice(1);
      if (sub === "add") {
        checkAllowed(opts, new Set([...GLOBAL_OPTS, "file", "namespace"]));
        const id = requireArg(rest, 0, "id");
        noExtraArgs(rest, 1, "schema add");
        const file = optString(opts, "file");
        if (file === undefined) throw err("invalid_argument", "--file <f.json> is required");
        return { data: hub.addSchema(id, file, optString(opts, "namespace")) };
      }
      if (sub === "list") {
        checkAllowed(opts, new Set([...GLOBAL_OPTS, "namespace"]));
        noExtraArgs(rest, 0, "schema list");
        return { data: hub.listSchemas(optString(opts, "namespace")) };
      }
      if (sub === "show") {
        checkAllowed(opts, new Set([...GLOBAL_OPTS, "namespace"]));
        const id = requireArg(rest, 0, "id");
        noExtraArgs(rest, 1, "schema show");
        return { data: hub.showSchema(id, optString(opts, "namespace")) };
      }
      throw err("invalid_argument", `unknown schema subcommand '${sub}' (add | list | show)`);
    }

    case "put": {
      checkAllowed(opts, new Set([...GLOBAL_OPTS, "data", "data-inline", "schema", "id", "file", "provenance"]));
      const ns = requireArg(args, 0, "ns");
      const dir = requireArg(args, 1, "dir");
      noExtraArgs(args, 2, "put");
      const files = optList(opts, "file");
      return {
        data: hub.put({
          ns,
          dir,
          schemaId: optString(opts, "schema"),
          id: optString(opts, "id"),
          data: buildData(opts),
          files: files.length ? files : undefined,
          provenance: buildProvenance(optString(opts, "provenance")),
        }),
      };
    }

    case "get": {
      checkAllowed(opts, new Set(GLOBAL_OPTS));
      const id = requireArg(args, 0, "id");
      noExtraArgs(args, 1, "get");
      return { data: hub.get(id) };
    }

    case "query": {
      checkAllowed(opts, new Set([...GLOBAL_OPTS, "namespace", "schema", "limit"]));
      if (args.length > 1) throw err("invalid_argument", "query takes at most one <text> argument");
      const limitRaw = optString(opts, "limit");
      let limit: number | undefined;
      if (limitRaw !== undefined) {
        limit = Number.parseInt(limitRaw, 10);
        if (!Number.isInteger(limit) || limit < 1) throw err("invalid_argument", `--limit must be a positive integer, got '${limitRaw}'`);
      }
      return {
        data: hub.query({
          text: args[0],
          ns: optString(opts, "namespace"),
          schema: optString(opts, "schema"),
          limit,
        }),
      };
    }

    case "delete": {
      checkAllowed(opts, new Set([...GLOBAL_OPTS, "file"]));
      const ns = requireArg(args, 0, "ns");
      const id = requireArg(args, 1, "id");
      noExtraArgs(args, 2, "delete");
      const file = optString(opts, "file");
      return { data: file !== undefined ? hub.deleteAttachment(ns, id, file) : hub.deleteRecord(ns, id) };
    }

    case "idfor": {
      checkAllowed(opts, new Set(GLOBAL_OPTS));
      const key = requireArg(args, 0, "key");
      noExtraArgs(args, 1, "idfor");
      return { data: hub.idfor(key) };
    }

    case "validate": {
      checkAllowed(opts, new Set([...GLOBAL_OPTS, "namespace"]));
      noExtraArgs(args, 0, "validate");
      return { data: hub.validate(optString(opts, "namespace")) };
    }

    case "demo": {
      checkAllowed(opts, new Set(GLOBAL_OPTS));
      noExtraArgs(args, 0, "demo");
      return { data: seedDemo(root) };
    }

    case "context": {
      checkAllowed(opts, new Set(GLOBAL_OPTS));
      noExtraArgs(args, 0, "context");
      return { data: buildContext(root) };
    }

    case "web": {
      checkAllowed(opts, new Set([...GLOBAL_OPTS, "port"]));
      noExtraArgs(args, 0, "web");
      const portRaw = optString(opts, "port");
      let port = 4124;
      if (portRaw !== undefined) {
        port = Number.parseInt(portRaw, 10);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw err("invalid_argument", `--port must be 1-65535, got '${portRaw}'`);
        }
      }
      const server = await startServer(root, port);
      const address = server.address();
      const actualPort = typeof address === "object" && address !== null ? address.port : port;
      const url = `http://127.0.0.1:${actualPort}`;
      return {
        data: { url, root },
        keepAlive: new Promise<never>(() => {
          const stop = () => {
            server.close(() => process.exit(0));
            setTimeout(() => process.exit(0), 500).unref();
          };
          process.on("SIGINT", stop);
          process.on("SIGTERM", stop);
        }),
      };
    }

    default:
      throw err("invalid_argument", `unknown command '${command}' (try: assethub help)`);
  }
}

async function main(): Promise<void> {
  const json = process.argv.includes("--json");
  let parsed: Parsed;
  try {
    parsed = parseArgv(process.argv.slice(2));
  } catch (e) {
    fail(e, "cli", json);
    return;
  }
  const jsonMode = json || parsed.opts.get("json") === true;
  try {
    const result = await run(parsed);
    const command = parsed.positionals[0] ?? "help";
    const fullCommand = command === "namespace" || command === "schema" ? `${command} ${parsed.positionals[1] ?? ""}`.trim() : command;
    if (jsonMode) {
      const envelope: CliEnvelope = {
        schemaVersion: 1,
        command: fullCommand,
        generatedAt: new Date().toISOString(),
        errors: [],
      };
      if (fullCommand !== "help") envelope.data = result.data;
      process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
    } else if (fullCommand === "help") {
      process.stdout.write(result.data as string);
    } else {
      process.stdout.write(human(fullCommand, result.data) + "\n");
    }
    if (result.keepAlive) {
      await result.keepAlive;
    }
  } catch (e) {
    const command = parsed.positionals[0] ?? "cli";
    const fullCommand = command === "namespace" || command === "schema" ? `${command} ${parsed.positionals[1] ?? ""}`.trim() : command;
    fail(e, fullCommand, jsonMode);
    if ((e as AppError).code === "invalid_argument" && fullCommand !== "cli") {
      process.stderr.write("try: assethub help\n");
    }
  }
}

function fail(e: unknown, command: string, jsonMode: boolean): void {
  const appErr = e instanceof AppError ? e : null;
  const code = appErr?.code ?? "io_error";
  const message = e instanceof Error ? e.message : String(e);
  if (jsonMode) {
    const envelope: CliEnvelope = { schemaVersion: 1, command, generatedAt: new Date().toISOString(), errors: [{ code, message }] };
    process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
  } else {
    process.stderr.write(`error [${code}] ${message}\n`);
  }
  process.exitCode = 1;
}

void main();
