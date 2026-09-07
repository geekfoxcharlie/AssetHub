import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { Hub } from "../lib/hub.js";
import { AppError } from "../lib/errors.js";
import type { ProvenanceEntry } from "../lib/types.js";
import { recordPage } from "../web/html.js";
import { runCliJson, snapshotTree, tmpRoot } from "./util.js";

const sources: ProvenanceEntry[] = [{ url: "https://example.org/original", fetched_at: "2026-09-07T01:00:00Z", author: "Original Author", notes: "Quoted evidence; analysis is in data.content." }];

test("provenance works with custom schemas, is searchable, and preserves/replaces/clears on upsert", () => {
  const hub = new Hub(tmpRoot());
  hub.addNamespace("research");
  hub.addSchema("custom", { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } }, "research");
  const record = hub.put({ ns: "research", dir: ".", schemaId: "custom", data: { text: "First" }, provenance: sources });
  const id = record.record.id;
  assert.deepEqual(hub.get(id).record.provenance, sources);
  assert.deepEqual(hub.query({ text: "Original Author" })[0]?.provenance, sources);
  assert.equal(hub.query({ text: "fetched_at" }).length, 0);
  hub.put({ ns: "research", dir: ".", id, data: { text: "Second" } });
  assert.deepEqual(hub.get(id).record.provenance, sources);
  const replacement = [{ url: "https://example.org/revised", fetched_at: "2026-09-07T02:00:00Z" }];
  hub.put({ ns: "research", dir: ".", id, data: { text: "Third" }, provenance: replacement });
  assert.deepEqual(hub.get(id).record.provenance, replacement);
  hub.put({ ns: "research", dir: ".", id, data: { text: "Local" }, provenance: [] });
  assert.deepEqual(hub.get(id).record.provenance, []);
  assert.equal(hub.showNamespace("research").records, 1);
  assert.deepEqual(hub.validate().findings, []);
});

test("invalid provenance is rejected before disk changes and manual corruption is detected", () => {
  const root = tmpRoot();
  const hub = new Hub(root);
  hub.addNamespace("research");
  const before = snapshotTree(root);
  const invalid = [null, {}, [{ url: "https://example.org" }], [{ url: "bad", fetched_at: "2026-09-07T00:00:00Z" }], [{ url: "https://example.org", fetched_at: "yesterday" }], [{ ...sources[0], source_id: "not-an-id" }], [{ ...sources[0], invented: true }]];
  for (const provenance of invalid) {
    assert.throws(() => hub.put({ ns: "research", dir: "new", schemaId: "note", data: { title: "x" }, provenance: provenance as ProvenanceEntry[] }), (e: unknown) => e instanceof AppError && e.code === "invalid_data");
    assert.deepEqual(snapshotTree(root), before);
  }
  const good = hub.put({ ns: "research", dir: ".", schemaId: "note", data: { title: "x" }, provenance: sources });
  const file = path.join(root, good.path, "record.json");
  const data = JSON.parse(readFileSync(file, "utf8"));
  data.provenance[0].fetched_at = "invalid";
  writeFileSync(file, JSON.stringify(data));
  assert.ok(hub.validate().findings.some(f => f.code === "invalid_record" && f.message.includes("provenance")));
});

test("source and demand presets validate shared records and retain old data compatibility", () => {
  const hub = new Hub(tmpRoot());
  hub.addNamespace("sources");
  hub.addNamespace("consumer");
  const source = hub.put({ ns: "sources", dir: ".", schemaId: "source", data: { name: "Reference site", url: "https://example.org", access: "Public pages; search via AgentPulse", status: "active", tags: ["reference"] } });
  const demand = hub.put({ ns: "consumer", dir: ".", schemaId: "demand", data: { title: "Research need", topic: "A bounded topic", output: "Evidence records", status: "active", cadence: "manual", source_ids: [source.record.id] } });
  assert.deepEqual(demand.record.data["source_ids"], [source.record.id]);
  assert.equal(hub.query({ text: "Reference site" }).length, 1);
  assert.throws(() => hub.put({ ns: "sources", dir: ".", schemaId: "source", data: { name: "Incomplete" } }), (e: unknown) => e instanceof AppError && e.code === "invalid_data");
  assert.throws(() => hub.put({ ns: "consumer", dir: ".", schemaId: "demand", data: { title: "Invalid", topic: "x", output: "x", status: "unknown" } }), (e: unknown) => e instanceof AppError && e.code === "invalid_data");
  const local = hub.put({ ns: "consumer", dir: ".", schemaId: "note", data: { title: "Local idea" } });
  assert.equal("provenance" in hub.get(local.record.id).record, false);
  assert.deepEqual(hub.validate().findings, []);
});

test("CLI accepts provenance files, reports malformed input, and exposes the stored sources", () => {
  const root = tmpRoot();
  runCliJson(["namespace", "add", "consumer", "--data-dir", root]);
  const file = path.join(root, "sources.json");
  writeFileSync(file, JSON.stringify(sources));
  const result = runCliJson<{ record: { id: string; provenance: ProvenanceEntry[] } }>(["put", "consumer", ".", "--schema", "note", "--data-inline", "title=CLI example", "--provenance", `@${file}`, "--data-dir", root]);
  assert.equal(result.status, 0);
  assert.deepEqual(result.envelope.data?.record.provenance, sources);
  const get = runCliJson<{ record: { provenance: ProvenanceEntry[] } }>(["get", result.envelope.data!.record.id, "--data-dir", root]);
  assert.deepEqual(get.envelope.data?.record.provenance, sources);
  const invalid = runCliJson(["put", "consumer", ".", "--schema", "note", "--data-inline", "title=invalid", "--provenance", "null", "--data-dir", root]);
  assert.equal(invalid.status, 1);
  assert.equal(invalid.envelope.errors[0]?.code, "invalid_data");
  const missing = runCliJson(["put", "consumer", ".", "--schema", "note", "--data-inline", "title=invalid", "--provenance", "@/missing/source.json", "--data-dir", root]);
  assert.equal(missing.envelope.errors[0]?.code, "invalid_argument");
});

test("the read-only viewer shows provenance and escapes source annotations", () => {
  const hub = new Hub(tmpRoot());
  hub.addNamespace("consumer");
  const record = hub.put({ ns: "consumer", dir: ".", schemaId: "note", data: { title: "Example" }, provenance: [{ ...sources[0]!, notes: "<script>alert(1)</script>" }] });
  for (const view of ["record", "card", "gallery", "article"] as const) {
    const html = recordPage({ env: record.record, ns: "consumer", segs: [record.record.id], view, rawBase: "/raw/consumer" });
    assert.ok(html.includes('href="https://example.org/original"'));
    assert.ok(html.includes("2026-09-07T01:00:00Z"));
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!html.includes("<script>alert"));
  }
});
