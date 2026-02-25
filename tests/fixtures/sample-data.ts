import type {
  SearchResult,
  Report,
  Topic,
  AuthUser,
  ResearchState,
} from "../../src/types.js";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

/**
 * Test fixtures and sample data for unit and integration tests
 */

// ============= Topics =============

export const sampleTopics: Omit<Topic, "id">[] = [
  {
    name: "TypeScript 5.4 new features and improvements",
    active: true,
    created_at: "2026-01-15T09:00:00.000Z",
    updated_at: "2026-01-15T09:00:00.000Z",
  },
  {
    name: "LangChain and LangGraph latest updates",
    active: true,
    created_at: "2026-01-15T09:00:00.000Z",
    updated_at: "2026-01-15T09:00:00.000Z",
  },
  {
    name: "Docker and Kubernetes best practices 2025",
    active: false,
    created_at: "2026-01-10T09:00:00.000Z",
    updated_at: "2026-02-01T12:00:00.000Z",
  },
];

// ============= Search Results =============

export const sampleSearchResults: SearchResult[] = [
  {
    title: "TypeScript 5.4 Release Notes",
    snippet:
      "TypeScript 5.4 introduces NoInfer utility type, improved narrowing in closures, and Object.groupBy support. The release focuses on type inference improvements and developer experience enhancements.",
    url: "https://devblogs.microsoft.com/typescript/announcing-typescript-5-4/",
    source: "devblogs.microsoft.com",
  },
  {
    title: "What's New in TypeScript 5.4 - LogRocket Blog",
    snippet:
      "Explore the new features in TypeScript 5.4 including the NoInfer type, preserved narrowing in closures, improved generic functions, and stricter enum checks.",
    url: "https://blog.logrocket.com/whats-new-typescript-5-4/",
    source: "blog.logrocket.com",
  },
  {
    title: "TypeScript 5.4 Performance Benchmarks",
    snippet:
      "Performance benchmarks comparing TypeScript 5.4 compilation speed with previous versions show a 10-15% improvement in type checking for large projects.",
    url: "https://example.com/ts-benchmarks",
    source: "example.com",
  },
];

// ============= Reports =============

export const sampleHtmlReport = `
<div class="report-item">
  <p>
    <strong>TypeScript 5.4</strong> introduces several notable improvements to the type system and developer experience.
    The most significant addition is the <code>NoInfer</code> utility type, which prevents TypeScript from inferring
    types from specific positions in generic function calls. This gives developers more control over type inference
    behavior in complex generic scenarios, reducing the need for manual type annotations in library code.
  </p>
  <h3>Principales découvertes</h3>
  <p>
    The <code>NoInfer</code> utility type is particularly useful for library authors who need to control how
    TypeScript infers generic type parameters. By wrapping a type parameter position with <code>NoInfer</code>,
    the compiler will skip that position when performing type inference, forcing users to provide explicit types
    or relying on other parameter positions for inference. This addresses a long-standing pain point in the
    TypeScript ecosystem where generic functions would sometimes infer unexpected types.
  </p>
  <p>
    Additionally, TypeScript 5.4 brings improved narrowing in closures, allowing the compiler to better track
    type refinements across closure boundaries. Previously, type narrowing performed before a closure was created
    would not be preserved inside the closure, leading to unnecessary type assertions. The new behavior correctly
    propagates narrowing information into closures, making code more type-safe without additional annotations.
  </p>
  <p>
    The release also adds support for <code>Object.groupBy</code> and <code>Map.groupBy</code> static methods
    with proper type signatures, aligning with the latest ECMAScript proposals. Performance improvements in the
    compiler reduce build times by approximately 5-10% for large projects. The team has also improved error
    messages to be more descriptive and actionable, helping developers diagnose type errors more quickly.
  </p>
  <h3>Analyse</h3>
  <p>
    These changes collectively represent a maturation of the TypeScript type system, with a focus on developer
    ergonomics and real-world usage patterns. The <code>NoInfer</code> type in particular shows the team's
    commitment to supporting the library ecosystem, which is critical for TypeScript's continued adoption.
  </p>
  <p class="sources">
    <strong>Sources :</strong>
    <a href="https://devblogs.microsoft.com/typescript/announcing-typescript-5-4/" target="_blank">TypeScript Blog</a>,
    <a href="https://blog.logrocket.com/whats-new-typescript-5-4/" target="_blank">LogRocket</a>,
    <a href="https://www.totaltypescript.com/typescript-5-4" target="_blank">Total TypeScript</a>
  </p>
</div>
`.trim();

export const sampleMarkdownReport = `
# TypeScript 5.4 Research Summary

## Key Findings

- **NoInfer utility type**: Prevents type inference from specific positions
- **Improved closure narrowing**: Better type tracking across closures
- **Object.groupBy support**: New static method with proper types

## Sources

1. [TypeScript Blog](https://devblogs.microsoft.com/typescript/announcing-typescript-5-4/)
2. [LogRocket](https://blog.logrocket.com/whats-new-typescript-5-4/)
`.trim();

export const sampleReports: Omit<Report, "id">[] = [
  {
    topic: "TypeScript 5.4 new features and improvements",
    html_content: sampleHtmlReport,
    markdown_content: sampleMarkdownReport,
    created_at: "2026-02-24T09:15:00.000Z",
  },
  {
    topic: "LangChain and LangGraph latest updates",
    html_content: `<div class="report-item"><p>LangGraph 0.2 introduces improved state management with the Annotation pattern, replacing the older channels-based API. Key improvements include better TypeScript support, streaming capabilities, and a new checkpoint system.</p><p class="sources"><strong>Sources:</strong> <a href="https://langchain.com" target="_blank">LangChain</a></p></div>`,
    created_at: "2026-02-24T09:30:00.000Z",
  },
];

// ============= Auth User =============

export const sampleAuthUser: AuthUser = {
  sub: "user-123-abc",
  email: "researcher@example.com",
  name: "Test Researcher",
  groups: ["research-team", "admins"],
};

export const sampleAuthUserMinimal: AuthUser = {
  sub: "user-456-def",
  email: "viewer@example.com",
  name: "Viewer",
};

// ============= Research State =============

export function createMockResearchState(
  overrides: Partial<ResearchState> = {},
): ResearchState {
  return {
    topic: "TypeScript 5.4 new features",
    search_queries: [],
    search_results: [],
    synthesis: "",
    iterations: 0,
    messages: [],
    ...overrides,
  };
}

export function createCompletedResearchState(): ResearchState {
  return {
    topic: "TypeScript 5.4 new features",
    search_queries: [
      "TypeScript 5.4 new features",
      "TypeScript 5.4 breaking changes",
      "TypeScript 5.4 performance",
    ],
    search_results: sampleSearchResults,
    synthesis: sampleHtmlReport,
    iterations: 2,
    messages: [
      new HumanMessage("Generate search queries for: TypeScript 5.4"),
      new AIMessage(
        '["TypeScript 5.4 new features", "TypeScript 5.4 breaking changes"]',
      ),
      new AIMessage("Found 3 relevant resources"),
      new HumanMessage("Synthesize research findings"),
      new AIMessage(sampleHtmlReport),
    ],
  };
}

// ============= LLM Mock Responses =============

export const mockPlannerResponse = JSON.stringify([
  "TypeScript 5.4 new features 2024",
  "TypeScript 5.4 NoInfer utility type",
  "TypeScript 5.4 performance improvements",
  "TypeScript 5.4 breaking changes migration",
]);

export const mockSynthesisResponse = sampleHtmlReport;

// ============= API Response Helpers =============

export function createApiResponse<T>(data: T, success = true) {
  return {
    success,
    data,
    timestamp: new Date().toISOString(),
  };
}

export function createPaginatedResponse<T>(
  items: T[],
  total: number,
  page = 1,
  limit = 20,
) {
  return {
    success: true,
    data: {
      items,
      total,
      page,
      limit,
      hasMore: (page - 1) * limit + limit < total,
    },
    timestamp: new Date().toISOString(),
  };
}
