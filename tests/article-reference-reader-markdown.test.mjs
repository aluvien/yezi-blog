import test from "node:test";
import assert from "node:assert/strict";
import { archiveReaderText, referenceReaderHtmlToMarkdown } from "../src/lib/article-reference-reader-markdown.ts";

test("reader archive text removes markup, scripts, and image alt-text noise", () => {
  const text = archiveReaderText('<p>正文 <strong>内容</strong></p><img alt="无关图片说明"><script>alert(1)</script>');
  assert.equal(text, "正文 内容");
});

test("reader HTML converts common blocks to stable GFM", () => {
  const markdown = referenceReaderHtmlToMarkdown(`
    <h2>标题</h2><p>一段 <strong>重点</strong>，<a href="https://example.com/a">链接</a></p>
    <ul><li>项目一</li><li>项目二</li></ul>
    <figure><img src="https://example.com/image.png"><figcaption>图片说明</figcaption></figure>
  `);

  assert.match(markdown, /^## 标题/m);
  assert.match(markdown, /一段 \*\*重点\*\*，\[链接\]\(https:\/\/example\.com\/a\)/);
  assert.match(markdown, /- 项目一\n- 项目二/);
  assert.match(markdown, /!\[\]\(https:\/\/example\.com\/image\.png\)\n\n\*图片说明\*/);
});
