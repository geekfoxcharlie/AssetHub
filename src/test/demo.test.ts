import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import { seedDemo, makePng, DEMO_SCHEMAS } from "../lib/demo.js";
import { Hub } from "../lib/hub.js";
import { snapshotTree, tmpRoot } from "./util.js";

test("makePng generates valid, distinct PNG bytes", () => {
  const a = makePng(8, 8, [1, 2, 3]);
  const b = makePng(8, 8, [4, 5, 6]);
  assert.deepEqual(a.subarray(1, 4), Buffer.from("PNG"));
  assert.deepEqual(b.subarray(1, 4), Buffer.from("PNG"));
  assert.deepEqual(a.subarray(4, 8), b.subarray(4, 8), "same IHDR length");
  assert.notDeepEqual(a, b, "different colors compress to different bytes");
  assert.ok(a.length > 50);
});

test("demo seeds the designed tree with project schemas and idfor ids", () => {
  const root = tmpRoot();
  const result = seedDemo(root);

  assert.equal(result.namespace, "douyin-hub");
  assert.equal(result.records.length, 4);

  // .ns.json goal
  const meta = JSON.parse(readFileSync(path.join(root, "douyin-hub", ".ns.json"), "utf8"));
  assert.equal(meta.goal, "抖音博主内容采集");

  // project schemas exist and declare their views
  for (const id of ["douyin_blogger", "douyin_video"]) {
    const schema = JSON.parse(readFileSync(path.join(root, "douyin-hub", ".schemas", `${id}.schema.json`), "utf8"));
    assert.ok(schema["x-assethub"].view, id);
  }
  assert.equal((DEMO_SCHEMAS["douyin_blogger"]!["x-assethub"] as { view: string }).view, "record");
  assert.equal((DEMO_SCHEMAS["douyin_video"]!["x-assethub"] as { view: string }).view, "card");

  // tree shape
  const paths = result.records.map((r) => r.path);
  assert.ok(paths.some((p) => p === `douyin-hub/zhangsan/${result.records[0]!.id}`));
  assert.ok(paths.some((p) => p.startsWith("douyin-hub/zhangsan/posts/") && p.endsWith(result.records[1]!.id)));
  assert.ok(paths.some((p) => p.startsWith("douyin-hub/zhangsan/posts/") && p.endsWith(result.records[2]!.id)));
  assert.ok(paths.some((p) => p.startsWith("douyin-hub/lisi/posts/") && p.endsWith(result.records[3]!.id)));

  // attachments are real files with registered hashes
  const video = result.records[1]!;
  assert.deepEqual(video.files, ["cover.png", "01.png"]);
  const cover = readFileSync(path.join(root, video.path, "cover.png"));
  assert.deepEqual(cover.subarray(1, 4), Buffer.from("PNG"));

  // ids come from idfor → zero time prefix
  for (const r of result.records) assert.ok(r.id.startsWith("0000000000"));
});

test("demo is idempotent: rerun replaces, never duplicates", () => {
  const root = tmpRoot();
  const first = seedDemo(root);
  const treeAfterFirst = snapshotTree(root).filter((p) => !p.startsWith("douyin-hub/.schemas"));
  const second = seedDemo(root);
  const treeAfterSecond = snapshotTree(root).filter((p) => !p.startsWith("douyin-hub/.schemas"));

  assert.deepEqual(
    second.records.map((r) => r.id),
    first.records.map((r) => r.id),
  );
  assert.deepEqual(treeAfterSecond, treeAfterFirst);

  const hub = new Hub(root);
  assert.equal(hub.validate().records, 4);
  // no leftover temp dirs anywhere
  const dirs: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        dirs.push(e.name);
        walk(path.join(dir, e.name));
      }
    }
  };
  walk(root);
  assert.deepEqual(dirs.filter((n) => n.includes(".tmp-") || n.includes(".old-")), []);
  // counts still 4, not 8
  assert.equal(hub.listNamespaces()[0]?.records, 4);
});

test("demo schema files validate demo data", () => {
  const root = tmpRoot();
  seedDemo(root);
  const hub = new Hub(root);
  // healthy validate already proves it; assert resolution sources explicitly
  const blogger = hub.showSchema("douyin_blogger", "douyin-hub");
  assert.equal(blogger.source, "project");
  const video = hub.showSchema("douyin_video", "douyin-hub");
  assert.equal(video.source, "project");
  // and the demo tree is healthy
  assert.deepEqual(hub.validate().findings, []);
  assert.ok(existsSync(path.join(root, "douyin-hub", "zhangsan", "posts")));
});
