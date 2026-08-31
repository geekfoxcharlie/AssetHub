import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import {
  checkShape,
  ingestAttachment,
  mimeByExt,
  readEnvelope,
  recordBody,
  recordTitle,
  serializeEnvelope,
  tryReadEnvelope,
  writeRecordAtomic,
} from "../lib/format.js";
import { AppError } from "../lib/errors.js";
import type { RecordEnvelope } from "../lib/types.js";
import { tmpRoot } from "./util.js";

type EnvOverrides = Partial<Omit<RecordEnvelope, "schemaVersion" | "created_at">> & {
  schemaVersion?: number;
  created_at?: unknown;
};

function makeEnv(overrides: EnvOverrides = {}): RecordEnvelope {
  return {
    schemaVersion: 1,
    id: "01J8AAAA9TQZ8VZEWCSRGQKP2M",
    namespace: "research",
    schema: "note",
    data: { title: "Indexing local files", tags: ["local-first"] },
    files: [],
    created_at: "2026-08-31T10:00:00.000Z",
    updated_at: "2026-08-31T10:00:00.000Z",
    ...(overrides as Partial<RecordEnvelope>),
  };
}

test("envelope roundtrips through serialize and parse", () => {
  const env = makeEnv();
  const dir = tmpRoot();
  const recordDir = path.join(dir, env.id);
  mkdirSync(recordDir);
  writeFileSync(path.join(recordDir, "record.json"), serializeEnvelope(env));
  const parsed = tryReadEnvelope(recordDir);
  assert.ok(parsed.ok && parsed.env);
  assert.deepEqual(parsed.env, env);
  assert.deepEqual(readEnvelope(recordDir), env);
});

test("tryReadEnvelope reports unparseable record.json", () => {
  const dir = tmpRoot();
  writeFileSync(path.join(dir, "record.json"), "{not json");
  const parsed = tryReadEnvelope(dir);
  assert.ok(!parsed.ok);
  assert.ok(parsed.error?.includes("not valid JSON"));
  assert.throws(() => readEnvelope(dir), (e: unknown) => e instanceof AppError && e.code === "invalid_record");
});

test("checkShape flags each envelope problem", () => {
  assert.deepEqual(checkShape(makeEnv(), "01J8AAAA9TQZ8VZEWCSRGQKP2M"), []);
  assert.ok(checkShape(makeEnv({ schemaVersion: 2 }), "01J8AAAA9TQZ8VZEWCSRGQKP2M").length > 0);
  // id does not match the folder name
  assert.ok(
    checkShape(makeEnv(), "01DIFFERENTFOLDER0000000000")
      .some((p) => p.includes("does not match folder name")),
  );
  // bad files entries
  assert.ok(
    checkShape(
      makeEnv({ files: [{ name: "a", mime: "text/plain", bytes: 1, hash: "x" }, { name: "a", mime: "text/plain", bytes: 1, hash: "x" }] }),
      "01J8AAAA9TQZ8VZEWCSRGQKP2M",
    ).some((p) => p.includes("duplicate attachment name")),
  );
  assert.ok(checkShape(makeEnv({ namespace: "" }), "01J8AAAA9TQZ8VZEWCSRGQKP2M").length > 0);
  assert.ok(checkShape(makeEnv({ created_at: 5 }), "01J8AAAA9TQZ8VZEWCSRGQKP2M").length > 0);
});

test("writeRecordAtomic creates the record folder with attachments", () => {
  const root = tmpRoot();
  const target = path.join(root, "ns", "01J8AAAA9TQZ8VZEWCSRGQKP2M");
  const env = makeEnv({ files: [{ name: "cover.png", mime: "image/png", bytes: 3, hash: "abc" }] });
  writeRecordAtomic(target, env, new Map([["cover.png", Buffer.from([1, 2, 3])]]));
  assert.ok(existsSync(path.join(target, "record.json")));
  assert.deepEqual(readFileSync(path.join(target, "cover.png")), Buffer.from([1, 2, 3]));
  assert.deepEqual(readEnvelope(target), env);
});

test("writeRecordAtomic swaps an existing record and leaves no temp dirs", () => {
  const root = tmpRoot();
  const target = path.join(root, "01J8AAAA9TQZ8VZEWCSRGQKP2M");
  writeRecordAtomic(target, makeEnv(), new Map());
  const updated = makeEnv({ data: { title: "Second" }, updated_at: "2026-08-31T11:00:00.000Z" });
  writeRecordAtomic(target, updated, new Map());
  assert.deepEqual(readEnvelope(target), updated);
  const entries = readdirSync(root).filter((n) => n.startsWith("."));
  assert.deepEqual(entries, [], "no temp or old dirs remain");
});

test("ingestAttachment hashes and types by extension", () => {
  const bytes = Buffer.from("hello world");
  const ingested = ingestAttachment({ name: "notes.md", bytes });
  assert.equal(ingested.attachment.mime, "text/markdown");
  assert.equal(ingested.attachment.bytes, bytes.length);
  assert.equal(ingested.attachment.hash.length, 64);
  // same bytes → same hash
  const again = ingestAttachment({ name: "other.png", bytes });
  assert.equal(again.attachment.hash, ingested.attachment.hash);
  assert.equal(again.attachment.mime, "image/png");
});

test("ingestAttachment rejects unsafe names", () => {
  assert.throws(() => ingestAttachment({ name: ".hidden", bytes: Buffer.alloc(0) }), (e: unknown) => e instanceof AppError && e.code === "invalid_argument");
  assert.throws(() => ingestAttachment({ name: "a/b.png", bytes: Buffer.alloc(0) }), (e: unknown) => e instanceof AppError && e.code === "invalid_argument");
});

test("ingestAttachment reads from a file path", () => {
  const dir = tmpRoot();
  const file = path.join(dir, "data.txt");
  writeFileSync(file, "12345");
  const ingested = ingestAttachment(file);
  assert.equal(ingested.attachment.name, "data.txt");
  assert.equal(ingested.attachment.mime, "text/plain");
  assert.equal(ingested.attachment.bytes, 5);
  assert.throws(() => ingestAttachment(path.join(dir, "missing.txt")), (e: unknown) => e instanceof AppError);
});

test("mimeByExt covers common types and falls back to octet-stream", () => {
  assert.equal(mimeByExt("a.png"), "image/png");
  assert.equal(mimeByExt("a.JPG"), "image/jpeg");
  assert.equal(mimeByExt("a.jpeg"), "image/jpeg");
  assert.equal(mimeByExt("a.mp4"), "video/mp4");
  assert.equal(mimeByExt("a.md"), "text/markdown");
  assert.equal(mimeByExt("a.weird"), "application/octet-stream");
  assert.equal(mimeByExt("noext"), "application/octet-stream");
});

test("recordTitle and recordBody pick sensible display fields", () => {
  assert.equal(recordTitle(makeEnv()), "Indexing local files");
  assert.equal(recordTitle(makeEnv({ data: { name: "张三" } })), "张三");
  assert.equal(recordTitle(makeEnv({ data: { content: "清晨的市场,摊主们支起摊位,雾气里全是烟火气。" } })).length <= 49, true);
  assert.equal(recordTitle(makeEnv({ data: {} })), "01J8AAAA9TQZ8VZEWCSRGQKP2M");
  assert.equal(recordBody(makeEnv({ data: { content: "body text" } })), "body text");
  assert.equal(recordBody(makeEnv()), "");
});
