import assert from "node:assert/strict";
import { test } from "node:test";
import { hubHref, renderMarkdown } from "../web/html.js";

test("markdown: GFM tables render with header, body and alignment", () => {
  const html = renderMarkdown(
    ["| 指标 | 数值 |", "| :--- | ---: |", "| 总账号 | 55 |", "| 平台 | 抖音 \\| 小红书 |"].join("\n"),
  );
  assert.ok(html.includes('<div class="table-wrap"><table class="md-table">'));
  assert.ok(html.includes("<thead><tr><th style=\"text-align:left\">指标</th><th style=\"text-align:right\">数值</th></tr></thead>"));
  assert.ok(html.includes("<td style=\"text-align:left\">总账号</td><td style=\"text-align:right\">55</td>"));
  assert.ok(html.includes("抖音 | 小红书"));
  assert.ok(!html.includes("| --- |"));
});

test("markdown: tables can follow a paragraph and stop at a blank line", () => {
  const html = renderMarkdown(["介绍段落。", "| a | b |", "| - | - |", "| 1 | 2 |", "", "结尾。"].join("\n"));
  assert.ok(html.indexOf("<p>介绍段落。</p>") < html.indexOf('<table class="md-table">'));
  assert.ok(html.includes("<td>1</td><td>2</td>"));
  assert.ok(html.includes("<p>结尾。</p>"));
});

test("markdown: nested lists, task items and ordered starts", () => {
  const html = renderMarkdown(["- [x] 完成", "  - 子项", "- [ ] 待办", "", "3. 第三", "4. 第四"].join("\n"));
  assert.ok(html.includes('<li class="task"><input type="checkbox" disabled checked> 完成<ul><li>子项</li></ul></li>'));
  assert.ok(html.includes('<li class="task"><input type="checkbox" disabled> 待办</li>'));
  assert.ok(html.includes('<ol start="3"><li>第三</li><li>第四</li></ol>'));
});

test("markdown: headings get stable ids and are collected for an outline", () => {
  const headings: { id: string; level: number; text: string }[] = [];
  const html = renderMarkdown("# 报告\n\n## 竞争格局\n\n## 竞争格局\n\n#### 细节", { headings });
  assert.ok(html.includes('<h1 id="报告">报告</h1>'));
  assert.ok(html.includes('<h2 id="竞争格局">竞争格局</h2>'));
  assert.ok(html.includes('<h2 id="竞争格局-2">竞争格局</h2>'));
  assert.ok(html.includes('<h4 id="细节">细节</h4>'));
  assert.deepEqual(
    headings.map((h) => [h.level, h.id]),
    [
      [1, "报告"],
      [2, "竞争格局"],
      [2, "竞争格局-2"],
      [4, "细节"],
    ],
  );
});

test("markdown: quotes, rules and fenced code stay escaped", () => {
  const html = renderMarkdown(["> 引用 **重点**", "", "---", "", "```ts", "const x = '<script>';", "```"].join("\n"));
  assert.ok(html.includes("<blockquote><p>引用 <strong>重点</strong></p></blockquote>"));
  assert.ok(html.includes("<hr>"));
  assert.ok(html.includes('<pre data-lang="ts"><code>const x = &#39;&lt;script&gt;&#39;;</code></pre>'));
  assert.ok(!html.includes("<script>"));
});

test("markdown: relative images resolve under the record's attachment folder", () => {
  const html = renderMarkdown("![图](cover.png)\n\n![远程](https://example.com/a.png)", { base: "/raw/ns/dir/rec" });
  assert.ok(html.includes('<img src="/raw/ns/dir/rec/cover.png" alt="图" loading="lazy">'));
  assert.ok(html.includes('<a href="https://example.com/a.png" rel="noreferrer">远程</a>'));
});

test("hubHref resolves place references and rejects unsafe paths", () => {
  assert.deepEqual(hubHref("hub:notes/weekly", "reading"), {
    href: "/n/reading/notes/weekly",
    label: "notes/weekly",
  });
  assert.deepEqual(hubHref("hub://archive/notes/weekly", null), {
    href: "/n/archive/notes/weekly",
    label: "archive/notes/weekly",
  });
  assert.deepEqual(hubHref("hub://archive", "reading"), {
    href: "/n/archive",
    label: "archive",
  });
  assert.equal(hubHref("hub:notes/每周", "reading")?.href, `/n/reading/notes/${encodeURIComponent("每周")}`);
  assert.equal(hubHref("hub:notes/weekly", null), null);
  assert.equal(hubHref("hub:", "reading"), null);
  assert.equal(hubHref("hub:../secret", "reading"), null);
  assert.equal(hubHref("hub:.hidden", "reading"), null);
  assert.equal(hubHref("hub:notes/a b", "reading"), null);
  assert.equal(hubHref("hub:notes/a\\b", "reading"), null);
  assert.equal(hubHref("hub://schemas/x", "reading"), null);
  assert.equal(hubHref("hub://archive/", "reading"), null);
  assert.equal(hubHref("notes/weekly", "reading"), null);
});

test("markdown links resolve hub places and record ids", () => {
  const id = "01J8AAAA9TQZ8VZEWCSRGQKP2M";
  const html = renderMarkdown(`[weekly](hub:notes/weekly)\n\n[record](${id})\n\n[bad](hub:../secret)\n\n[else](hub://archive/kept)`, { ns: "reading" });
  assert.ok(html.includes('<a href="/n/reading/notes/weekly">weekly</a>'));
  assert.ok(html.includes(`<a href="/r/${id}">record</a>`));
  assert.ok(html.includes('<a href="/n/archive/kept">else</a>'));
  assert.ok(!html.includes('href="/n/reading/../secret"'));
  assert.ok(html.includes(">bad</"));
  const noNs = renderMarkdown("[weekly](hub:notes/weekly) [else](hub://archive/kept)");
  assert.ok(!noNs.includes("/n/reading/"));
  assert.ok(noNs.includes("weekly"));
  assert.ok(!noNs.includes('href="/n/notes/weekly"'));
  assert.ok(noNs.includes('href="/n/archive/kept"'));
});

test("markdown: raw HTML and javascript links never become markup", () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))');
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes("x"));
});
