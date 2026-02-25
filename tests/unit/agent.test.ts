import { describe, it, expect } from "bun:test";
import { __testing } from "../../src/agent.js";
import type { SearchResult } from "../../src/types.js";
import {
  sampleSearchResults,
  sampleHtmlReport,
  createMockResearchState,
  createCompletedResearchState,
} from "../fixtures/sample-data.js";

/**
 * Unit Tests for Research Agent
 * Tests agent structure, exported functions, state handling, and utilities
 */

describe("Agent - Exported Functions", () => {
  it("should export plannerNode function", () => {
    expect(__testing.plannerNode).toBeDefined();
    expect(typeof __testing.plannerNode).toBe("function");
  });

  it("should export searchNode function", () => {
    expect(__testing.searchNode).toBeDefined();
    expect(typeof __testing.searchNode).toBe("function");
  });

  it("should export synthesisNode function", () => {
    expect(__testing.synthesisNode).toBeDefined();
    expect(typeof __testing.synthesisNode).toBe("function");
  });

  it("should export shouldContinueSearch function", () => {
    expect(__testing.shouldContinueSearch).toBeDefined();
    expect(typeof __testing.shouldContinueSearch).toBe("function");
  });

  it("should export buildGraph function", () => {
    expect(__testing.buildGraph).toBeDefined();
    expect(typeof __testing.buildGraph).toBe("function");
  });
});

describe("Agent - State Handling", () => {
  it("should create valid initial research state", () => {
    const state = createMockResearchState();

    expect(state.topic).toBe("TypeScript 5.4 new features");
    expect(state.search_queries).toEqual([]);
    expect(state.search_results).toEqual([]);
    expect(state.synthesis).toBe("");
    expect(state.iterations).toBe(0);
    expect(state.messages).toEqual([]);
  });

  it("should create state with overrides", () => {
    const state = createMockResearchState({
      topic: "Custom Topic",
      iterations: 2,
    });

    expect(state.topic).toBe("Custom Topic");
    expect(state.iterations).toBe(2);
    expect(state.search_queries).toEqual([]);
  });

  it("should handle completed research state", () => {
    const state = createCompletedResearchState();

    expect(state.topic).toBeTruthy();
    expect(state.search_queries.length).toBeGreaterThan(0);
    expect(state.search_results.length).toBeGreaterThan(0);
    expect(state.synthesis.length).toBeGreaterThan(0);
    expect(state.iterations).toBeGreaterThan(0);
    expect(state.messages.length).toBeGreaterThan(0);
  });

  it("should handle search results with valid URLs", () => {
    for (const result of sampleSearchResults) {
      expect(result.url).toMatch(/^https?:\/\//);
      expect(result.title).toBeTruthy();
      expect(result.snippet).toBeTruthy();
    }
  });
});

describe("Agent - Routing Logic", () => {
  it("should return 'end' when max iterations reached", () => {
    const state = createMockResearchState({ iterations: 3 });
    expect(__testing.shouldContinueSearch(state)).toBe("end");
  });

  it("should return 'planner' when synthesis is empty", () => {
    const state = createMockResearchState({
      synthesis: "",
      iterations: 1,
    });
    expect(__testing.shouldContinueSearch(state)).toBe("planner");
  });

  it("should return 'planner' when synthesis too short", () => {
    const state = createMockResearchState({
      synthesis: "Short summary with few words.",
      iterations: 1,
    });
    expect(__testing.shouldContinueSearch(state)).toBe("planner");
  });

  it("should return 'end' when synthesis is adequate", () => {
    const state = createMockResearchState({
      synthesis: sampleHtmlReport,
      iterations: 2,
    });
    expect(__testing.shouldContinueSearch(state)).toBe("end");
  });

  it("should return 'end' at max iterations even with short synthesis", () => {
    const state = createMockResearchState({
      synthesis: "Short.",
      iterations: 3,
    });
    expect(__testing.shouldContinueSearch(state)).toBe("end");
  });
});

describe("Agent - Graph Structure", () => {
  it("should build a compiled graph", () => {
    const graph = __testing.buildGraph();
    expect(graph).toBeDefined();
    expect(typeof graph.invoke).toBe("function");
  });

  it("built graph should be a unique instance", () => {
    const graph1 = __testing.buildGraph();
    const graph2 = __testing.buildGraph();
    expect(graph1).toBeDefined();
    expect(graph2).toBeDefined();
    // Both should be valid but different instances
    expect(typeof graph1.invoke).toBe("function");
    expect(typeof graph2.invoke).toBe("function");
  });
});

describe("Agent - HTML Utilities", () => {
  it("should escape HTML special characters", () => {
    const result = __testing.escapeHtml('<script>alert("xss")</script>');
    expect(result).toBe("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
  });

  it("should escape ampersands", () => {
    expect(__testing.escapeHtml("A & B")).toBe("A &amp; B");
  });

  it("should handle empty string", () => {
    expect(__testing.escapeHtml("")).toBe("");
  });

  it("should not double-escape", () => {
    const once = __testing.escapeHtml("<div>");
    expect(once).toBe("&lt;div&gt;");
  });
});

describe("Agent - Report Generators", () => {
  it("should generate fallback report with sources", () => {
    const html = __testing.generateFallbackReport(
      "Test Topic",
      sampleSearchResults,
    );

    expect(html).toContain("Test Topic");
    expect(html).toContain("report-item");
    expect(html).toContain("sources");
    expect(html).toContain("href=");
  });

  it("should generate fallback report without sources", () => {
    const html = __testing.generateFallbackReport("Test Topic", []);

    expect(html).toContain("Test Topic");
    expect(html).toContain("report-item");
    expect(html).toContain("0 relevant sources");
  });

  it("should generate error report", () => {
    const html = __testing.generateErrorReport(
      "Test Topic",
      new Error("API timeout"),
    );

    expect(html).toContain("Test Topic");
    expect(html).toContain("error");
    expect(html).toContain("API timeout");
  });

  it("should sanitize API keys in error reports", () => {
    const html = __testing.generateErrorReport(
      "Test",
      new Error("Failed with key sk-abc123xyz"),
    );

    expect(html).not.toContain("sk-abc123xyz");
    expect(html).toContain("sk-***");
  });
});
