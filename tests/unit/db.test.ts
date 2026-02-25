import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  getDb,
  resetDb,
  createTopic,
  getTopics,
  getActiveTopics,
  getTopicById,
  getTopicByName,
  updateTopic,
  deleteTopic,
  saveReport,
  getReportById,
  getReports,
  getReportsByTopic,
  deleteReport,
  clearTopicReports,
  getDbStats,
} from "../../src/db.js";
import type { Topic, Report } from "../../src/types.js";
import {
  NotFoundError,
  ConflictError,
  ValidationError,
} from "../../src/utils/errors.js";

/**
 * Unit Tests for Database Layer
 * Uses in-memory SQLite for isolation between test suites
 */

describe("Database - Topics CRUD", () => {
  beforeEach(async () => {
    process.env.DATABASE_PATH = ":memory:";
    resetDb();
    await getDb();
  });

  afterEach(() => {
    resetDb();
  });

  it("should create a topic with all fields", async () => {
    const topic = await createTopic("Test Topic");

    expect(topic.name).toBe("Test Topic");
    expect(topic.active).toBe(true);
    expect(topic.id).toBeTruthy();
    expect(topic.id.length).toBe(36); // UUID format
    expect(topic.created_at).toBeTruthy();
    expect(topic.updated_at).toBeTruthy();
  });

  it("should trim topic name whitespace", async () => {
    const topic = await createTopic("  Padded Name  ");
    expect(topic.name).toBe("Padded Name");
  });

  it("should throw ValidationError for empty name", async () => {
    await expect(createTopic("")).rejects.toThrow(ValidationError);
    await expect(createTopic("   ")).rejects.toThrow(ValidationError);
  });

  it("should throw ConflictError for duplicate name", async () => {
    await createTopic("Unique Topic");
    await expect(createTopic("Unique Topic")).rejects.toThrow(ConflictError);
  });

  it("should retrieve all topics sorted by name", async () => {
    await createTopic("Zebra Topic");
    await createTopic("Alpha Topic");
    await createTopic("Middle Topic");

    const topics = await getTopics();

    expect(topics.length).toBe(3);
    expect(topics[0].name).toBe("Alpha Topic");
    expect(topics[1].name).toBe("Middle Topic");
    expect(topics[2].name).toBe("Zebra Topic");
  });

  it("should get only active topics", async () => {
    const t1 = await createTopic("Active 1");
    const t2 = await createTopic("Active 2");
    const t3 = await createTopic("Will Disable");
    await updateTopic(t3.id, undefined, false);

    const active = await getActiveTopics();

    expect(active.length).toBe(2);
    expect(
      active.every((t: Topic) => t.active === true || t.active === 1),
    ).toBe(true);
  });

  it("should get topic by ID", async () => {
    const created = await createTopic("Find Me");
    const found = await getTopicById(created.id);

    expect(found).toBeDefined();
    expect(found?.name).toBe("Find Me");
    expect(found?.id).toBe(created.id);
  });

  it("should return undefined for non-existent ID", async () => {
    const found = await getTopicById("nonexistent-uuid");
    expect(found).toBeUndefined();
  });

  it("should get topic by name", async () => {
    await createTopic("Search By Name");
    const found = await getTopicByName("Search By Name");

    expect(found).toBeDefined();
    expect(found?.name).toBe("Search By Name");
  });

  it("should update topic name", async () => {
    const created = await createTopic("Original");
    // Ensure at least 1ms passes so updated_at differs
    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = await updateTopic(created.id, "Renamed", undefined);

    expect(updated.name).toBe("Renamed");
    expect(updated.id).toBe(created.id);
    expect(updated.updated_at).not.toBe(created.updated_at);
  });

  it("should toggle topic active status", async () => {
    const created = await createTopic("Toggle Test");
    expect(created.active).toBe(true);

    const disabled = await updateTopic(created.id, undefined, false);
    expect(disabled.active).toBe(false);

    const enabled = await updateTopic(created.id, undefined, true);
    expect(enabled.active).toBe(true);
  });

  it("should throw NotFoundError when updating non-existent topic", async () => {
    await expect(updateTopic("nonexistent-uuid", "Name")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("should delete a topic", async () => {
    const created = await createTopic("To Delete");
    await deleteTopic(created.id);

    const found = await getTopicById(created.id);
    expect(found).toBeUndefined();
  });

  it("should delete associated reports when deleting topic", async () => {
    const topic = await createTopic("Topic With Reports");
    const report = await saveReport(topic.name, "<p>Report</p>");

    await deleteTopic(topic.id);

    const foundReport = await getReportById(report.id);
    expect(foundReport).toBeUndefined();
  });

  it("should throw NotFoundError when deleting non-existent topic", async () => {
    await expect(deleteTopic("nonexistent-uuid")).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe("Database - Reports CRUD", () => {
  beforeEach(async () => {
    process.env.DATABASE_PATH = ":memory:";
    resetDb();
    await getDb();
  });

  afterEach(() => {
    resetDb();
  });

  it("should save a report with all fields", async () => {
    const report = await saveReport(
      "Test Topic",
      "<div>HTML Content</div>",
      "# Markdown Content",
    );

    expect(report.id).toBeTruthy();
    expect(report.topic).toBe("Test Topic");
    expect(report.html_content).toBe("<div>HTML Content</div>");
    expect(report.markdown_content).toBe("# Markdown Content");
    expect(report.created_at).toBeTruthy();
  });

  it("should save report without markdown", async () => {
    const report = await saveReport("Topic", "<p>HTML only</p>");

    expect(report.html_content).toBe("<p>HTML only</p>");
    expect(report.markdown_content).toBeUndefined();
  });

  it("should throw ValidationError for empty topic", async () => {
    await expect(saveReport("", "<p>Content</p>")).rejects.toThrow(
      ValidationError,
    );
  });

  it("should throw ValidationError for empty HTML content", async () => {
    await expect(saveReport("Topic", "")).rejects.toThrow(ValidationError);
  });

  it("should retrieve report by ID", async () => {
    const saved = await saveReport("Test", "<p>Content</p>");
    const retrieved = await getReportById(saved.id);

    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(saved.id);
    expect(retrieved?.html_content).toBe("<p>Content</p>");
  });

  it("should return undefined for non-existent report ID", async () => {
    const report = await getReportById("nonexistent-id");
    expect(report).toBeUndefined();
  });

  it("should get paginated reports sorted by date DESC", async () => {
    // Create reports with slight delay for ordering
    await saveReport("Topic A", "<p>First</p>");
    await saveReport("Topic B", "<p>Second</p>");
    await saveReport("Topic C", "<p>Third</p>");

    const { reports, total } = await getReports(2, 0);

    expect(total).toBe(3);
    expect(reports.length).toBe(2);
    // Most recent first
    expect(reports[0].topic).toBe("Topic C");
    expect(reports[1].topic).toBe("Topic B");
  });

  it("should filter reports by topic", async () => {
    await saveReport("Topic A", "<p>A1</p>");
    await saveReport("Topic A", "<p>A2</p>");
    await saveReport("Topic B", "<p>B1</p>");

    const { reports, total } = await getReports(50, 0, "Topic A");

    expect(total).toBe(2);
    expect(reports.length).toBe(2);
    expect(reports.every((r: Report) => r.topic === "Topic A")).toBe(true);
  });

  it("should get reports by topic", async () => {
    await saveReport("Specific Topic", "<p>R1</p>");
    await saveReport("Specific Topic", "<p>R2</p>");
    await saveReport("Other Topic", "<p>R3</p>");

    const reports = await getReportsByTopic("Specific Topic");

    expect(reports.length).toBe(2);
    expect(reports.every((r: Report) => r.topic === "Specific Topic")).toBe(
      true,
    );
  });

  it("should delete a report", async () => {
    const saved = await saveReport("Topic", "<p>To delete</p>");
    await deleteReport(saved.id);

    const found = await getReportById(saved.id);
    expect(found).toBeUndefined();
  });

  it("should throw NotFoundError when deleting non-existent report", async () => {
    await expect(deleteReport("nonexistent-id")).rejects.toThrow(NotFoundError);
  });

  it("should clear all reports for a topic", async () => {
    await saveReport("Clear Me", "<p>R1</p>");
    await saveReport("Clear Me", "<p>R2</p>");
    await saveReport("Keep Me", "<p>R3</p>");

    const deleted = await clearTopicReports("Clear Me");

    expect(deleted).toBe(2);

    const remaining = await getReportsByTopic("Clear Me");
    expect(remaining.length).toBe(0);

    const kept = await getReportsByTopic("Keep Me");
    expect(kept.length).toBe(1);
  });
});

describe("Database - Statistics", () => {
  beforeEach(async () => {
    process.env.DATABASE_PATH = ":memory:";
    resetDb();
    await getDb();
  });

  afterEach(() => {
    resetDb();
  });

  it("should return zero stats for empty database", async () => {
    const stats = await getDbStats();

    expect(stats.topicsCount).toBe(0);
    expect(stats.activeTopicsCount).toBe(0);
    expect(stats.reportsCount).toBe(0);
    expect(stats.oldestReport).toBeNull();
    expect(stats.newestReport).toBeNull();
  });

  it("should return correct stats with data", async () => {
    const t1 = await createTopic("Active Topic");
    const t2 = await createTopic("Inactive Topic");
    await updateTopic(t2.id, undefined, false);

    await saveReport("Active Topic", "<p>Report 1</p>");
    await saveReport("Active Topic", "<p>Report 2</p>");

    const stats = await getDbStats();

    expect(stats.topicsCount).toBe(2);
    expect(stats.activeTopicsCount).toBe(1);
    expect(stats.reportsCount).toBe(2);
    expect(stats.oldestReport).toBeTruthy();
    expect(stats.newestReport).toBeTruthy();
  });
});
