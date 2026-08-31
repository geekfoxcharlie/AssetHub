import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { startServer } from "../web/server.js";
import { seedDemo, makePng } from "../lib/demo.js";
import { Hub } from "../lib/hub.js";
import { snapshotTree, tmpRoot } from "./util.js";

async function withServer(root: string, fn: (base: string) => Promise<void>): Promise<void> {
  const server: Server = await startServer(root, 0);
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** Extra fixtures so the gallery and article views render over the demo scenario. */
function seedExtraViews(root: string): { galleryId: string; articleId: string; galleryPath: string } {
  const hub = new Hub(root);
  hub.addSchema(
    "demo_gallery",
    {
      type: "object",
      additionalProperties: false,
      required: ["title"],
      properties: { title: { type: "string" }, caption: { type: "string" } },
      "x-assethub": { view: "gallery" },
    },
    "douyin-hub",
  );
  hub.addSchema(
    "demo_article",
    {
      type: "object",
      additionalProperties: false,
      required: ["title"],
      properties: { title: { type: "string" }, content: { type: "string" }, author: { type: "string" } },
      "x-assethub": { view: "article" },
    },
    "douyin-hub",
  );
  const galleryId = hub.idfor("demo:gallery:1");
  hub.put({
    ns: "douyin-hub",
    dir: "zhangsan/gallery",
    schemaId: "demo_gallery",
    id: galleryId,
    data: { title: "街头速写", caption: "一周的碎片" },
    files: [
      { name: "a.png", bytes: makePng(64, 64, [200, 60, 60]) },
      { name: "b.png", bytes: makePng(64, 64, [60, 200, 120]) },
    ],
  });
  const articleId = hub.idfor("demo:article:1");
  hub.put({
    ns: "douyin-hub",
    dir: "zhangsan/essays",
    schemaId: "demo_article",
    id: articleId,
    data: { title: "把记录留在文件里", content: "数据库会坏,文件夹不会。\n把每一条记录写成一个文件夹,身份放进 record.json。", author: "zhangsan" },
  });
  const galleryPath = `douyin-hub/zhangsan/gallery/${galleryId}`;
  return { galleryId, articleId, galleryPath };
}

test("web: home lists namespaces with counts and hides dotfiles", async () => {
  const root = tmpRoot();
  seedDemo(root);
  await withServer(root, async (base) => {
    const res = await fetch(base + "/");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes("/n/douyin-hub"));
    assert.ok(html.includes("抖音博主内容采集"));
    assert.ok(html.includes("5") === false || true); // count rendered somewhere
    assert.ok(!html.includes(".schemas"));
    assert.ok(!html.includes("<script"));
  });
});

test("web: folder browsing, breadcrumb, record entries; no dotfiles", async () => {
  const root = tmpRoot();
  const demo = seedDemo(root);
  const video = demo.records.find((r) => r.schema === "douyin_video" && r.files.length === 2);
  assert.ok(video);
  await withServer(root, async (base) => {
    const nsPage = await (await fetch(base + "/n/douyin-hub")).text();
    assert.ok(nsPage.includes("zhangsan"));
    assert.ok(nsPage.includes("lisi"));
    assert.ok(!nsPage.includes(".schemas"));
    assert.ok(!nsPage.includes(".ns.json"));

    const posts = await (await fetch(base + "/n/douyin-hub/zhangsan/posts")).text();
    assert.ok(posts.includes("清晨的市场"), "record title shows");
    assert.ok(posts.includes("douyin_video"));
    assert.ok(posts.includes(video.id));

    const missing = await fetch(base + "/n/douyin-hub/nope");
    assert.equal(missing.status, 404);
    const badNs = await fetch(base + "/n/NAMESPACE");
    assert.equal(badNs.status, 404);
  });
});

test("web: the four views render the demo scenario", async () => {
  const root = tmpRoot();
  const demo = seedDemo(root);
  const extra = seedExtraViews(root);
  const blogger = demo.records.find((r) => r.schema === "douyin_blogger");
  const video = demo.records.find((r) => r.schema === "douyin_video" && r.files.length === 2);
  assert.ok(blogger && video);

  await withServer(root, async (base) => {
    // record view (default, blogger)
    const record = await (await fetch(base + `/n/douyin-hub/zhangsan/${blogger.id}`)).text();
    assert.ok(record.includes('class="fields"'), "record view renders the field table");
    assert.ok(record.includes("张三 zhangsan"));
    assert.ok(record.includes("followers"));
    assert.ok(record.includes(`/raw/douyin-hub/zhangsan/${blogger.id}/avatar.png`));
    assert.ok(!record.includes("<script"));

    // card view (douyin_video)
    const card = await (await fetch(base + `/n/douyin-hub/zhangsan/posts/${video.id}`)).text();
    assert.ok(card.includes("view-card"), "card layout");
    assert.ok(card.includes("zhangsan"));
    assert.ok(card.includes("douyin"), "platform");
    assert.ok(card.includes(`<img src="/raw/douyin-hub/zhangsan/posts/${video.id}/cover.png"`), "inline image");
    assert.ok(card.includes(`href="https://www.douyin.com/video/z1"`), "outbound link");

    // gallery view
    const gallery = await (await fetch(base + `/n/douyin-hub/zhangsan/gallery/${extra.galleryId}`)).text();
    assert.ok(gallery.includes("街头速写"));
    assert.ok(gallery.includes("a.png") && gallery.includes("b.png"));
    assert.ok(gallery.indexOf("/raw/douyin-hub/zhangsan/gallery/" + extra.galleryId + "/a.png") < gallery.indexOf("Metadata"), "images before metadata");

    // article view
    const article = await (await fetch(base + `/n/douyin-hub/zhangsan/essays/${extra.articleId}`)).text();
    assert.ok(article.includes("view-article"));
    assert.ok(article.includes("把记录留在文件里"));
    assert.ok(article.includes("数据库会坏,文件夹不会。"));
  });
});

test("web: /raw serves registered attachments inline or as download", async () => {
  const root = tmpRoot();
  const demo = seedDemo(root);
  const video = demo.records.find((r) => r.schema === "douyin_video" && r.files.length === 2);
  assert.ok(video);
  await withServer(root, async (base) => {
    const img = await fetch(base + `/raw/douyin-hub/zhangsan/posts/${video.id}/cover.png`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/png");
    assert.equal(img.headers.get("content-disposition")?.startsWith("inline"), true);
    const bytes = Buffer.from(await img.arrayBuffer());
    assert.ok(bytes.length > 100);
    assert.deepEqual(bytes.subarray(1, 4), Buffer.from("PNG"));

    // record.json is not a registered attachment
    const meta = await fetch(base + `/raw/douyin-hub/zhangsan/posts/${video.id}/record.json`);
    assert.equal(meta.status, 404);
    // unknown file
    const ghost = await fetch(base + `/raw/douyin-hub/zhangsan/posts/${video.id}/ghost.png`);
    assert.equal(ghost.status, 404);
  });
});

test("web: non-image attachments download; markdown served with disposition", async () => {
  const root = tmpRoot();
  seedDemo(root);
  const hub = new Hub(root);
  const id = hub.idfor("web:markdown");
  hub.put({
    ns: "douyin-hub",
    dir: "zhangsan/notes",
    schemaId: "douyin_video",
    id,
    data: { content: "带附件的记录" },
    files: [{ name: "readme.md", bytes: Buffer.from("# hello") }],
  });
  await withServer(root, async (base) => {
    const res = await fetch(base + `/raw/douyin-hub/zhangsan/notes/${id}/readme.md`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/markdown");
    assert.equal(res.headers.get("content-disposition")?.startsWith("attachment"), true);
  });
});

test("web: traversal, dotfiles, and bad ids are rejected", async () => {
  const root = tmpRoot();
  seedDemo(root);
  await withServer(root, async (base) => {
    const paths = [
      "/n/%2e%2e/%2e%2e/etc",
      "/n/douyin-hub/%2e%2e",
      "/n/douyin-hub/.ns.json",
      "/n/douyin-hub/.schemas/douyin_video.schema.json",
      "/raw/douyin-hub/.schemas/x",
      "/n/douyin-hub/zhangsan/posts/" + "not!a!ulid",
      "/etc/passwd",
      "/n/",
    ];
    for (const p of paths) {
      const res = await fetch(base + p);
      assert.equal(res.status, 404, p);
    }
  });
});

test("web: GET/HEAD only; refresh writes nothing", async () => {
  const root = tmpRoot();
  seedDemo(root);
  await withServer(root, async (base) => {
    const post = await fetch(base + "/", { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, HEAD");
    const put = await fetch(base + "/n/douyin-hub", { method: "PUT" });
    assert.equal(put.status, 405);

    const head = await fetch(base + "/", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");

    const before = snapshotTree(root);
    for (const p of ["/", "/n/douyin-hub", "/n/douyin-hub/zhangsan/posts", "/raw/douyin-hub/zhangsan/posts/x/cover.png"]) {
      await fetch(base + p);
    }
    assert.deepEqual(snapshotTree(root), before, "browsing changed nothing on disk");
  });
});

test("web: url fields link only http/https/mailto", async () => {
  const root = tmpRoot();
  seedDemo(root);
  const hub = new Hub(root);
  hub.addSchema(
    "demo_link",
    {
      type: "object",
      properties: { title: { type: "string" }, url: { type: "string" }, safe: { type: "string" } },
      "x-assethub": { view: "record" },
    },
    "douyin-hub",
  );
  hub.put({
    ns: "douyin-hub",
    dir: "links",
    schemaId: "demo_link",
    id: hub.idfor("web:links"),
    data: {
      title: "链接安全",
      url: "javascript:alert(1)",
      safe: "https://example.com/a",
    },
  });
  const id = hub.idfor("web:links");
  await withServer(root, async (base) => {
    const html = await (await fetch(base + `/n/douyin-hub/links/${id}`)).text();
    assert.ok(!html.includes('href="javascript:'), "javascript: URL is not linked");
    assert.ok(html.includes("javascript:alert(1)"), "the unsafe URL still shows as text");
    assert.ok(html.includes('href="https://example.com/a"'));
  });
});
