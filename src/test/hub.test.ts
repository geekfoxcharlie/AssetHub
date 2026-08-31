import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import { Hub } from "../lib/hub.js";
import { AppError } from "../lib/errors.js";
import { seedDemo } from "../lib/demo.js";
import { snapshotTree, sleep, tmpRoot } from "./util.js";

const NOTE = { title: "n", content: "c" };

function assertCode(fn: () => unknown, code: string, message?: string): void {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof AppError, `expected AppError, got ${String(e)}`);
    assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`);
    if (message) assert.ok(e.message.includes(message), e.message);
    return true;
  });
}

test("namespace add/list/show; folder exists = registered", () => {
  const root = tmpRoot();
  const hub = new Hub(root);
  hub.addNamespace("research", { name: "Research", goal: "papers" });
  const info = hub.showNamespace("research");
  assert.equal(info.name, "Research");
  assert.equal(info.goal, "papers");
  assert.equal(info.records, 0);
  const list = hub.listNamespaces();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, "research");

  // duplicate
  assertCode(() => hub.addNamespace("research"), "already_exists");
  // reserved and malformed ids
  assertCode(() => hub.addNamespace("schemas"), "invalid_argument");
  assertCode(() => hub.addNamespace("Bad_ID"), "invalid_argument");
  assertCode(() => hub.showNamespace("missing"), "not_found");

  // a folder that exists as a folder is registered even without .ns.json
  mkdirSync(path.join(root, "manual"));
  const manual = hub.showNamespace("manual");
  assert.equal(manual.name, "manual");
});

test("schema registries: add, list marks winner, shadowing project > global > preset", () => {
  const root = tmpRoot();
  const hub = new Hub(root);
  hub.addNamespace("a");
  mkdirSync(path.join(root, "b"));

  // global note shadows preset note
  const globalNote = { type: "object", required: ["title"], properties: { title: { type: "string" } }, title: "Global note" };
  hub.addSchema("note", globalNote);
  assert.equal(hub.showSchema("note").source, "global");

  // project note shadows global note — and requires an extra field
  hub.addSchema(
    "note",
    { type: "object", required: ["title", "project"], properties: { title: { type: "string" }, project: { type: "string" } } },
    "a",
  );
  assert.equal(hub.showSchema("note", "a").source, "project");
  assert.equal(hub.showSchema("note", "b").source, "global");

  const list = hub.listSchemas("a");
  const note = list.find((s) => s.id === "note");
  assert.equal(note?.source, "project");
  assert.equal(list.find((s) => s.id === "article")?.source, "preset");
  // without a namespace, only global + preset are visible
  assert.equal(hub.listSchemas().find((s) => s.id === "note")?.source, "global");

  // duplicate in the same registry
  assertCode(() => hub.addSchema("note", globalNote), "already_exists");
  assertCode(() => hub.addSchema("note", globalNote, "a"), "already_exists");
  // unresolvable schema
  assertCode(() => hub.showSchema("nope"), "not_found");
  // schema that does not compile
  assertCode(() => hub.addSchema("broken", { type: "strin" }), "invalid_schema");
});

test("put creates the record tree; data validated before anything touches disk", () => {
  const root = tmpRoot();
  const hub = new Hub(root);
  hub.addNamespace("research");

  const before = snapshotTree(root);
  assertCode(() => hub.put({ ns: "research", dir: "reading", schemaId: "note", data: { title: 5 } }), "invalid_data");
  assert.deepEqual(snapshotTree(root), before, "failed validation wrote nothing");

  const result = hub.put({ ns: "research", dir: "reading", schemaId: "note", data: NOTE });
  assert.equal(result.created, true);
  assert.ok(result.path.startsWith(`research/reading/${result.record.id}`));
  assert.ok(existsSync(path.join(root, result.path, "record.json")));
  assert.match(result.record.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);

  // unknown namespace / unknown schema
  assertCode(() => hub.put({ ns: "missing", dir: ".", schemaId: "note", data: NOTE }), "not_found");
  assertCode(() => hub.put({ ns: "research", dir: ".", schemaId: "nope", data: NOTE }), "not_found");
  // create without schema
  assertCode(() => hub.put({ ns: "research", dir: ".", data: NOTE }), "invalid_argument");
});

test("put rejects paths escaping the namespace", () => {
  const root = tmpRoot();
  const hub = new Hub(root);
  hub.addNamespace("a");
  mkdirSync(path.join(root, "b"));
  assertCode(() => hub.put({ ns: "a", dir: "../b/x", schemaId: "note", data: NOTE }), "invalid_argument");
  assertCode(() => hub.put({ ns: "a", dir: "../../etc", schemaId: "note", data: NOTE }), "invalid_argument");
  assertCode(() => hub.put({ ns: "a", dir: "/tmp/abs", schemaId: "note", data: NOTE }), "invalid_argument");
  assertCode(() => hub.put({ ns: "a", dir: ".schemas/x", schemaId: "note", data: NOTE }), "invalid_argument");
  assert.ok(!existsSync(path.join(root, "b", "x")));
});

test("put --id upserts in place; collector retries never duplicate", async () => {
  const root = tmpRoot();
  const hub = new Hub(root);
  hub.addNamespace("a");
  const id = hub.idfor("https://example.com/posts/1");

  const first = hub.put({ ns: "a", dir: "posts", schemaId: "note", id, data: { title: "One" } });
  assert.ok(first.created);
  const createdAt = first.record.created_at;

  await sleep(15);
  const second = hub.put({ ns: "a", dir: "posts", schemaId: "note", id, data: { title: "Two" } });
  assert.equal(second.created, false);
  assert.equal(second.record.created_at, createdAt, "created_at is kept on update");
  assert.notEqual(second.record.updated_at, createdAt, "updated_at is refreshed");
  assert.equal(second.path, first.path, "record stays in place");

  const folders = readdirSync(path.join(root, "a", "posts"));
  assert.deepEqual(folders, [id]);

  // a record under a moved folder keeps its identity: get finds it after rename
  mkdirSync(path.join(root, "a", "moved"));
  renameSync(path.join(root, "a", "posts", id), path.join(root, "a", "moved", id));
  const got = hub.get(id);
  assert.equal(got.record.data["title"], "Two");
  assert.equal(got.path, `a/moved/${id}`);

  // update lands where it now sits
  const third = hub.put({ ns: "a", dir: "posts", schemaId: "note", id, data: { title: "Three" } });
  assert.equal(third.path, `a/moved/${id}`);
  assert.deepEqual(readdirSync(path.join(root, "a", "posts")), [], "old location is empty");
});

test("put --id belonging to another namespace is not_found", () => {
  const root = tmpRoot();
  const hub = new Hub(root);
  hub.addNamespace("a");
  hub.addNamespace("b");
  const id = hub.idfor("cross-ns");
  hub.put({ ns: "a", dir: ".", schemaId: "note", id, data: NOTE });
  assertCode(() => hub.put({ ns: "b", dir: ".", schemaId: "note", id, data: NOTE }), "not_found");
});

test("put keeps attachments without --file; --file replaces the list", () => {
  const root = tmpRoot();
  const hub = new Hub(root);
  hub.addNamespace("a");
  const id = hub.idfor("files-case");
  const first = hub.put({
    ns: "a",
    dir: ".",
    schemaId: "note",
    id,
    data: NOTE,
    files: [
      { name: "one.png", bytes: Buffer.from("one") },
      { name: "two.png", bytes: Buffer.from("two") },
    ],
  });
  assert.deepEqual(first.record.files.map((f) => f.name), ["one.png", "two.png"]);

  // update without files: previous attachments kept on disk and in the envelope
  const second = hub.put({ ns: "a", dir: ".", schemaId: "note", id, data: { title: "kept" } });
  assert.deepEqual(second.record.files.map((f) => f.name), ["one.png", "two.png"]);
  assert.ok(existsSync(path.join(root, second.path, "one.png")));

  // update with files: list replaced
  const third = hub.put({
    ns: "a",
    dir: ".",
    schemaId: "note",
    id,
    data: { title: "replaced" },
    files: [{ name: "three.md", bytes: Buffer.from("# three") }],
  });
  assert.deepEqual(third.record.files.map((f) => f.name), ["three.md"]);
  assert.ok(!existsSync(path.join(root, third.path, "one.png")));
  assert.ok(existsSync(path.join(root, third.path, "three.md")));

  // duplicate attachment names rejected
  assertCode(
    () => hub.put({ ns: "a", dir: ".", schemaId: "note", data: NOTE, files: [path.join(root, "x.png"), path.join(root, "x.png")] }),
    "invalid_argument",
  );
});

test("put rejects a schema change on update", () => {
  const root = tmpRoot();
  const hub = new Hub(root);
  hub.addNamespace("a");
  const id = hub.idfor("immutable-schema");
  hub.put({ ns: "a", dir: ".", schemaId: "note", id, data: NOTE });
  assertCode(() => hub.put({ ns: "a", dir: ".", schemaId: "article", id, data: { title: "x" } }), "invalid_argument");
});

test("get finds records anywhere; malformed ids rejected", () => {
  const root = tmpRoot();
  const hub = new Hub(root);
  hub.addNamespace("a");
  const r = hub.put({ ns: "a", dir: "deep/deeper", schemaId: "note", data: NOTE });
  assert.deepEqual(hub.get(r.record.id).record.id, r.record.id);
  assertCode(() => hub.get("not-a-ulid"), "invalid_argument");
  assertCode(() => hub.get("01J8AAAA9TQZ8VZEWCSRGQKP2X"), "not_found");
});

test("query: value-only matching, filters, ordering, limit", async () => {
  const root = tmpRoot();
  const hub = new Hub(root);
  hub.addNamespace("a");
  hub.addNamespace("b");

  const zs1 = hub.put({ ns: "a", dir: "p", schemaId: "note", data: { title: "zhangsan first", content: "hello" } });
  await sleep(10);
  const zs2 = hub.put({ ns: "a", dir: "p", schemaId: "article", data: { title: "zhangsan second" } });
  await sleep(10);
  const ls1 = hub.put({ ns: "b", dir: ".", schemaId: "note", data: { title: "lisi only", content: "reposted from zhangsan with love" } });

  // text matches values and ids, never keys
  const hits = hub.query({ text: "zhangsan" });
  assert.deepEqual(hits.map((h) => h.id), [ls1.record.id, zs2.record.id, zs1.record.id]);
  assert.equal(hub.query({ text: "title" }).length, 0, "a JSON key name matches nothing");
  assert.equal(hub.query({ text: "content" }).length, 0);
  assert.ok(hub.query({ text: zs1.record.id }).length === 1, "id itself matches");
  assert.equal(hub.query({ text: "hello" })[0]?.id, zs1.record.id, "values in other fields match");

  // namespace + schema filters
  assert.deepEqual(hub.query({ ns: "b" }).map((h) => h.id), [ls1.record.id]);
  assert.deepEqual(hub.query({ schema: "article" }).map((h) => h.id), [zs2.record.id]);
  assert.deepEqual(hub.query({ ns: "a", schema: "article" }).map((h) => h.id), [zs2.record.id]);

  // limit
  assert.equal(hub.query({ limit: 2 }).length, 2);
  assert.equal(hub.query({ text: "zhangsan", limit: 1 })[0]?.id, ls1.record.id);
});

test("delete: whole record, one file, ownership enforcement", () => {
  const root = tmpRoot();
  const hub = new Hub(root);
  hub.addNamespace("a");
  hub.addNamespace("b");
  const id = hub.idfor("delete-case");
  hub.put({ ns: "a", dir: ".", schemaId: "note", id, data: NOTE, files: [{ name: "x.png", bytes: Buffer.from("x") }, { name: "y.md", bytes: Buffer.from("y") }] });

  // delete without the owning namespace fails
  assertCode(() => hub.deleteRecord("b", id), "not_found");
  // remove one attachment
  const afterFile = hub.deleteAttachment("a", id, "x.png");
  assert.equal(afterFile.removed, "x.png");
  const env = hub.get(id).record;
  assert.deepEqual(env.files.map((f) => f.name), ["y.md"]);
  assert.ok(!existsSync(path.join(root, afterFile.path, "x.png")));
  assert.ok(existsSync(path.join(root, afterFile.path, "y.md")));
  // unregistered name
  assertCode(() => hub.deleteAttachment("a", id, "nope.txt"), "not_found");
  // whole record
  const rec = hub.deleteRecord("a", id);
  assert.ok(!existsSync(path.join(root, rec.path)));
  assertCode(() => hub.get(id), "not_found");
});

test("validate flags every Requirement 6 condition", () => {
  const root = tmpRoot();
  const demo = seedDemo(root);
  const hub = new Hub(root);

  // healthy tree
  const healthy = hub.validate();
  assert.equal(healthy.records, 4);
  assert.deepEqual(healthy.findings, []);

  const bloggerId = demo.records.find((r) => r.schema === "douyin_blogger")?.id;
  const videoId = demo.records.find((r) => r.schema === "douyin_video" && r.files.includes("cover.png") && r.path.includes("zhangsan"))?.id;
  const z2 = demo.records.find((r) => r.schema === "douyin_video" && r.files.length === 0);
  const l1 = demo.records.find((r) => r.path.includes("lisi"));
  assert.ok(bloggerId && videoId && z2 && l1);
  const videoDir = path.join(root, hub.get(videoId).path);
  const bloggerDir = path.join(root, hub.get(bloggerId).path);

  // extra records to corrupt: one for bad data, one for an unresolvable schema
  hub.addNamespace("check");
  const badData = hub.put({ ns: "check", dir: ".", schemaId: "note", data: NOTE });
  const badSchema = hub.put({ ns: "check", dir: ".", schemaId: "note", data: NOTE });
  const edit = (dir: string, mutate: (env: Record<string, unknown>) => void) => {
    const file = path.join(dir, "record.json");
    const env = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    mutate(env);
    writeFileSync(file, JSON.stringify(env, null, 2));
  };

  // 1. unparseable record.json
  writeFileSync(path.join(root, z2.path, "record.json"), "{broken");
  // 2. missing attachment
  rmSync(path.join(videoDir, "01.png"));
  // 3. hash mismatch
  writeFileSync(path.join(videoDir, "cover.png"), Buffer.from("tampered"));
  // 4. unregistered extra file
  writeFileSync(path.join(videoDir, "extra.txt"), "stray");
  // 5. envelope id ≠ folder name
  edit(bloggerDir, (env) => {
    env["id"] = "01J8AAAA9TQZ8VZEWCSRGQKP2Z";
  });
  // 6. record copied into another namespace
  mkdirSync(path.join(root, "stolen"));
  cpSync(videoDir, path.join(root, "stolen", videoId), { recursive: true });
  // 7. data failing schema validation
  edit(path.join(root, badData.path), (env) => {
    (env as { data: Record<string, unknown> }).data = { title: 5 };
  });
  // 8. unresolvable schema
  edit(path.join(root, badSchema.path), (env) => {
    env["schema"] = "gone";
  });

  const result = hub.validate();
  const codes = new Set(result.findings.map((f) => f.code));
  assert.ok(codes.has("invalid_record"), JSON.stringify(result.findings));
  assert.ok(codes.has("missing_file"));
  assert.ok(codes.has("hash_mismatch"));
  assert.ok(codes.has("unregistered_file"));
  assert.ok(codes.has("namespace_mismatch"));
  assert.ok(codes.has("invalid_data"));
  assert.ok(codes.has("not_found"), "unresolvable schema is reported");

  // namespace-scoped validate only walks that namespace
  mkdirSync(path.join(root, "other"));
  const scoped = hub.validate("other");
  assert.equal(scoped.records, 0);
  assert.deepEqual(scoped.findings, []);
});

test("schema files are never treated as records; dotfiles skipped", () => {
  const root = tmpRoot();
  seedDemo(root);
  const hub = new Hub(root);
  assert.equal(hub.validate().records, 4);
  assert.ok(existsSync(path.join(root, "douyin-hub", ".schemas", "douyin_video.schema.json")));
  // global registry folder is not a namespace
  assert.deepEqual(hub.listNamespaces().map((n) => n.id), ["douyin-hub"]);
});

test("no database file exists anywhere under the data root", () => {
  const root = tmpRoot();
  seedDemo(root);
  const offenders = snapshotTree(root).filter((f) => /\.(db|sqlite|sqlite3|idx|catalog)$/.test(f));
  assert.deepEqual(offenders, []);
});
