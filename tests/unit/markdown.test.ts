import { describe, it, expect } from "bun:test";
import { markdownToEmailHtml } from "../../src/utils/markdown.js";

/**
 * Unit Tests for Markdown → Email HTML conversion
 */

describe("markdownToEmailHtml", () => {
  it("should convert basic markdown headings to styled HTML", () => {
    const md = "### My Heading\n\nSome text";
    const html = markdownToEmailHtml(md);

    expect(html).toContain("<h3");
    expect(html).toContain("My Heading");
    expect(html).toContain("font-size");
  });

  it("should convert bold and italic text", () => {
    const md = "This is **bold** and *italic* text.";
    const html = markdownToEmailHtml(md);

    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("should convert markdown links to styled anchor tags", () => {
    const md = "Visit [Example](https://example.com) for details.";
    const html = markdownToEmailHtml(md);

    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("color:#667eea");
    expect(html).toContain("Example");
  });

  it("should convert unordered lists with inline styles", () => {
    const md = "- Item one\n- Item two\n- Item three";
    const html = markdownToEmailHtml(md);

    expect(html).toContain("<ul");
    expect(html).toContain("<li");
    expect(html).toContain("padding-left");
    expect(html).toContain("Item one");
  });

  it("should convert blockquotes with inline styles", () => {
    const md = "> This is a quote";
    const html = markdownToEmailHtml(md);

    expect(html).toContain("<blockquote");
    expect(html).toContain("border-left");
    expect(html).toContain("This is a quote");
  });

  it("should handle a full research-style markdown report", () => {
    const md = `**Résumé exécutif** : Découvertes importantes cette semaine.

### Nouvelle release TypeScript 5.8

TypeScript 5.8 apporte des améliorations de performance. Plus de détails sur [le blog officiel](https://devblogs.microsoft.com/).

### Analyse

Les tendances montrent une adoption croissante.

**Sources :**
- [Blog TypeScript](https://devblogs.microsoft.com/)
- [Hacker News](https://news.ycombinator.com/)`;

    const html = markdownToEmailHtml(md);

    // Should be valid HTML, not raw markdown
    expect(html).not.toContain("### ");
    expect(html).not.toContain("**Sources");
    expect(html).toContain("<h3");
    expect(html).toContain("<strong>");
    expect(html).toContain("<a ");
    expect(html).toContain("href=");
  });

  it("should apply inline styles to paragraphs", () => {
    const md = "First paragraph.\n\nSecond paragraph.";
    const html = markdownToEmailHtml(md);

    expect(html).toContain("<p");
    expect(html).toContain("line-height");
  });

  it("should handle empty input", () => {
    const html = markdownToEmailHtml("");
    expect(html).toBe("");
  });
});
