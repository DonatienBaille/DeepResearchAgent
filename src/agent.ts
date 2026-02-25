import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { TavilySearchAPIRetriever } from "@langchain/community/retrievers/tavily_search_api";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { SearchResult } from "./types.js";
import {
  AgentError,
  ExternalServiceError,
  sanitizeErrorForLog,
} from "./utils/errors.js";

/**
 * Deep Research Agent using LangGraph
 * Implements a three-node workflow: Planner → Search → Synthesis
 * with conditional routing for iterative refinement
 */

// ============= Configuration =============

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_ITERATIONS = 3;
const MIN_WORD_COUNT = 100;
const SEARCH_RESULTS_PER_QUERY = 5;
const SEARCH_TIMEOUT_MS = 30_000;

// ============= LangGraph State Annotation =============

/**
 * Research state using LangGraph Annotation pattern
 * This is the modern API replacing the channels-based approach
 */
const ResearchStateAnnotation = Annotation.Root({
  topic: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  search_queries: Annotation<string[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  search_results: Annotation<SearchResult[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  synthesis: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
  iterations: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  messages: Annotation<BaseMessage[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
});

type ResearchState = typeof ResearchStateAnnotation.State;

// ============= LLM & Tools Initialization =============

/** Create LLM instance (lazy, allows env vars to be set at runtime) */
function createLLM(): ChatOpenAI {
  return new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    modelName: OPENAI_MODEL,
    temperature: 0.5,
    maxTokens: 500,
  });
}

/** Create search retriever (lazy) */
function createSearchRetriever(): TavilySearchAPIRetriever {
  return new TavilySearchAPIRetriever({
    k: SEARCH_RESULTS_PER_QUERY,
    apiKey: process.env.TAVILY_API_KEY || "",
  });
}

// ============= Graph Nodes =============

/**
 * Planner Node: Generate targeted search queries from topic
 */
async function plannerNode(
  state: ResearchState,
): Promise<Partial<ResearchState>> {
  const llm = createLLM();

  const feedbackContext =
    state.iterations > 0
      ? `\nPrevious search found ${state.search_results.length} results but synthesis was insufficient. Generate different, more specific queries.`
      : "";

  const messages: BaseMessage[] = [
    new HumanMessage(
      `You are a research planning expert. Given a technology topic, generate 4-5 specific, actionable search queries that would help compile a comprehensive technical brief.${feedbackContext}

Topic: "${state.topic}"

Return ONLY a JSON array of strings (search queries), no other text.
Example: ["TypeScript 5.4 new features", "TypeScript 5.4 breaking changes", "TypeScript 5.4 performance"]

Search Queries (JSON array):`,
    ),
  ];

  const response = await llm.invoke(messages);
  const responseText =
    typeof response.content === "string"
      ? response.content
      : response.content
          .map((c) => (typeof c === "string" ? c : c.type))
          .join("");

  let queries: string[] = [];
  try {
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      queries = JSON.parse(jsonMatch[0]);
    }
  } catch {
    // Fallback: use the topic as query
    console.warn(
      "[Agent] Failed to parse planner response, using topic as fallback",
    );
    queries = [state.topic];
  }

  // Ensure we have at least one query
  if (queries.length === 0) {
    queries = [state.topic];
  }

  return {
    search_queries: queries,
    messages: [
      ...state.messages,
      new HumanMessage(`Generate search queries for: ${state.topic}`),
      new AIMessage(responseText),
    ],
  };
}

/**
 * Search Node: Execute web searches using Tavily with timeout
 */
async function searchNode(
  state: ResearchState,
): Promise<Partial<ResearchState>> {
  if (state.search_queries.length === 0) {
    return { search_results: [], iterations: state.iterations + 1 };
  }

  const searchRetriever = createSearchRetriever();
  const resultMap = new Map<string, SearchResult>();

  // Execute searches in parallel with timeout
  const searchPromises = state.search_queries.map(async (query) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

      try {
        const docs = await searchRetriever.invoke(query);

        for (const doc of docs) {
          const url = doc.metadata?.source || `result-${Math.random()}`;
          if (!resultMap.has(url)) {
            let hostname = "source";
            try {
              hostname = new URL(url).hostname || "source";
            } catch {
              hostname = url.split("/")[2] || "source";
            }

            resultMap.set(url, {
              title: doc.metadata?.title || hostname || query,
              snippet: doc.pageContent.substring(0, 300),
              url,
              source: hostname,
            });
          }
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      console.error(
        `[Agent] Search failed for "${query}":`,
        sanitizeErrorForLog(error),
      );
    }
  });

  await Promise.allSettled(searchPromises);

  const results = Array.from(resultMap.values());

  return {
    search_results: results,
    iterations: state.iterations + 1,
    messages: [
      ...state.messages,
      new AIMessage(
        `Found ${results.length} relevant resources for topic: ${state.topic}`,
      ),
    ],
  };
}

/**
 * Synthesis Node: Generate HTML report from search results
 */
async function synthesisNode(
  state: ResearchState,
): Promise<Partial<ResearchState>> {
  if (state.search_results.length === 0) {
    return {
      synthesis: generateFallbackReport(state.topic, []),
      messages: [
        ...state.messages,
        new AIMessage("No search results found, generated fallback report"),
      ],
    };
  }

  const llm = createLLM();

  // Format search results for LLM context
  const resultsText = state.search_results
    .map(
      (r, i) =>
        `[${i + 1}] Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}\nSource: ${r.source || "Unknown"}`,
    )
    .join("\n\n");

  const messages: BaseMessage[] = [
    new HumanMessage(
      `You are a professional technology researcher. Based on the following research results about "${state.topic}", write a clear, informative HTML paragraph (150-300 words) summarizing the key findings.

FORMAT YOUR RESPONSE AS VALID HTML:
- Wrap the main content in <div class="report-item">
- Use <p> tags for paragraphs
- Add a <p class="sources"> section with inline <a href="URL" target="_blank">source name</a> links for 2-3 most relevant sources
- Keep styling minimal but professional

RESEARCH RESULTS:
${resultsText}

Requirements:
- Write in HTML only, no markdown
- Include specific technical details and facts
- Cite sources inline when mentioning specific findings
- Target professional technical audience
- Minimum 150 words

HTML Response:`,
    ),
  ];

  const response = await llm.invoke(messages);
  const html =
    typeof response.content === "string"
      ? response.content
      : response.content.map((c) => (typeof c === "string" ? c : "")).join("");

  return {
    synthesis: html,
    messages: [
      ...state.messages,
      new HumanMessage("Synthesize research findings"),
      new AIMessage(html),
    ],
  };
}

// ============= Routing Logic =============

/**
 * Router: Determine if research should continue or end
 */
function shouldContinueSearch(state: ResearchState): string {
  // Max iterations reached
  if (state.iterations >= MAX_ITERATIONS) {
    return "end";
  }

  // No synthesis yet
  if (!state.synthesis || state.synthesis.length === 0) {
    return "planner";
  }

  // Check word count
  const wordCount = state.synthesis.split(/\s+/).length;
  if (wordCount < MIN_WORD_COUNT && state.iterations < MAX_ITERATIONS) {
    return "planner";
  }

  return "end";
}

// ============= Graph Builder =============

/**
 * Build and compile the LangGraph research workflow
 */
function buildGraph() {
  const workflow = new StateGraph(ResearchStateAnnotation);

  // Add nodes
  workflow.addNode("planner", plannerNode);
  workflow.addNode("search", searchNode);
  workflow.addNode("synthesize", synthesisNode);

  // Add edges: START → planner → search → synthesize
  workflow.addEdge(START, "planner");
  workflow.addEdge("planner", "search");
  workflow.addEdge("search", "synthesize");

  // Conditional edge: synthesize → planner (loop) or END
  workflow.addConditionalEdges("synthesize", shouldContinueSearch, {
    planner: "planner",
    end: END,
  });

  return workflow.compile();
}

// Lazy-compiled graph instance
let compiledGraph: ReturnType<typeof buildGraph> | null = null;

function getGraph() {
  if (!compiledGraph) {
    compiledGraph = buildGraph();
  }
  return compiledGraph;
}

// ============= Main Entry Point =============

/**
 * Run deep research agent for a topic
 * @param topic - The research topic to investigate
 * @returns HTML string ready for email/dashboard
 */
export async function runDeepResearchAgent(topic: string): Promise<string> {
  const initialState: ResearchState = {
    topic,
    search_queries: [],
    search_results: [],
    synthesis: "",
    iterations: 0,
    messages: [],
  };

  try {
    console.log(`[Agent] Starting research for topic: "${topic}"`);
    const startTime = Date.now();

    const graph = getGraph();
    const result = await graph.invoke(initialState, {
      recursionLimit: 25,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Agent] Completed "${topic}" in ${duration}s`);
    console.log(
      `[Agent] Iterations: ${result.iterations}, Results: ${result.search_results.length}`,
    );

    // Return synthesis or fallback
    const synthesis = result.synthesis || "";
    if (!synthesis || synthesis.trim().length === 0) {
      return generateFallbackReport(topic, result.search_results);
    }

    return synthesis;
  } catch (error) {
    console.error(`[Agent] Error for "${topic}":`, sanitizeErrorForLog(error));
    return generateErrorReport(topic, error);
  }
}

// ============= Report Generators =============

/**
 * Generate fallback report when synthesis is empty
 */
function generateFallbackReport(
  topic: string,
  results: SearchResult[],
): string {
  const sourcesHtml = results
    .slice(0, 3)
    .map(
      (r) =>
        `<a href="${escapeAttr(r.url)}" target="_blank">${escapeHtml(r.title)}</a>`,
    )
    .join(", ");

  return `
<div class="report-item">
  <p>
    Research conducted on topic: <strong>${escapeHtml(topic)}</strong>.
    ${results.length} relevant sources were identified and compiled below.
  </p>
  ${sourcesHtml ? `<p class="sources"><strong>Sources:</strong> ${sourcesHtml}</p>` : ""}
</div>`.trim();
}

/**
 * Generate error report when agent fails
 */
function generateErrorReport(topic: string, error: unknown): string {
  const errorMsg = error instanceof Error ? error.message : String(error);
  return `
<div class="report-item error">
  <p>
    Research for <strong>${escapeHtml(topic)}</strong> encountered an error.
  </p>
  <p class="error-details">
    Error: ${escapeHtml(sanitizeErrorForLog(errorMsg))}
  </p>
</div>`.trim();
}

// ============= HTML Utilities =============

/** Escape HTML special characters */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/** Escape attribute value */
function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ============= Exports for Testing =============

export const __testing = {
  plannerNode,
  searchNode,
  synthesisNode,
  shouldContinueSearch,
  buildGraph,
  generateFallbackReport,
  generateErrorReport,
  escapeHtml,
};
