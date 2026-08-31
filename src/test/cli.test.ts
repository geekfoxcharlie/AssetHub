import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import { tmpdir } from "node:os";
import { seedDemo } from "../lib/demo.js";
import { runCli, runCliJson, tmpRoot } from "./util.js";
import type { CliEnvelope } from "../lib/types.js";

function dataFile(payload: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "assethub-data-"));
  const file = path.join(dir, "d.json");
  writeFileSync(file, JSON.stringify(payload));
  return file;
}

function attachFile(name: string, content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "assethub-att-"));
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
}

test("help exits 0; unknown command is invalid_argument", () => {
  const help = runCli(["help"]);
  assert.equal(help.status, 0);
  assert.ok(help.stdout.includes("put <ns> <dir>"));
  assert.equal(runCli([]).status, 0);

  const bad = runCliJson(["frobnicate"]);
  assert.equal(bad.status, 1);
  assert.equal(bad.envelope.errors[0]?.code, "invalid_argument");
});

test("every command returns the --json envelope with stable shape", () => {
  const root = tmpRoot();
  const add = runCliJson<{ id: string }>(["namespace", "add", "research", "--data-dir", root]);
  assert.equal(add.status, 0);
  assert.equal(add.envelope.schemaVersion, 1);
  assert.equal(add.envelope.command, "namespace add");
  assert.ok(Date.parse(add.envelope.generatedAt) > 0);
  assert.deepEqual(add.envelope.errors, []);
  assert.equal(add.envelope.data?.id, "research");

  const list = runCliJson<unknown[]>(["namespace", "list", "--data-dir", root]);
  assert.equal(list.envelope.command, "namespace list");
  assert.equal((list.envelope.data as unknown[]).length, 1);

  // error envelope
  const dup = runCliJson(["namespace", "add", "research", "--data-dir", root]);
  assert.equal(dup.status, 1);
  assert.equal(dup.envelope.command, "namespace add");
  assert.equal(dup.envelope.errors[0]?.code, "already_exists");
  assert.equal(dup.envelope.data, undefined);
});

test("unknown options are rejected with invalid_argument", () => {
  const root = tmpRoot();
  runCli(["namespace", "add", "a", "--data-dir", root]);
  const cases: string[][] = [
    ["put", "a", ".", "--bogus", "x", "--data-dir", root],
    ["query", "--limit", "5", "--sort", "asc", "--data-dir", root],
    ["namespace", "list", "--limit", "3", "--data-dir", root],
    ["get", "01J8AAAA9TQZ8VZEWCSRGQKP2M", "--namespace", "a", "--data-dir", root],
  ];
  for (const args of cases) {
    const r = runCliJson(args);
    assert.equal(r.status, 1, args.join(" "));
    assert.equal(r.envelope.errors[0]?.code, "invalid_argument", args.join(" "));
  }
  // missing option value
  const missing = runCliJson(["query", "--data-dir", root, "--limit"]);
  assert.equal(missing.envelope.errors[0]?.code, "invalid_argument");
  // too many positionals
  const extra = runCliJson(["idfor", "k", "junk", "--data-dir", root]);
  assert.equal(extra.envelope.errors[0]?.code, "invalid_argument");
});

test("put via CLI: @file data, inline strings stay strings, --file attaches", () => {
  const root = tmpRoot();
  runCli(["namespace", "add", "research", "--data-dir", root]);
  const data = dataFile({ title: "From file", tags: ["cli", "put"] });
  const att = attachFile("cover.md", "# cover");
  const r = runCliJson<{ created: boolean; record: { id: string }; path: string }>([
    "put", "research", "reading",
    "--data", `@${data}`,
    "--data-inline", "content=plain string",
    "--schema", "note",
    "--file", att,
    "--data-dir", root,
  ]);
  assert.equal(r.status, 0, r.envelope.errors[0]?.message);
  assert.equal(r.envelope.data?.created, true);

  const recordDir = path.join(root, r.envelope.data!.path);
  const env = JSON.parse(readFileSync(path.join(recordDir, "record.json"), "utf8"));
  assert.equal(env.data.title, "From file");
  assert.deepEqual(env.data.tags, ["cli", "put"]); // types from JSON survive
  assert.equal(env.data.content, "plain string"); // inline values stay strings
  assert.equal(env.files[0].name, "cover.md");
  assert.equal(env.files[0].mime, "text/markdown");
  assert.ok(existsSync(path.join(recordDir, "cover.md")));

  // inline JSON also accepted as --data
  const r2 = runCliJson(["put", "research", ".", "--data", '{"title":"inline"}', "--schema", "note", "--data-dir", root]);
  assert.equal(r2.status, 0);
  // invalid JSON data
  const r3 = runCliJson(["put", "research", ".", "--data", "{oops", "--schema", "note", "--data-dir", root]);
  assert.equal(r3.envelope.errors[0]?.code, "invalid_argument");
  // no data at all
  const r4 = runCliJson(["put", "research", ".", "--schema", "note", "--data-dir", root]);
  assert.equal(r4.envelope.errors[0]?.code, "invalid_argument");
});

test("put via CLI rejects escapes and unknown schemas", () => {
  const root = tmpRoot();
  runCli(["namespace", "add", "a", "--data-dir", root]);
  const data = dataFile({ title: "x" });
  const escape = runCliJson(["put", "a", "../evil", "--data", `@${data}`, "--schema", "note", "--data-dir", root]);
  assert.equal(escape.envelope.errors[0]?.code, "invalid_argument");
  const noSchema = runCliJson(["put", "a", ".", "--data", `@${data}`, "--schema", "nope", "--data-dir", root]);
  assert.equal(noSchema.envelope.errors[0]?.code, "not_found");
  const badId = runCliJson(["put", "a", ".", "--data", `@${data}`, "--schema", "note", "--id", "short", "--data-dir", root]);
  assert.equal(badId.envelope.errors[0]?.code, "invalid_argument");
});

test("idfor prints the same ULID on every run", () => {
  const a = runCli(["idfor", "https://example.com/x"]);
  const b = runCli(["idfor", "https://example.com/x"]);
  const c = runCli(["idfor", "https://example.com/y"]);
  assert.equal(a.status, 0);
  assert.match(a.stdout.trim(), /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(a.stdout, b.stdout);
  assert.notEqual(a.stdout, c.stdout);
  const j = runCliJson<string>(["idfor", "key", "--json"]);
  assert.equal(j.envelope.data, "0000000000" + j.envelope.data?.slice(10));
});

test("put --id rerun via CLI replaces in place", () => {
  const root = tmpRoot();
  runCli(["namespace", "add", "a", "--data-dir", root]);
  const id = runCli(["idfor", "rerun"]).stdout.trim();
  const data = dataFile({ title: "first" });
  const first = runCliJson<{ path: string }>(["put", "a", "posts", "--data", `@${data}`, "--schema", "note", "--id", id, "--data-dir", root]);
  const second = runCliJson<{ path: string; created: boolean }>(["put", "a", "posts", "--data", `@${data}`, "--schema", "note", "--id", id, "--data-dir", root]);
  assert.equal(second.envelope.data?.created, false);
  assert.equal(first.envelope.data?.path, second.envelope.data?.path);
  const env = JSON.parse(readFileSync(path.join(root, second.envelope.data!.path, "record.json"), "utf8"));
  assert.equal(env.id, id);
});

test("delete via CLI: whole record and single attachment", () => {
  const root = tmpRoot();
  runCli(["namespace", "add", "a", "--data-dir", root]);
  const id = runCli(["idfor", "del"]).stdout.trim();
  const data = dataFile({ title: "x" });
  const att1 = attachFile("one.txt", "1");
  const att2 = attachFile("two.txt", "2");
  const put = runCliJson<{ path: string }>(["put", "a", ".", "--data", `@${data}`, "--schema", "note", "--id", id, "--file", att1, "--file", att2, "--data-dir", root]);
  const recordDir = path.join(root, put.envelope.data!.path);

  const file = runCliJson(["delete", "a", id, "--file", "one.txt", "--data-dir", root]);
  assert.equal(file.status, 0);
  assert.ok(!existsSync(path.join(recordDir, "one.txt")));
  assert.ok(existsSync(path.join(recordDir, "two.txt")));

  const unregistered = runCliJson(["delete", "a", id, "--file", "nope", "--data-dir", root]);
  assert.equal(unregistered.envelope.errors[0]?.code, "not_found");

  const gone = runCliJson(["delete", "a", id, "--data-dir", root]);
  assert.equal(gone.status, 0);
  assert.ok(!existsSync(recordDir));
  const after = runCliJson(["get", id, "--data-dir", root]);
  assert.equal(after.envelope.errors[0]?.code, "not_found");
});

test("query zhangsan on the demo scenario hits only that blogger's records", () => {
  const root = tmpRoot();
  seedDemo(root);
  const hits = runCliJson<{ namespace: string; schema: string; title: string; path: string }[]>(["query", "zhangsan", "--data-dir", root]);
  assert.equal(hits.status, 0);
  assert.equal(hits.envelope.data?.length, 3);
  for (const hit of hits.envelope.data ?? []) {
    assert.ok(hit.path.startsWith("douyin-hub/zhangsan/"), hit.path);
  }
  // a JSON key name matches nothing
  const keys = runCliJson<unknown[]>(["query", "title", "--data-dir", root]);
  assert.equal(keys.envelope.data?.length, 0);
  const keys2 = runCliJson<unknown[]>(["query", "content", "--data-dir", root]);
  assert.equal(keys2.envelope.data?.length, 0);
  // schema filter through the CLI
  const videos = runCliJson<unknown[]>(["query", "--namespace", "douyin-hub", "--schema", "douyin_video", "--data-dir", root]);
  assert.equal(videos.envelope.data?.length, 3);
});

test("validate via CLI reports findings as JSON", () => {
  const root = tmpRoot();
  const demo = seedDemo(root);
  const video = demo.records.find((r) => r.schema === "douyin_video" && r.files.length === 2);
  assert.ok(video);
  const first = video.files[0];
  assert.ok(first);
  writeFileSync(path.join(root, video.path, first), Buffer.from("tampered"));
  const r = runCliJson<{ findings: { code: string }[] }>(["validate", "--data-dir", root]);
  assert.equal(r.status, 0);
  assert.ok(r.envelope.data?.findings.some((f) => f.code === "hash_mismatch"));
});

test("context prints the storage-model briefing", () => {
  const root = tmpRoot();
  seedDemo(root);
  const human = runCli(["context", "--data-dir", root]);
  assert.ok(human.stdout.includes("Storage model"));
  assert.ok(human.stdout.includes("douyin-hub"));
  assert.ok(human.stdout.includes("put <ns>"));
  const json = runCliJson<{ namespaces: { id: string }[] }>(["context", "--data-dir", root, "--json"]);
  assert.equal(json.envelope.data?.namespaces[0]?.id, "douyin-hub");
});

test("demo via CLI is idempotent", () => {
  const root = tmpRoot();
  const first = runCliJson<{ records: { id: string }[] }>(["demo", "--data-dir", root]);
  assert.equal(first.envelope.data?.records.length, 4);
  const second = runCliJson<{ records: { id: string }[] }>(["demo", "--data-dir", root]);
  assert.deepEqual(second.envelope.data?.records.map((r) => r.id), first.envelope.data?.records.map((r) => r.id));
  const dup = runCliJson<unknown[]>(["namespace", "list", "--data-dir", root]);
  const ns = dup.envelope.data as { id: string; records: number }[];
  assert.equal(ns[0]?.records, 4);
});

test("human output for get shows the path and record", () => {
  const root = tmpRoot();
  seedDemo(root);
  const demoIds = runCli(["idfor", "douyin:video:z1"]).stdout.trim();
  const got = runCli(["get", demoIds, "--data-dir", root]);
  assert.ok(got.stdout.includes("douyin-hub/zhangsan/posts"));
  assert.ok(got.stdout.includes("清晨的市场"));
});

test("exit codes: success 0, AppError 1", () => {
  const root = tmpRoot();
  assert.equal(runCli(["namespace", "list", "--data-dir", root]).status, 0);
  assert.equal(runCli(["namespace", "show", "ghost", "--data-dir", root]).status, 1);
});

test("envelope helper types stay in sync with the CLI output", () => {
  const root = tmpRoot();
  const env: CliEnvelope = { schemaVersion: 1, command: "context", generatedAt: new Date().toISOString(), errors: [] };
  const r = runCliJson(["context", "--data-dir", root]);
  const out = r.envelope;
  assert.deepEqual(Object.keys(out).filter((k) => k !== "data").sort(), Object.keys(env).sort());
});
