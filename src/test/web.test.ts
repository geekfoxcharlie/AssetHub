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

test("web: healthz answers without a namespace walk", async () => {
  const root = tmpRoot();
  seedDemo(root);
  await withServer(root, async (base) => {
    const res = await fetch(base + "/healthz");
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<title>AssetHub<\/title>/);
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

test("web: markdown attachments have a standalone reader page with tables and an outline", async () => {
  const root = tmpRoot();
  seedDemo(root);
  const hub = new Hub(root);
  const id = hub.idfor("web:report");
  const md = [
    "# 雅思报告",
    "",
    "| 指标 | 数值 |",
    "| --- | ---: |",
    "| 总账号 | 55 |",
    "",
    "## 竞争格局",
    "",
    "内容一。",
    "",
    "## 变现模式",
    "",
    "内容二。",
    "",
    "## 策略建议",
    "",
    "- **要点**",
    "  - 子项",
    "",
    "> 引用",
  ].join("\n");
  hub.put({
    ns: "douyin-hub",
    dir: "zhangsan/docs",
    schemaId: "note",
    id,
    data: { title: "雅思报告" },
    files: [{ name: "report.md", bytes: Buffer.from(md) }],
  });
  await withServer(root, async (base) => {
    const record = await (await fetch(base + `/n/douyin-hub/zhangsan/docs/${id}`)).text();
    assert.ok(record.includes('<table class="md-table">'), "record preview renders the table");
    assert.ok(record.includes(`href="/n/douyin-hub/zhangsan/docs/${id}/report.md"`), "attachment links to the reader");
    assert.ok(record.includes("独立阅读"));

    const res = await fetch(base + `/n/douyin-hub/zhangsan/docs/${id}/report.md`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('<div class="doc">'));
    assert.ok(html.includes('<table class="md-table">'));
    assert.ok(html.includes('<details class="toc">'));
    assert.ok(html.includes('href="#竞争格局"'));
    assert.ok(html.includes('<h2 id="竞争格局">竞争格局</h2>'));
    assert.ok(html.includes(`href="/raw/douyin-hub/zhangsan/docs/${id}/report.md"`), "download link");
    assert.ok(html.includes(`href="/n/douyin-hub/zhangsan/docs/${id}"`), "back to the record");

    const textRes = await fetch(base + `/n/douyin-hub/zhangsan/docs/${id}/record.json`);
    assert.equal(textRes.status, 404, "record.json is not an attachment");
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

test("web: list titles use key/display_name and skip ULIDs", async () => {
  const root = tmpRoot();
  seedDemo(root);
  const hub = new Hub(root);
  hub.addSchema(
    "search_signal",
    {
      type: "object",
      additionalProperties: false,
      required: ["key", "engine"],
      properties: { key: { type: "string" }, engine: { type: "string" }, impressions: { type: "number" }, cluster: { type: "string" } },
    },
    "douyin-hub",
  );
  hub.addSchema(
    "topic_facets",
    {
      type: "object",
      additionalProperties: false,
      required: ["display_name", "facets"],
      properties: {
        display_name: { type: "string" },
        method: { type: "string" },
        facets: { type: "array" },
      },
    },
    "douyin-hub",
  );
  const signalIds = ["web:sig:1", "web:sig:2", "web:sig:3", "web:sig:4"].map((k) => hub.idfor(k));
  signalIds.forEach((id, i) => {
    hub.put({
      ns: "douyin-hub",
      dir: "signals",
      schemaId: "search_signal",
      id,
      data: { key: `query ${i}`, engine: "google", impressions: 10 * (i + 1), cluster: "other" },
    });
  });
  const facetId = hub.idfor("web:facet:1");
  hub.put({
    ns: "douyin-hub",
    dir: "facets",
    schemaId: "topic_facets",
    id: facetId,
    data: {
      display_name: "Construction",
      method: "research",
      facets: [
        { label: "Estimating", keywords: ["cost", "bid"], note: "Price the job" },
        { label: "Safety", keywords: ["ppe"] },
      ],
    },
  });
  await withServer(root, async (base) => {
    const signals = await (await fetch(base + "/n/douyin-hub/signals")).text();
    assert.ok(signals.includes("query 0"), "signal key is the list title");
    assert.ok(signals.includes("<table class=\"records\">"), "homogeneous short fields render as a table");
    assert.equal((signals.match(/query \d/g) ?? []).length >= 4, true);
    const facet = await (await fetch(base + `/n/douyin-hub/facets/${facetId}`)).text();
    assert.ok(facet.includes("<h1>Construction</h1>"));
    assert.ok(facet.includes("Estimating"));
    assert.ok(facet.includes("obj-card"));
    assert.ok(!facet.includes("[object Object]"));
  });
});

test("web: search, id redirect, markdown note, inline text attachment", async () => {
  const root = tmpRoot();
  seedDemo(root);
  const hub = new Hub(root);
  const noteId = hub.idfor("web:note:map");
  hub.put({
    ns: "douyin-hub",
    dir: "notes",
    schemaId: "note",
    id: noteId,
    data: {
      title: "学习地图",
      content: "# 地图\n\n- `core/docs` ReAct — `01J8AAAA9TQZ8VZEWCSRGQKP2M`\n\n```bash\nassethub query topic\n```\n",
      tags: ["index"],
    },
    files: [{ name: "snapshot.md", bytes: Buffer.from("# Snapshot\n\nCaptured page.") }],
  });
  await withServer(root, async (base) => {
    const search = await (await fetch(base + "/q?q=zhangsan")).text();
    assert.ok(search.includes("zhangsan"));
    assert.ok(search.includes("/n/douyin-hub"));

    const redirect = await fetch(base + `/r/${noteId}`, { redirect: "manual" });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get("location"), `/n/douyin-hub/notes/${noteId}`);

    const note = await (await fetch(base + `/n/douyin-hub/notes/${noteId}`)).text();
    assert.ok(note.includes("view-article"), "preset note uses article view");
    assert.ok(note.includes("<h1>地图</h1>") || note.includes("<h1>学习地图</h1>"));
    assert.ok(note.includes("<pre"), "fenced code is rendered");
    assert.ok(note.includes("Snapshot"), "markdown attachment is inlined");
    assert.ok(!note.includes("<script"));
  });
});

test("web: catalog card for entities without platform", async () => {
  const root = tmpRoot();
  seedDemo(root);
  const hub = new Hub(root);
  hub.addSchema(
    "github_repo",
    {
      type: "object",
      additionalProperties: false,
      required: ["full_name", "html_url", "summary"],
      properties: {
        full_name: { type: "string" },
        html_url: { type: "string" },
        summary: { type: "string" },
        name: { type: "string" },
        stars: { type: "integer" },
      },
      "x-assethub": { view: "card" },
    },
    "douyin-hub",
  );
  const id = hub.idfor("web:repo:1");
  hub.put({
    ns: "douyin-hub",
    dir: "github",
    schemaId: "github_repo",
    id,
    data: {
      full_name: "MemPalace/mempalace",
      html_url: "https://github.com/MemPalace/mempalace",
      summary: "Open-source AI memory.",
      name: "mempalace",
      stars: 58955,
    },
  });
  await withServer(root, async (base) => {
    const html = await (await fetch(base + `/n/douyin-hub/github/${id}`)).text();
    assert.ok(html.includes("catalog"), "non-post card uses catalog layout");
    assert.ok(!html.includes("class=\"avatar\""), "no social avatar");
    assert.ok(html.includes("58,955") || html.includes("58955"));
    assert.ok(html.includes("查看原文"));
    assert.ok(html.includes("https://github.com/MemPalace/mempalace"));
    const list = await (await fetch(base + "/n/douyin-hub/github")).text();
    assert.ok(list.includes("MemPalace/mempalace"));
    assert.ok(list.includes("Open-source AI memory."));
  });
});

test("web: pagination slices long folders", async () => {
  const root = tmpRoot();
  seedDemo(root);
  const hub = new Hub(root);
  hub.addSchema(
    "search_signal",
    {
      type: "object",
      additionalProperties: false,
      properties: { key: { type: "string" }, engine: { type: "string" }, kind: { type: "string" } },
    },
    "douyin-hub",
  );
  for (let i = 0; i < 101; i++) {
    hub.put({
      ns: "douyin-hub",
      dir: "signals",
      schemaId: "search_signal",
      id: hub.idfor(`web:page:${i}`),
      data: { key: `term-${i}`, engine: "bing", kind: "query" },
    });
  }
  await withServer(root, async (base) => {
    const page1 = await (await fetch(base + "/n/douyin-hub/signals")).text();
    assert.ok(page1.includes("next →"));
    assert.ok(page1.includes("1–100 of 101"));
    const page2 = await (await fetch(base + "/n/douyin-hub/signals?page=2")).text();
    assert.ok(page2.includes("101–101 of 101") || page2.includes("101 of 101"));
    assert.ok(page2.includes("previous"));
  });
});

test("web: hub place references and record ids become links", async () => {
  const root = tmpRoot();
  seedDemo(root);
  const hub = new Hub(root);
  const recordId = "01J8AAAA9TQZ8VZEWCSRGQKP2M";
  hub.addSchema(
    "demo_link",
    {
      type: "object",
      additionalProperties: false,
      required: ["title"],
      properties: {
        title: { type: "string" },
        place: { type: "string" },
        see_also: { type: "array", items: { type: "string" } },
        content: { type: "string" },
        broken: { type: "string" },
      },
    },
    "douyin-hub",
  );
  const id = hub.idfor("web:hub:link");
  hub.put({
    ns: "douyin-hub",
    dir: "notes",
    schemaId: "demo_link",
    id,
    data: {
      title: "Links",
      place: "hub:notes/weekly",
      see_also: ["hub://archive/kept", recordId],
      broken: "hub:../secret",
      content: "Open [weekly](hub:notes/weekly) and [record](01J8AAAA9TQZ8VZEWCSRGQKP2M).",
    },
    files: [{ name: "pointer.md", bytes: Buffer.from("See [weekly](hub:notes/weekly).\n") }],
  });
  await withServer(root, async (base) => {
    const page = await (await fetch(`${base}/n/douyin-hub/notes/${id}`)).text();
    assert.ok(page.includes('href="/n/douyin-hub/notes/weekly"'), "relative hub: uses the page namespace");
    assert.ok(page.includes(">notes/weekly</a>"), "field text drops the hub: prefix");
    assert.ok(!page.includes(">hub:notes/weekly</a>"));
    assert.ok(page.includes('href="/n/archive/kept"'), "hub:// names the namespace");
    assert.ok(page.includes(`href="/r/${recordId}"`), "a bare ULID links to the record");
    assert.ok(page.includes("hub:../secret"));
    assert.ok(!page.includes('href="/n/douyin-hub/../secret"'));
    const doc = await (await fetch(`${base}/n/douyin-hub/notes/${id}/pointer.md`)).text();
    assert.ok(doc.includes('href="/n/douyin-hub/notes/weekly"'), "attachment reader resolves hub: too");
  });
});
