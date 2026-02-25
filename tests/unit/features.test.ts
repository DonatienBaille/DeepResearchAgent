import { describe, it, expect, beforeEach } from "bun:test";
import {
  resetDb,
  getDb,
  createTopic,
  createCategory,
  getCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
  addTopicCategory,
  removeTopicCategory,
  getTopicCategories,
  getTopicsByCategory,
  saveReport,
  addBookmark,
  removeBookmark,
  getBookmarks,
  isBookmarked,
  createNotification,
  getNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteOldNotifications,
  saveContentMemory,
  getContentMemory,
  hasContentHash,
  getRecentSourceUrls,
  saveWeeklySummary,
  getWeeklySummaries,
  getWeeklySummaryByWeek,
} from "../../src/db.js";

beforeEach(async () => {
  process.env.DATABASE_PATH = ":memory:";
  resetDb();
  await getDb();
});

// ============= Categories =============

describe("Categories CRUD", () => {
  it("should create a category", async () => {
    const cat = await createCategory("Security", "#e74c3c");
    expect(cat.name).toBe("Security");
    expect(cat.color).toBe("#e74c3c");
    expect(cat.id).toBeDefined();
  });

  it("should get all categories", async () => {
    await createCategory("Security");
    await createCategory("AI");
    const cats = await getCategories();
    expect(cats.length).toBe(2);
  });

  it("should get category by ID", async () => {
    const cat = await createCategory("DevOps");
    const found = await getCategoryById(cat.id);
    expect(found?.name).toBe("DevOps");
  });

  it("should update a category", async () => {
    const cat = await createCategory("Old Name");
    const updated = await updateCategory(cat.id, "New Name", "#ff0000");
    expect(updated.name).toBe("New Name");
    expect(updated.color).toBe("#ff0000");
  });

  it("should delete a category", async () => {
    const cat = await createCategory("ToDelete");
    await deleteCategory(cat.id);
    const found = await getCategoryById(cat.id);
    expect(found).toBeUndefined();
  });

  it("should reject duplicate category names", async () => {
    await createCategory("Unique");
    expect(createCategory("Unique")).rejects.toThrow();
  });

  it("should reject empty category name", async () => {
    expect(createCategory("")).rejects.toThrow();
  });
});

describe("Topic-Category associations", () => {
  it("should associate a topic with a category", async () => {
    const topic = await createTopic("TypeScript");
    const cat = await createCategory("Languages");
    await addTopicCategory(topic.id, cat.id);
    
    const cats = await getTopicCategories(topic.id);
    expect(cats.length).toBe(1);
    expect(cats[0].name).toBe("Languages");
  });

  it("should get topics by category", async () => {
    const topic1 = await createTopic("TypeScript");
    const topic2 = await createTopic("Rust");
    const cat = await createCategory("Languages");
    await addTopicCategory(topic1.id, cat.id);
    await addTopicCategory(topic2.id, cat.id);
    
    const topics = await getTopicsByCategory(cat.id);
    expect(topics.length).toBe(2);
  });

  it("should remove a topic-category association", async () => {
    const topic = await createTopic("Go");
    const cat = await createCategory("Backend");
    await addTopicCategory(topic.id, cat.id);
    await removeTopicCategory(topic.id, cat.id);
    
    const cats = await getTopicCategories(topic.id);
    expect(cats.length).toBe(0);
  });

  it("should handle multiple categories per topic", async () => {
    const topic = await createTopic("Kubernetes");
    const cat1 = await createCategory("DevOps");
    const cat2 = await createCategory("Cloud");
    await addTopicCategory(topic.id, cat1.id);
    await addTopicCategory(topic.id, cat2.id);
    
    const cats = await getTopicCategories(topic.id);
    expect(cats.length).toBe(2);
  });
});

// ============= Bookmarks =============

describe("Bookmarks CRUD", () => {
  it("should add a bookmark", async () => {
    const report = await saveReport("Test Topic", "<p>Test content</p>");
    const bookmark = await addBookmark(report.id);
    expect(bookmark.report_id).toBe(report.id);
    expect(bookmark.user_id).toBe("anonymous");
  });

  it("should check if report is bookmarked", async () => {
    const report = await saveReport("Test", "<p>Content</p>");
    expect(await isBookmarked(report.id)).toBe(false);
    
    await addBookmark(report.id);
    expect(await isBookmarked(report.id)).toBe(true);
  });

  it("should remove a bookmark", async () => {
    const report = await saveReport("Test", "<p>Content</p>");
    await addBookmark(report.id);
    await removeBookmark(report.id);
    expect(await isBookmarked(report.id)).toBe(false);
  });

  it("should get all bookmarks with report data", async () => {
    const report1 = await saveReport("Topic1", "<p>Content 1</p>");
    const report2 = await saveReport("Topic2", "<p>Content 2</p>");
    await addBookmark(report1.id);
    await addBookmark(report2.id);
    
    const bookmarks = await getBookmarks();
    expect(bookmarks.length).toBe(2);
    expect(bookmarks[0].report).toBeDefined();
  });

  it("should reject duplicate bookmarks", async () => {
    const report = await saveReport("Test", "<p>Content</p>");
    await addBookmark(report.id);
    expect(addBookmark(report.id)).rejects.toThrow();
  });

  it("should reject bookmark for non-existent report", async () => {
    expect(addBookmark("non-existent-id")).rejects.toThrow();
  });
});

// ============= Notifications =============

describe("Notifications CRUD", () => {
  it("should create a notification", async () => {
    const notif = await createNotification(null, "user1", "new_report", "New Report", "A new report is available");
    expect(notif.title).toBe("New Report");
    expect(notif.read).toBe(false);
  });

  it("should get notifications for a user", async () => {
    await createNotification(null, "user1", "new_report", "Title 1", "Message 1");
    await createNotification(null, "user1", "new_report", "Title 2", "Message 2");
    await createNotification(null, "user2", "new_report", "Title 3", "Message 3");
    
    const user1Notifs = await getNotifications("user1");
    expect(user1Notifs.length).toBe(2);
  });

  it("should get unread count", async () => {
    await createNotification(null, "user1", "new_report", "T1", "M1");
    await createNotification(null, "user1", "new_report", "T2", "M2");
    
    const count = await getUnreadNotificationCount("user1");
    expect(count).toBe(2);
  });

  it("should mark notification as read", async () => {
    const notif = await createNotification(null, "user1", "new_report", "T", "M");
    await markNotificationRead(notif.id);
    
    const count = await getUnreadNotificationCount("user1");
    expect(count).toBe(0);
  });

  it("should mark all notifications as read", async () => {
    await createNotification(null, "user1", "new_report", "T1", "M1");
    await createNotification(null, "user1", "new_report", "T2", "M2");
    await markAllNotificationsRead("user1");
    
    const count = await getUnreadNotificationCount("user1");
    expect(count).toBe(0);
  });

  it("should filter unread only", async () => {
    const n1 = await createNotification(null, "user1", "new_report", "T1", "M1");
    await createNotification(null, "user1", "new_report", "T2", "M2");
    await markNotificationRead(n1.id);
    
    const unread = await getNotifications("user1", true);
    expect(unread.length).toBe(1);
  });

  it("should delete old notifications", async () => {
    await createNotification(null, "user1", "new_report", "Old", "Old notification");
    // This should not delete since it's brand new
    const deleted = await deleteOldNotifications(30);
    expect(deleted).toBe(0);
  });
});

// ============= Content Memory =============

describe("Content Memory", () => {
  it("should save content memory", async () => {
    const report = await saveReport("AI", "<p>AI content</p>");
    await saveContentMemory("AI", "hash123", ["finding1"], ["https://example.com"], report.id);
    
    const memory = await getContentMemory("AI");
    expect(memory.length).toBe(1);
    expect(memory[0].content_hash).toBe("hash123");
  });

  it("should check content hash existence", async () => {
    const report = await saveReport("AI", "<p>Content</p>");
    await saveContentMemory("AI", "unique-hash", ["f1"], ["url1"], report.id);
    
    expect(await hasContentHash("AI", "unique-hash")).toBe(true);
    expect(await hasContentHash("AI", "other-hash")).toBe(false);
  });

  it("should get recent source URLs", async () => {
    const report = await saveReport("AI", "<p>Content</p>");
    await saveContentMemory("AI", "h1", ["f1"], ["https://a.com", "https://b.com"], report.id);
    
    const urls = await getRecentSourceUrls("AI", 7);
    expect(urls).toContain("https://a.com");
    expect(urls).toContain("https://b.com");
  });

  it("should isolate content memory by topic", async () => {
    const r1 = await saveReport("AI", "<p>AI content</p>");
    const r2 = await saveReport("Security", "<p>Sec content</p>");
    await saveContentMemory("AI", "h1", ["f1"], [], r1.id);
    await saveContentMemory("Security", "h2", ["f2"], [], r2.id);
    
    const aiMemory = await getContentMemory("AI");
    expect(aiMemory.length).toBe(1);
    expect(aiMemory[0].topic).toBe("AI");
  });
});

// ============= Weekly Summaries =============

describe("Weekly Summaries", () => {
  it("should save a weekly summary", async () => {
    const summary = await saveWeeklySummary("2026-02-23", "2026-03-01", "<h2>Summary</h2>", ["AI", "Security"]);
    expect(summary.week_start).toBe("2026-02-23");
    expect(summary.html_content).toContain("Summary");
  });

  it("should get weekly summaries", async () => {
    await saveWeeklySummary("2026-02-16", "2026-02-22", "<p>Week 1</p>", ["AI"]);
    await saveWeeklySummary("2026-02-23", "2026-03-01", "<p>Week 2</p>", ["AI", "Security"]);
    
    const summaries = await getWeeklySummaries();
    expect(summaries.length).toBe(2);
  });

  it("should get summary by week", async () => {
    await saveWeeklySummary("2026-02-23", "2026-03-01", "<p>Test</p>", ["AI"]);
    
    const found = await getWeeklySummaryByWeek("2026-02-23");
    expect(found).toBeDefined();
    expect(found?.week_start).toBe("2026-02-23");
  });

  it("should return undefined for missing week", async () => {
    const found = await getWeeklySummaryByWeek("2020-01-01");
    expect(found).toBeUndefined();
  });
});
