import { Hub } from "./hub.js";

export interface ContextData {
  model: string;
  namespaces: { id: string; name: string; records: number }[];
  commands: { name: string; purpose: string }[];
}

const MODEL = [
  "AssetHub stores structured data as plain folders: a record is one folder with record.json (envelope + content) plus its attachments.",
  "Every write names a namespace (a first-level folder under the data root) and cannot write outside it; reads cross namespaces freely.",
  "Data is validated against a JSON Schema before anything touches the disk; schemas resolve project → global → preset.",
  "There is no database, index, or background service: the data directory is the whole system.",
  "Use --provenance @sources.json for collected records, independently of the content schema: an array of {url, fetched_at, author?, published_at?, source_id?, notes?}. Omission preserves existing provenance; [] explicitly clears it. Local records and old data may omit it.",
  "Built-in source and demand schemas store source dossiers and data needs. Keep shared source records in one chosen namespace (for example sources); project demands reference them by id. Neither schema collects, scores or schedules anything.",
  "Use schema show before writing; custom project schemas are registered with schema add. Put the namespace in idfor's natural key to avoid cross-namespace id collisions. Inspect validate.findings; exit code 0 alone is not proof of a healthy tree.",
  "Keep source dossiers in the same project namespace as the records that cite them, unless you deliberately share a sources space. Inspect the live install with: assethub status --json.",
].join("\n");

const COMMANDS: { name: string; purpose: string }[] = [
  { name: "put <ns> <dir> --data @file.json [--schema <id>] [--id <ulid>] [--file <path>...] [--provenance @sources.json]", purpose: "create or upsert a record" },
  { name: "get <id>", purpose: "read one record, wherever it has moved" },
  { name: "query [text] [--namespace] [--schema] [--limit]", purpose: "substring search over field values and ids" },
  { name: "delete <ns> <id> [--file <name>]", purpose: "remove a record or one attachment" },
  { name: "idfor <key>", purpose: "deterministic ULID for a natural key (collector retries never duplicate)" },
  { name: "namespace add|list|show", purpose: "manage project namespaces" },
  { name: "schema add|list|show", purpose: "manage schemas in the project/global/preset registries" },
  { name: "validate [--namespace]", purpose: "walk the tree and report integrity findings" },
  { name: "web [--port]", purpose: "read-only viewer on loopback (default 4124)" },
  { name: "demo", purpose: "seed the reference douyin-hub scenario" },
  { name: "context", purpose: "this briefing" },
  { name: "status", purpose: "resolved data directory, namespaces and record counts" },
];

export function buildContext(root: string): ContextData {
  const hub = new Hub(root);
  return {
    model: MODEL,
    namespaces: hub.listNamespaces().map((n) => ({ id: n.id, name: n.name, records: n.records })),
    commands: COMMANDS,
  };
}

export function renderContextHuman(data: ContextData): string {
  const lines: string[] = [];
  lines.push("AssetHub agent briefing");
  lines.push("");
  lines.push("Storage model:");
  for (const line of data.model.split("\n")) lines.push(`  ${line}`);
  lines.push("");
  lines.push("Namespaces:");
  if (data.namespaces.length === 0) {
    lines.push("  (none — create one with: namespace add <id>)");
  } else {
    for (const n of data.namespaces) lines.push(`  ${n.id.padEnd(20)} ${String(n.records).padStart(4)} records  ${n.name}`);
  }
  lines.push("");
  lines.push("Commands:");
  for (const c of data.commands) lines.push(`  ${c.name.padEnd(72)} ${c.purpose}`);
  return lines.join("\n");
}
