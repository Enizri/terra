/** Markdown → safe HTML for chat answers (escape first; limited subset). */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineFormat(escaped: string): string {
  // Inline code first so emphasis inside backticks stays literal.
  let s = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Single *emphasis* — skip already-strong stretches by matching non-greedy singles.
  s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_])_([^_]+)_(?!_)/g, "$1<em>$2</em>");
  return s;
}

/** Convert a markdown string into HTML safe for dangerouslySetInnerHTML. */
export function renderMarkdown(src: string): string {
  const text = src.replace(/\r\n/g, "\n").trimEnd();
  if (!text) return "";

  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;

  const flushParagraph = (buf: string[]) => {
    if (buf.length === 0) return;
    out.push(`<p>${inlineFormat(escapeHtml(buf.join("\n")))}</p>`);
    buf.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const para: string[] = [];
      flushParagraph(para);
      i += 1;
      const code: string[] = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // closing fence
      const lang = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : "";
      out.push(`<pre><code${lang}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    // Blank line
    if (/^\s*$/.test(line)) {
      i += 1;
      continue;
    }

    // Heading
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inlineFormat(escapeHtml(heading[2].trim()))}</h${level}>`);
      i += 1;
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i += 1;
      }
      out.push(
        `<ul>${items.map((item) => `<li>${inlineFormat(escapeHtml(item))}</li>`).join("")}</ul>`,
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      out.push(
        `<ol>${items.map((item) => `<li>${inlineFormat(escapeHtml(item))}</li>`).join("")}</ol>`,
      );
      continue;
    }

    // Paragraph — gather until blank or block start
    const buf: string[] = [];
    while (i < lines.length) {
      const L = lines[i];
      if (/^\s*$/.test(L)) break;
      if (/^```/.test(L)) break;
      if (/^#{1,3}\s+/.test(L)) break;
      if (/^[-*]\s+/.test(L)) break;
      if (/^\d+\.\s+/.test(L)) break;
      buf.push(L);
      i += 1;
    }
    flushParagraph(buf);
  }

  return out.join("");
}
