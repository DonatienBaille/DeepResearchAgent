import initSqlJs, { Database as SqlJsDb } from "sql.js";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import type {
  Report,
  Topic,
  Category,
  Bookmark,
  Notification,
  ContentMemory,
  WeeklySummary,
} from "./types.js";
import {
  NotFoundError,
  ConflictError,
  DatabaseError,
  ValidationError,
} from "./utils/errors.js";

/**
 * Database initialization and CRUD operations
 * Uses sql.js (pure JavaScript) for SQLite access
 * Persists to disk automatically on write operations only
 */

let db: SqlJsDb | null = null;
let SQL: any = null;

/**
 * Initialize SQL.js WASM module
 */
async function initSQL(): Promise<void> {
  if (!SQL) {
    SQL = await initSqlJs();
  }
}

/**
 * Load database from disk or create new
 */
async function loadDb(): Promise<SqlJsDb> {
  await initSQL();

  const dbPath = process.env.DATABASE_PATH || "./research.db";

  if (dbPath !== ":memory:" && existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    return new SQL.Database(buffer);
  }

  return new SQL.Database();
}

/**
 * Save database to disk (only called after write operations)
 */
function saveDb(database: SqlJsDb): void {
  const dbPath = process.env.DATABASE_PATH || "./research.db";

  // Skip saving for in-memory databases (testing)
  if (dbPath === ":memory:") {
    return;
  }

  try {
    const data = database.export();
    const buffer = Buffer.from(data);
    writeFileSync(dbPath, buffer);
  } catch (error) {
    console.error("[DB] Failed to persist database:", error);
  }
}

/**
 * Initialize or retrieve the database connection
 */
export async function getDb(): Promise<SqlJsDb> {
  if (db) return db;

  db = await loadDb();
  initSchema();
  saveDb(db);

  return db;
}

/**
 * Reset database connection (for test isolation)
 * Closes existing connection so next getDb() creates a fresh one
 */
export function resetDb(): void {
  if (db) {
    try {
      db.close();
    } catch {
      // Ignore close errors during reset
    }
    db = null;
  }
}

/**
 * Initialize database schema if not exists
 */
function initSchema(): void {
  if (!db) throw new DatabaseError("init", "Database not initialized");

  // Enable WAL mode for better concurrent read performance
  try {
    db.run("PRAGMA journal_mode=WAL");
  } catch {
    // WAL may not be supported in all sql.js builds
  }

  // Create topics table
  db.run(`
    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_topics_active ON topics(active)");
  db.run("CREATE INDEX IF NOT EXISTS idx_topics_name ON topics(name)");

  // Create reports table
  db.run(`
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      html_content TEXT NOT NULL,
      markdown_content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(topic) REFERENCES topics(name)
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_reports_topic ON reports(topic)");
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at)",
  );

  // Create categories table
  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT '#667eea',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create topic_categories junction table
  db.run(`
    CREATE TABLE IF NOT EXISTS topic_categories (
      topic_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      PRIMARY KEY (topic_id, category_id),
      FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE CASCADE,
      FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE
    )
  `);

  // Create bookmarks table
  db.run(`
    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'anonymous',
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(report_id, user_id),
      FOREIGN KEY(report_id) REFERENCES reports(id) ON DELETE CASCADE
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id)");
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_bookmarks_report ON bookmarks(report_id)",
  );

  // Notifications table
  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      report_id TEXT,
      user_id TEXT NOT NULL DEFAULT 'anonymous',
      type TEXT NOT NULL DEFAULT 'new_report',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(report_id) REFERENCES reports(id) ON DELETE CASCADE
    )
  `);
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read)",
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC)",
  );

  // Content memory for novelty tracking
  db.run(`
    CREATE TABLE IF NOT EXISTS content_memory (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      key_findings TEXT NOT NULL DEFAULT '[]',
      source_urls TEXT NOT NULL DEFAULT '[]',
      report_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(report_id) REFERENCES reports(id) ON DELETE CASCADE
    )
  `);
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_content_memory_topic ON content_memory(topic)",
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_content_memory_hash ON content_memory(content_hash)",
  );

  // Weekly summaries
  db.run(`
    CREATE TABLE IF NOT EXISTS weekly_summaries (
      id TEXT PRIMARY KEY,
      week_start TEXT NOT NULL,
      week_end TEXT NOT NULL,
      html_content TEXT NOT NULL,
      topics_covered TEXT NOT NULL DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_weekly_summaries_week ON weekly_summaries(week_start DESC)",
  );
}

/**
 * Close database connection and persist
 */
export function closeDb(): void {
  if (db) {
    try {
      saveDb(db);
    } catch (error) {
      console.warn("[DB] Failed to save database on close", error);
    }
    db.close();
    db = null;
  }
}

// ============= Query Helpers =============

/**
 * Execute a SELECT query and return typed rows
 */
function queryRows<T>(database: SqlJsDb, sql: string, params: any[] = []): T[] {
  const stmt = database.prepare(sql);
  if (params.length > 0) stmt.bind(params);

  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as T);
  }
  stmt.free();
  return results;
}

/**
 * Execute a SELECT query and return a single row or undefined
 */
function queryOne<T>(
  database: SqlJsDb,
  sql: string,
  params: any[] = [],
): T | undefined {
  const stmt = database.prepare(sql);
  if (params.length > 0) stmt.bind(params);

  let result: T | undefined;
  if (stmt.step()) {
    result = stmt.getAsObject() as unknown as T;
  }
  stmt.free();
  return result;
}

/**
 * Execute a write statement (INSERT, UPDATE, DELETE) and persist
 */
function execute(database: SqlJsDb, sql: string, params: any[] = []): void {
  const stmt = database.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  stmt.step();
  stmt.free();
  saveDb(database);
}

// ============= Categories CRUD =============

export async function getCategories(): Promise<Category[]> {
  const database = await getDb();
  return queryRows<Category>(
    database,
    "SELECT id, name, color, created_at FROM categories ORDER BY name ASC",
  );
}

export async function getCategoryById(
  id: string,
): Promise<Category | undefined> {
  const database = await getDb();
  return queryOne<Category>(
    database,
    "SELECT id, name, color, created_at FROM categories WHERE id = ?",
    [id],
  );
}

export async function createCategory(
  name: string,
  color: string = "#667eea",
): Promise<Category> {
  if (!name || name.trim().length === 0) {
    throw new ValidationError("Category name is required", "name");
  }

  const trimmedName = name.trim();
  const database = await getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  try {
    execute(
      database,
      "INSERT INTO categories (id, name, color, created_at) VALUES (?, ?, ?, ?)",
      [id, trimmedName, color, now],
    );

    return { id, name: trimmedName, color, created_at: now };
  } catch (error: any) {
    if (error.message?.includes("UNIQUE")) {
      throw new ConflictError("Category", trimmedName);
    }
    throw new DatabaseError("createCategory", error.message);
  }
}

export async function updateCategory(
  id: string,
  name?: string,
  color?: string,
): Promise<Category> {
  const existing = await getCategoryById(id);
  if (!existing) {
    throw new NotFoundError("Category", id);
  }

  const updatedName = name?.trim() ?? existing.name;
  const updatedColor = color ?? existing.color;
  const database = await getDb();

  try {
    execute(
      database,
      "UPDATE categories SET name = ?, color = ? WHERE id = ?",
      [updatedName, updatedColor, id],
    );
  } catch (error: any) {
    if (error.message?.includes("UNIQUE")) {
      throw new ConflictError("Category", updatedName);
    }
    throw new DatabaseError("updateCategory", error.message);
  }

  return {
    id,
    name: updatedName,
    color: updatedColor,
    created_at: existing.created_at,
  };
}

export async function deleteCategory(id: string): Promise<void> {
  const existing = await getCategoryById(id);
  if (!existing) {
    throw new NotFoundError("Category", id);
  }

  const database = await getDb();
  execute(database, "DELETE FROM topic_categories WHERE category_id = ?", [id]);
  execute(database, "DELETE FROM categories WHERE id = ?", [id]);
}

// ============= Topic-Category Associations =============

export async function addTopicCategory(
  topicId: string,
  categoryId: string,
): Promise<void> {
  const database = await getDb();
  try {
    execute(
      database,
      "INSERT OR IGNORE INTO topic_categories (topic_id, category_id) VALUES (?, ?)",
      [topicId, categoryId],
    );
  } catch (error: any) {
    throw new DatabaseError("addTopicCategory", error.message);
  }
}

export async function removeTopicCategory(
  topicId: string,
  categoryId: string,
): Promise<void> {
  const database = await getDb();
  execute(
    database,
    "DELETE FROM topic_categories WHERE topic_id = ? AND category_id = ?",
    [topicId, categoryId],
  );
}

export async function getTopicCategories(topicId: string): Promise<Category[]> {
  const database = await getDb();
  return queryRows<Category>(
    database,
    `SELECT c.id, c.name, c.color, c.created_at 
     FROM categories c 
     INNER JOIN topic_categories tc ON c.id = tc.category_id 
     WHERE tc.topic_id = ? 
     ORDER BY c.name ASC`,
    [topicId],
  );
}

export async function getTopicsByCategory(
  categoryId: string,
): Promise<Topic[]> {
  const database = await getDb();
  return queryRows<Topic>(
    database,
    `SELECT t.id, t.name, t.active, t.created_at, t.updated_at 
     FROM topics t 
     INNER JOIN topic_categories tc ON t.id = tc.topic_id 
     WHERE tc.category_id = ? 
     ORDER BY t.name ASC`,
    [categoryId],
  );
}

// ============= Bookmarks CRUD =============

export async function getBookmarks(
  userId: string = "anonymous",
): Promise<(Bookmark & { report?: Report })[]> {
  const database = await getDb();
  const rows = queryRows<
    Bookmark & {
      report_topic?: string;
      report_html?: string;
      report_created?: string;
    }
  >(
    database,
    `SELECT b.id, b.report_id, b.user_id, b.note, b.created_at,
            r.topic as report_topic, r.html_content as report_html, r.created_at as report_created
     FROM bookmarks b
     LEFT JOIN reports r ON b.report_id = r.id
     WHERE b.user_id = ?
     ORDER BY b.created_at DESC`,
    [userId],
  );

  return rows.map((row) => ({
    id: row.id,
    report_id: row.report_id,
    user_id: row.user_id,
    note: row.note,
    created_at: row.created_at,
    report: row.report_topic
      ? {
          id: row.report_id,
          topic: row.report_topic,
          html_content: row.report_html || "",
          created_at: row.report_created || "",
        }
      : undefined,
  }));
}

export async function addBookmark(
  reportId: string,
  userId: string = "anonymous",
  note?: string,
): Promise<Bookmark> {
  const report = await getReportById(reportId);
  if (!report) {
    throw new NotFoundError("Report", reportId);
  }

  const database = await getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  try {
    execute(
      database,
      "INSERT INTO bookmarks (id, report_id, user_id, note, created_at) VALUES (?, ?, ?, ?, ?)",
      [id, reportId, userId, note || null, now],
    );

    return { id, report_id: reportId, user_id: userId, note, created_at: now };
  } catch (error: any) {
    if (error.message?.includes("UNIQUE")) {
      throw new ConflictError("Bookmark", reportId);
    }
    throw new DatabaseError("addBookmark", error.message);
  }
}

export async function removeBookmark(
  reportId: string,
  userId: string = "anonymous",
): Promise<void> {
  const database = await getDb();
  execute(
    database,
    "DELETE FROM bookmarks WHERE report_id = ? AND user_id = ?",
    [reportId, userId],
  );
}

export async function isBookmarked(
  reportId: string,
  userId: string = "anonymous",
): Promise<boolean> {
  const database = await getDb();
  const result = queryOne<{ count: number }>(
    database,
    "SELECT COUNT(*) as count FROM bookmarks WHERE report_id = ? AND user_id = ?",
    [reportId, userId],
  );
  return (result?.count ?? 0) > 0;
}

// ============= Topics CRUD =============

/**
 * Get all topics ordered by name
 */
export async function getTopics(): Promise<Topic[]> {
  const database = await getDb();
  return queryRows<Topic>(
    database,
    "SELECT id, name, active, created_at, updated_at FROM topics ORDER BY name ASC",
  );
}

/**
 * Get active topics only
 */
export async function getActiveTopics(): Promise<Topic[]> {
  const database = await getDb();
  return queryRows<Topic>(
    database,
    "SELECT id, name, active, created_at, updated_at FROM topics WHERE active = 1 ORDER BY name ASC",
  );
}

/**
 * Get single topic by ID
 */
export async function getTopicById(id: string): Promise<Topic | undefined> {
  const database = await getDb();
  return queryOne<Topic>(
    database,
    "SELECT id, name, active, created_at, updated_at FROM topics WHERE id = ?",
    [id],
  );
}

/**
 * Get single topic by name
 */
export async function getTopicByName(name: string): Promise<Topic | undefined> {
  const database = await getDb();
  return queryOne<Topic>(
    database,
    "SELECT id, name, active, created_at, updated_at FROM topics WHERE name = ?",
    [name],
  );
}

/**
 * Create a new topic
 * @throws ConflictError if topic name already exists
 * @throws ValidationError if name is empty
 */
export async function createTopic(name: string): Promise<Topic> {
  if (!name || name.trim().length === 0) {
    throw new ValidationError("Topic name is required", "name");
  }

  const trimmedName = name.trim();
  const database = await getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  try {
    execute(
      database,
      "INSERT INTO topics (id, name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)",
      [id, trimmedName, now, now],
    );

    return {
      id,
      name: trimmedName,
      active: true,
      created_at: now,
      updated_at: now,
    };
  } catch (error: any) {
    if (error.message?.includes("UNIQUE")) {
      throw new ConflictError("Topic", trimmedName);
    }
    throw new DatabaseError("createTopic", error.message);
  }
}

/**
 * Update a topic
 * @throws NotFoundError if topic doesn't exist
 */
export async function updateTopic(
  id: string,
  name?: string,
  active?: boolean,
): Promise<Topic> {
  const existing = await getTopicById(id);

  if (!existing) {
    throw new NotFoundError("Topic", id);
  }

  const updatedName = name?.trim() ?? existing.name;
  const updatedActive = active ?? existing.active;
  const now = new Date().toISOString();

  const database = await getDb();

  try {
    execute(
      database,
      "UPDATE topics SET name = ?, active = ?, updated_at = ? WHERE id = ?",
      [updatedName, updatedActive ? 1 : 0, now, id],
    );
  } catch (error: any) {
    if (error.message?.includes("UNIQUE")) {
      throw new ConflictError("Topic", updatedName);
    }
    throw new DatabaseError("updateTopic", error.message);
  }

  return {
    id,
    name: updatedName,
    active: updatedActive,
    created_at: existing.created_at,
    updated_at: now,
  };
}

/**
 * Delete a topic and its associated reports
 * @throws NotFoundError if topic doesn't exist
 */
export async function deleteTopic(id: string): Promise<void> {
  const topic = await getTopicById(id);

  if (!topic) {
    throw new NotFoundError("Topic", id);
  }

  const database = await getDb();

  // Delete associated reports first (referential integrity)
  execute(database, "DELETE FROM reports WHERE topic = ?", [topic.name]);
  // Delete the topic
  execute(database, "DELETE FROM topics WHERE id = ?", [id]);
}

// ============= Reports CRUD =============

/**
 * Get all reports, paginated and sorted by date DESC
 * Supports optional topic filter, date range, and keyword search
 */
export async function getReports(
  limit: number = 50,
  offset: number = 0,
  topicFilter?: string,
  dateFrom?: string,
  dateTo?: string,
  search?: string,
): Promise<{ reports: Report[]; total: number }> {
  const database = await getDb();

  const conditions: string[] = [];
  const params: any[] = [];

  if (topicFilter) {
    conditions.push("topic = ?");
    params.push(topicFilter);
  }
  if (dateFrom) {
    conditions.push("created_at >= ?");
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push("created_at <= ?");
    params.push(dateTo);
  }
  if (search) {
    conditions.push(
      "(html_content LIKE ? OR markdown_content LIKE ? OR topic LIKE ?)",
    );
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  const whereClause =
    conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "";

  const countResult = queryOne<{ count: number }>(
    database,
    `SELECT COUNT(*) as count FROM reports${whereClause}`,
    params,
  );
  const total = countResult?.count ?? 0;

  const dataQuery = `SELECT id, topic, html_content, markdown_content, created_at FROM reports${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`;

  const reports = queryRows<Report>(database, dataQuery, [
    ...params,
    limit,
    offset,
  ]);

  return { reports, total };
}

/**
 * Get single report by ID
 */
export async function getReportById(id: string): Promise<Report | undefined> {
  const database = await getDb();
  return queryOne<Report>(
    database,
    "SELECT id, topic, html_content, markdown_content, created_at FROM reports WHERE id = ?",
    [id],
  );
}

/**
 * Get reports for a specific topic
 */
export async function getReportsByTopic(
  topic: string,
  limit: number = 20,
): Promise<Report[]> {
  const database = await getDb();
  return queryRows<Report>(
    database,
    "SELECT id, topic, html_content, markdown_content, created_at FROM reports WHERE topic = ? ORDER BY created_at DESC LIMIT ?",
    [topic, limit],
  );
}

/**
 * Save a new report
 * @throws ValidationError if required fields missing
 */
export async function saveReport(
  topic: string,
  htmlContent: string,
  markdownContent?: string,
): Promise<Report> {
  if (!topic || topic.trim().length === 0) {
    throw new ValidationError("Report topic is required", "topic");
  }
  if (!htmlContent || htmlContent.trim().length === 0) {
    throw new ValidationError(
      "Report HTML content is required",
      "html_content",
    );
  }

  const database = await getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  execute(
    database,
    "INSERT INTO reports (id, topic, html_content, markdown_content, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, topic.trim(), htmlContent, markdownContent || null, now],
  );

  return {
    id,
    topic: topic.trim(),
    html_content: htmlContent,
    markdown_content: markdownContent,
    created_at: now,
  };
}

/**
 * Delete a report
 * @throws NotFoundError if report doesn't exist
 */
export async function deleteReport(id: string): Promise<void> {
  const existing = await getReportById(id);
  if (!existing) {
    throw new NotFoundError("Report", id);
  }

  const database = await getDb();
  execute(database, "DELETE FROM reports WHERE id = ?", [id]);
}

/**
 * Clear all reports for a topic
 * @returns Number of deleted reports
 */
export async function clearTopicReports(topic: string): Promise<number> {
  const database = await getDb();

  const countResult = queryOne<{ count: number }>(
    database,
    "SELECT COUNT(*) as count FROM reports WHERE topic = ?",
    [topic],
  );
  const count = countResult?.count ?? 0;

  if (count > 0) {
    execute(database, "DELETE FROM reports WHERE topic = ?", [topic]);
  }

  return count;
}

// ============= Notifications CRUD =============

export async function getNotifications(
  userId: string = "anonymous",
  unreadOnly: boolean = false,
  limit: number = 50,
): Promise<Notification[]> {
  const database = await getDb();
  const readFilter = unreadOnly ? " AND read = 0" : "";
  return queryRows<Notification>(
    database,
    `SELECT id, report_id, user_id, type, title, message, read, created_at 
     FROM notifications 
     WHERE user_id = ?${readFilter} 
     ORDER BY created_at DESC 
     LIMIT ?`,
    [userId, limit],
  );
}

export async function getUnreadNotificationCount(
  userId: string = "anonymous",
): Promise<number> {
  const database = await getDb();
  const result = queryOne<{ count: number }>(
    database,
    "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0",
    [userId],
  );
  return result?.count ?? 0;
}

export async function createNotification(
  reportId: string | null,
  userId: string,
  type: "new_report" | "weekly_summary",
  title: string,
  message: string,
): Promise<Notification> {
  const database = await getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  execute(
    database,
    "INSERT INTO notifications (id, report_id, user_id, type, title, message, read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
    [id, reportId, userId, type, title, message, now],
  );

  return {
    id,
    report_id: reportId || "",
    user_id: userId,
    type,
    title,
    message,
    read: false,
    created_at: now,
  };
}

export async function markNotificationRead(id: string): Promise<void> {
  const database = await getDb();
  execute(database, "UPDATE notifications SET read = 1 WHERE id = ?", [id]);
}

export async function markAllNotificationsRead(
  userId: string = "anonymous",
): Promise<void> {
  const database = await getDb();
  execute(
    database,
    "UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0",
    [userId],
  );
}

export async function deleteOldNotifications(
  daysOld: number = 30,
): Promise<number> {
  const database = await getDb();
  const cutoff = new Date(
    Date.now() - daysOld * 24 * 60 * 60 * 1000,
  ).toISOString();
  const countResult = queryOne<{ count: number }>(
    database,
    "SELECT COUNT(*) as count FROM notifications WHERE created_at < ?",
    [cutoff],
  );
  const count = countResult?.count ?? 0;
  if (count > 0) {
    execute(database, "DELETE FROM notifications WHERE created_at < ?", [
      cutoff,
    ]);
  }
  return count;
}

// ============= Content Memory / Novelty Tracking =============

export async function getContentMemory(
  topic: string,
  limit: number = 100,
): Promise<ContentMemory[]> {
  const database = await getDb();
  return queryRows<ContentMemory>(
    database,
    `SELECT id, topic, content_hash, key_findings, source_urls, report_id, created_at 
     FROM content_memory 
     WHERE topic = ? 
     ORDER BY created_at DESC 
     LIMIT ?`,
    [topic, limit],
  );
}

export async function hasContentHash(
  topic: string,
  contentHash: string,
): Promise<boolean> {
  const database = await getDb();
  const result = queryOne<{ count: number }>(
    database,
    "SELECT COUNT(*) as count FROM content_memory WHERE topic = ? AND content_hash = ?",
    [topic, contentHash],
  );
  return (result?.count ?? 0) > 0;
}

export async function saveContentMemory(
  topic: string,
  contentHash: string,
  keyFindings: string[],
  sourceUrls: string[],
  reportId: string,
): Promise<ContentMemory> {
  const database = await getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  execute(
    database,
    "INSERT INTO content_memory (id, topic, content_hash, key_findings, source_urls, report_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      topic,
      contentHash,
      JSON.stringify(keyFindings),
      JSON.stringify(sourceUrls),
      reportId,
      now,
    ],
  );

  return {
    id,
    topic,
    content_hash: contentHash,
    key_findings: JSON.stringify(keyFindings),
    source_urls: JSON.stringify(sourceUrls),
    report_id: reportId,
    created_at: now,
  };
}

export async function getRecentSourceUrls(
  topic: string,
  daysBack: number = 7,
): Promise<string[]> {
  const database = await getDb();
  const cutoff = new Date(
    Date.now() - daysBack * 24 * 60 * 60 * 1000,
  ).toISOString();
  const rows = queryRows<{ source_urls: string }>(
    database,
    "SELECT source_urls FROM content_memory WHERE topic = ? AND created_at >= ?",
    [topic, cutoff],
  );

  const allUrls = new Set<string>();
  for (const row of rows) {
    try {
      const urls: string[] = JSON.parse(row.source_urls);
      urls.forEach((url) => allUrls.add(url));
    } catch {}
  }
  return Array.from(allUrls);
}

// ============= Weekly Summaries =============

export async function getWeeklySummaries(
  limit: number = 10,
): Promise<WeeklySummary[]> {
  const database = await getDb();
  return queryRows<WeeklySummary>(
    database,
    "SELECT id, week_start, week_end, html_content, topics_covered, created_at FROM weekly_summaries ORDER BY week_start DESC LIMIT ?",
    [limit],
  );
}

export async function getWeeklySummaryByWeek(
  weekStart: string,
): Promise<WeeklySummary | undefined> {
  const database = await getDb();
  return queryOne<WeeklySummary>(
    database,
    "SELECT id, week_start, week_end, html_content, topics_covered, created_at FROM weekly_summaries WHERE week_start = ?",
    [weekStart],
  );
}

export async function saveWeeklySummary(
  weekStart: string,
  weekEnd: string,
  htmlContent: string,
  topicsCovered: string[],
): Promise<WeeklySummary> {
  const database = await getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  execute(
    database,
    "INSERT INTO weekly_summaries (id, week_start, week_end, html_content, topics_covered, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, weekStart, weekEnd, htmlContent, JSON.stringify(topicsCovered), now],
  );

  return {
    id,
    week_start: weekStart,
    week_end: weekEnd,
    html_content: htmlContent,
    topics_covered: JSON.stringify(topicsCovered),
    created_at: now,
  };
}

export async function getWeeklySummaryById(
  id: string,
): Promise<WeeklySummary | undefined> {
  const database = await getDb();
  return queryOne<WeeklySummary>(
    database,
    "SELECT id, week_start, week_end, html_content, topics_covered, created_at FROM weekly_summaries WHERE id = ?",
    [id],
  );
}

export async function deleteWeeklySummary(id: string): Promise<boolean> {
  const database = await getDb();
  const summary = await getWeeklySummaryById(id);
  if (!summary) return false;
  execute(database, "DELETE FROM weekly_summaries WHERE id = ?", [id]);
  return true;
}

/**
 * Get database statistics
 */
export async function getDbStats(): Promise<{
  topicsCount: number;
  activeTopicsCount: number;
  reportsCount: number;
  oldestReport: string | null;
  newestReport: string | null;
}> {
  const database = await getDb();

  const topicsResult = queryOne<{ count: number }>(
    database,
    "SELECT COUNT(*) as count FROM topics",
  );
  const activeTopicsResult = queryOne<{ count: number }>(
    database,
    "SELECT COUNT(*) as count FROM topics WHERE active = 1",
  );
  const reportsResult = queryOne<{ count: number }>(
    database,
    "SELECT COUNT(*) as count FROM reports",
  );
  const oldestResult = queryOne<{ date: string | null }>(
    database,
    "SELECT MIN(created_at) as date FROM reports",
  );
  const newestResult = queryOne<{ date: string | null }>(
    database,
    "SELECT MAX(created_at) as date FROM reports",
  );

  return {
    topicsCount: topicsResult?.count ?? 0,
    activeTopicsCount: activeTopicsResult?.count ?? 0,
    reportsCount: reportsResult?.count ?? 0,
    oldestReport: oldestResult?.date ?? null,
    newestReport: newestResult?.date ?? null,
  };
}
