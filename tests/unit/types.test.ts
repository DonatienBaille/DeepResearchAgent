import { describe, it, expect } from "bun:test";
import type {
  AuthUser,
  Report,
  Topic,
  SearchResult,
  ResearchState,
  ApiResponse,
  PaginatedResponse,
  SessionData,
  RequestContext,
} from "../../src/types.js";

/**
 * Unit Tests for Type Definitions
 * Validates type shapes and interface compliance
 */

describe("Types - AuthUser", () => {
  it("should accept valid AuthUser", () => {
    const user: AuthUser = {
      sub: "user-123",
      email: "test@example.com",
      name: "Test User",
      groups: ["admin"],
    };

    expect(user.sub).toBe("user-123");
    expect(user.email).toBe("test@example.com");
    expect(user.name).toBe("Test User");
    expect(user.groups).toEqual(["admin"]);
  });

  it("should accept AuthUser without optional groups", () => {
    const user: AuthUser = {
      sub: "user-456",
      email: "no-groups@example.com",
      name: "No Groups User",
    };

    expect(user.sub).toBeTruthy();
    expect(user.groups).toBeUndefined();
  });
});

describe("Types - Report", () => {
  it("should accept valid Report", () => {
    const report: Report = {
      id: "report-123",
      topic: "Test Topic",
      html_content: "<p>Content</p>",
      markdown_content: "# Content",
      created_at: "2026-02-25T09:00:00.000Z",
    };

    expect(report.id).toBeTruthy();
    expect(report.topic).toBeTruthy();
    expect(report.html_content).toBeTruthy();
    expect(report.markdown_content).toBeTruthy();
    expect(report.created_at).toBeTruthy();
  });

  it("should accept Report without optional markdown", () => {
    const report: Report = {
      id: "report-456",
      topic: "Test",
      html_content: "<p>HTML only</p>",
      created_at: "2026-02-25T09:00:00.000Z",
    };

    expect(report.markdown_content).toBeUndefined();
  });
});

describe("Types - Topic", () => {
  it("should accept valid Topic", () => {
    const topic: Topic = {
      id: "topic-123",
      name: "TypeScript 5.4",
      active: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    };

    expect(topic.active).toBe(true);
    expect(topic.name).toBe("TypeScript 5.4");
  });

  it("should handle inactive topic", () => {
    const topic: Topic = {
      id: "topic-456",
      name: "Deprecated Topic",
      active: false,
      created_at: "2025-06-01T00:00:00.000Z",
      updated_at: "2026-01-15T00:00:00.000Z",
    };

    expect(topic.active).toBe(false);
  });
});

describe("Types - SearchResult", () => {
  it("should accept valid SearchResult", () => {
    const result: SearchResult = {
      title: "Article Title",
      snippet: "Article snippet text",
      url: "https://example.com/article",
      source: "example.com",
    };

    expect(result.url).toMatch(/^https:\/\//);
    expect(result.source).toBe("example.com");
  });

  it("should accept SearchResult with optional fields", () => {
    const result: SearchResult = {
      title: "Minimal",
      snippet: "Snippet",
      url: "https://example.com",
    };

    expect(result.source).toBeUndefined();
    expect(result.publication_date).toBeUndefined();
  });
});

describe("Types - ApiResponse", () => {
  it("should wrap success response", () => {
    const response: ApiResponse<string> = {
      success: true,
      data: "test data",
      timestamp: new Date().toISOString(),
    };

    expect(response.success).toBe(true);
    expect(response.data).toBe("test data");
    expect(response.error).toBeUndefined();
  });

  it("should wrap error response", () => {
    const response: ApiResponse<null> = {
      success: false,
      error: "Something went wrong",
      timestamp: new Date().toISOString(),
    };

    expect(response.success).toBe(false);
    expect(response.error).toBeTruthy();
    expect(response.data).toBeUndefined();
  });
});

describe("Types - PaginatedResponse", () => {
  it("should accept valid paginated response", () => {
    const response: PaginatedResponse<Report> = {
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      hasMore: false,
    };

    expect(response.items).toEqual([]);
    expect(response.total).toBe(0);
    expect(response.hasMore).toBe(false);
  });

  it("should indicate hasMore when more pages exist", () => {
    const response: PaginatedResponse<string> = {
      items: ["a", "b"],
      total: 10,
      page: 1,
      limit: 2,
      hasMore: true,
    };

    expect(response.hasMore).toBe(true);
    expect(response.items.length).toBeLessThan(response.total);
  });
});

describe("Types - SessionData", () => {
  it("should accept valid session data", () => {
    const session: SessionData = {
      userId: "user-123",
      email: "test@example.com",
      accessToken: "jwt.token.here",
      expiresAt: Date.now() + 3600000,
    };

    expect(session.userId).toBeTruthy();
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });

  it("should detect expired session", () => {
    const session: SessionData = {
      userId: "user-123",
      email: "test@example.com",
      accessToken: "expired.token",
      expiresAt: Date.now() - 1000, // 1 second ago
    };

    expect(session.expiresAt).toBeLessThan(Date.now());
  });
});

describe("Types - RequestContext", () => {
  it("should handle authenticated context", () => {
    const ctx: RequestContext = {
      user: {
        sub: "user-123",
        email: "test@example.com",
        name: "Test",
      },
      isAuthenticated: true,
    };

    expect(ctx.isAuthenticated).toBe(true);
    expect(ctx.user).toBeDefined();
  });

  it("should handle unauthenticated context", () => {
    const ctx: RequestContext = {
      isAuthenticated: false,
    };

    expect(ctx.isAuthenticated).toBe(false);
    expect(ctx.user).toBeUndefined();
  });
});
