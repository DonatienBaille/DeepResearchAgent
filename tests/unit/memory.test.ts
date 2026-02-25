import { describe, it, expect, beforeEach } from "bun:test";
import {
  extractKeyFindings,
  extractSourceUrls,
  generateContentHash,
  detectNovelContent,
  processReportMemory,
} from "../../src/memory.js";
import { resetDb, getDb, saveReport, getContentMemory, getNotifications } from "../../src/db.js";

// Use in-memory database for tests
beforeEach(async () => {
  process.env.DATABASE_PATH = ":memory:";
  resetDb();
  await getDb();
});

describe("extractKeyFindings", () => {
  it("should extract meaningful sentences from HTML", () => {
    const html = `<div class="report-item">
      <p>TypeScript 5.4 introduces new features including improved type inference and better error messages for developers working with complex types.</p>
      <p>Sources: <a href="https://example.com">Example</a></p>
    </div>`;

    const findings = extractKeyFindings(html);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]).not.toContain("<");
  });

  it("should filter out very short sentences", () => {
    const html = "<p>Short. Also short. But this is a much longer sentence that contains meaningful information about the topic at hand.</p>";
    const findings = extractKeyFindings(html);
    // Short sentences should be filtered out
    findings.forEach((f) => {
      expect(f.length).toBeGreaterThan(30);
    });
  });

  it("should handle empty HTML", () => {
    const findings = extractKeyFindings("");
    expect(findings).toEqual([]);
  });

  it("should decode HTML entities", () => {
    const html = "<p>This is a test sentence with &amp; ampersand and &lt;angle&gt; brackets that should be decoded properly for the hash.</p>";
    const findings = extractKeyFindings(html);
    if (findings.length > 0) {
      expect(findings[0]).toContain("&");
    }
  });
});

describe("extractSourceUrls", () => {
  it("should extract URLs from anchor tags", () => {
    const html = '<p>See <a href="https://example.com/article">Article</a> and <a href="https://other.com/post">Post</a></p>';
    const urls = extractSourceUrls(html);
    expect(urls).toContain("https://example.com/article");
    expect(urls).toContain("https://other.com/post");
  });

  it("should deduplicate URLs", () => {
    const html = '<a href="https://example.com">Link 1</a><a href="https://example.com">Link 2</a>';
    const urls = extractSourceUrls(html);
    expect(urls.length).toBe(1);
  });

  it("should handle HTML without URLs", () => {
    const html = "<p>No links here</p>";
    const urls = extractSourceUrls(html);
    expect(urls).toEqual([]);
  });
});

describe("generateContentHash", () => {
  it("should generate consistent hashes for same content", () => {
    const findings = ["Finding one about AI", "Finding two about security"];
    const hash1 = generateContentHash(findings);
    const hash2 = generateContentHash(findings);
    expect(hash1).toBe(hash2);
  });

  it("should generate different hashes for different content", () => {
    const hash1 = generateContentHash(["Finding about AI advances"]);
    const hash2 = generateContentHash(["Finding about blockchain trends"]);
    expect(hash1).not.toBe(hash2);
  });

  it("should be order-independent", () => {
    const hash1 = generateContentHash(["Finding A long enough to matter", "Finding B long enough to matter"]);
    const hash2 = generateContentHash(["Finding B long enough to matter", "Finding A long enough to matter"]);
    expect(hash1).toBe(hash2);
  });

  it("should normalize whitespace", () => {
    const hash1 = generateContentHash(["Finding   with   spaces"]);
    const hash2 = generateContentHash(["Finding with spaces"]);
    expect(hash1).toBe(hash2);
  });
});

describe("detectNovelContent", () => {
  it("should detect novel content on first report", async () => {
    const html = '<div><p>This is a completely new finding about TypeScript 5.4 that introduces several new features and improvements.</p><a href="https://example.com">Source</a></div>';
    const result = await detectNovelContent("TypeScript", html);
    expect(result.isNovel).toBe(true);
    expect(result.contentHash).toBeDefined();
  });

  it("should detect duplicate content hash", async () => {
    const html = '<div><p>This is a finding about TypeScript 5.4 that introduces several new features and significant improvements for developers.</p></div>';
    
    // Save first
    const report = await saveReport("TypeScript", html);
    await processReportMemory("TypeScript", report.id, html);
    
    // Check same content again
    const result = await detectNovelContent("TypeScript", html);
    expect(result.isNovel).toBe(false);
  });
});

describe("processReportMemory", () => {
  it("should save content memory for new report", async () => {
    const html = '<div><p>New research finding about AI safety and alignment techniques being developed at major research labs around the world.</p><a href="https://ai-safety.org">Source</a></div>';
    const report = await saveReport("AI Safety", html);
    
    const result = await processReportMemory("AI Safety", report.id, html);
    expect(result.isNovel).toBe(true);
    
    const memory = await getContentMemory("AI Safety");
    expect(memory.length).toBe(1);
  });

  it("should create notification for novel content", async () => {
    const html = '<div><p>Breaking discovery in quantum computing enables new approaches to error correction that could accelerate the timeline for practical quantum computers.</p></div>';
    const report = await saveReport("Quantum Computing", html);
    
    const result = await processReportMemory("Quantum Computing", report.id, html);
    expect(result.notificationCreated).toBe(true);
    
    const notifications = await getNotifications("anonymous");
    expect(notifications.length).toBeGreaterThan(0);
  });

  it("should not create notification for duplicate content", async () => {
    const html = '<div><p>Repeated finding about machine learning optimization techniques that have been widely discussed in recent publications and conferences.</p></div>';
    
    // First report
    const report1 = await saveReport("ML", html);
    await processReportMemory("ML", report1.id, html);
    
    // Same content again
    const report2 = await saveReport("ML", html);
    const result = await processReportMemory("ML", report2.id, html);
    
    expect(result.notificationCreated).toBe(false);
  });
});
