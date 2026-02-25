import type { BaseMessage } from "@langchain/core/messages";

/**
 * User context from Authentik OIDC token
 */
export interface AuthUser {
  sub: string; // Unique user ID from OIDC
  email: string;
  name: string;
  groups?: string[];
}

/**
 * Research report stored in database
 */
export interface Report {
  id: string;
  topic: string;
  html_content: string;
  markdown_content?: string;
  created_at: string; // ISO 8601 timestamp
  is_bookmarked?: boolean;
}

/**
 * Bookmarked/favorited report
 */
export interface Bookmark {
  id: string;
  report_id: string;
  user_id: string; // 'anonymous' for dev mode
  note?: string;
  created_at: string;
}

/**
 * Category/Tag for organizing topics
 */
export interface Category {
  id: string;
  name: string;
  color: string; // hex color like #667eea
  created_at: string;
}

/**
 * Topic-Category association
 */
export interface TopicCategory {
  topic_id: string;
  category_id: string;
}

/**
 * Research topic to investigate
 */
export interface Topic {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  categories?: Category[];
}

/**
 * Search result from Tavily
 */
export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
  publication_date?: string;
  source?: string;
}

/**
 * State shape for LangGraph research agent
 */
export interface ResearchState {
  topic: string;
  search_queries: string[];
  search_results: SearchResult[];
  synthesis: string;
  iterations: number;
  messages: BaseMessage[];
}

/**
 * API Response wrapper
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

/**
 * Paginated API response
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/**
 * Session data stored in cookie
 */
export interface SessionData {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // Unix timestamp
}

/**
 * Request context with auth information
 */
export interface RequestContext {
  user?: AuthUser;
  sessionData?: SessionData;
  isAuthenticated: boolean;
}

/**
 * Notification for new reports
 */
export interface Notification {
  id: string;
  report_id: string;
  user_id: string;
  type: "new_report" | "weekly_summary";
  title: string;
  message: string;
  read: boolean;
  created_at: string;
}

/**
 * Content hash for novelty detection / memory tracking
 * Stores hashes of key findings to avoid re-notifying the same content
 */
export interface ContentMemory {
  id: string;
  topic: string;
  content_hash: string; // SHA-256 of normalized key findings
  key_findings: string; // JSON array of key finding strings
  source_urls: string; // JSON array of source URLs
  report_id: string;
  created_at: string;
}

/**
 * Weekly multi-topic summary
 */
export interface WeeklySummary {
  id: string;
  week_start: string; // ISO date of week start
  week_end: string;
  html_content: string;
  topics_covered: string; // JSON array of topic names
  created_at: string;
}
