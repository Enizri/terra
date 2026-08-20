import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "./markdown.ts";

test("escapes raw HTML", () => {
  const html = renderMarkdown('Hello <script>alert(1)</script> **world**');
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<strong>world<\/strong>/);
});

test("renders headings lists and code", () => {
  const src = `# Title

- one
- two

\`\`\`ts
const x = 1;
\`\`\`

A \`inline\` bit.`;
  const html = renderMarkdown(src);
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<pre><code class="language-ts">const x = 1;<\/code><\/pre>/);
  assert.match(html, /<code>inline<\/code>/);
});

test("ordered list and emphasis", () => {
  const html = renderMarkdown("1. first\n2. *second*");
  assert.match(html, /<ol><li>first<\/li><li><em>second<\/em><\/li><\/ol>/);
});
