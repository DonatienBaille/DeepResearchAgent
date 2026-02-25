import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { getDb, resetDb, createTopic, saveReport } from "../../src/db.js";

/**
 * Integration Tests for API Routes
 * Tests full HTTP request/response cycle using Hono test client
 */

// Create a test app that mirrors the real API routes but without OIDC
async function createTestApp() {
  const { apiRouter } = await import("../../src/web/routes/api.js");

  const app = new Hono<any>();

  // Mock auth middleware: always authenticated in tests
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("user", {
      sub: "test-user",
      email: "test@example.com",
      name: "Test User",
    });
    return next();
  });

  app.route("/api", apiRouter);
  return app;
}

describe("API Integration - Topics", () => {
  let app: Hono<any>;

  beforeEach(async () => {
    process.env.DATABASE_PATH = ":memory:";
    resetDb();
    await getDb();
    app = await createTestApp();
  });

  afterEach(() => {
    resetDb();
  });

  it("GET /api/topics should return empty array initially", async () => {
    const res = await app.request("/api/topics");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it("POST /api/topics should create a topic", async () => {
    const res = await app.request("/api/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Topic" }),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.name).toBe("Test Topic");
    expect(body.data.active).toBe(true);
    expect(body.data.id).toBeTruthy();
  });

  it("POST /api/topics should return 400 for empty name", async () => {
    const res = await app.request("/api/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("POST /api/topics should return 409 for duplicate", async () => {
    await createTopic("Duplicate");

    const res = await app.request("/api/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Duplicate" }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("GET /api/topics/:id should return a topic", async () => {
    const topic = await createTopic("Find Me");

    const res = await app.request(`/api/topics/${topic.id}`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.name).toBe("Find Me");
  });

  it("GET /api/topics/:id should return 404 for missing", async () => {
    const res = await app.request("/api/topics/nonexistent");
    expect(res.status).toBe(404);
  });

  it("PATCH /api/topics/:id should update topic", async () => {
    const topic = await createTopic("Original");

    const res = await app.request(`/api/topics/${topic.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated", active: false }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.name).toBe("Updated");
    expect(body.data.active).toBe(false);
  });

  it("DELETE /api/topics/:id should delete topic", async () => {
    const topic = await createTopic("To Delete");

    const res = await app.request(`/api/topics/${topic.id}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);

    // Verify deleted
    const check = await app.request(`/api/topics/${topic.id}`);
    expect(check.status).toBe(404);
  });

  it("GET /api/topics/active should return only active topics", async () => {
    const t1 = await createTopic("Active");
    const t2 = await createTopic("Inactive");

    // Disable t2
    await app.request(`/api/topics/${t2.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: false }),
    });

    const res = await app.request("/api/topics/active");
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("Active");
  });
});

describe("API Integration - Reports", () => {
  let app: Hono<any>;

  beforeEach(async () => {
    process.env.DATABASE_PATH = ":memory:";
    resetDb();
    await getDb();
    app = await createTestApp();
  });

  afterEach(() => {
    resetDb();
  });

  it("GET /api/reports should return empty results initially", async () => {
    const res = await app.request("/api/reports");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.items).toEqual([]);
    expect(body.data.total).toBe(0);
    expect(body.data.hasMore).toBe(false);
  });

  it("GET /api/reports should return paginated results", async () => {
    // Create some reports
    for (let i = 0; i < 5; i++) {
      await saveReport(`Topic ${i}`, `<p>Report ${i}</p>`);
    }

    const res = await app.request("/api/reports?page=1&limit=2");
    const body = await res.json();

    expect(body.data.items.length).toBe(2);
    expect(body.data.total).toBe(5);
    expect(body.data.hasMore).toBe(true);
    expect(body.data.page).toBe(1);
  });

  it("GET /api/reports should filter by topic", async () => {
    await saveReport("Topic A", "<p>A</p>");
    await saveReport("Topic B", "<p>B</p>");
    await saveReport("Topic A", "<p>A2</p>");

    const res = await app.request("/api/reports?topic=Topic%20A");
    const body = await res.json();

    expect(body.data.total).toBe(2);
    expect(body.data.items.every((r: any) => r.topic === "Topic A")).toBe(true);
  });

  it("GET /api/reports/:id should return a report", async () => {
    const report = await saveReport("Test", "<p>Content</p>", "# MD");

    const res = await app.request(`/api/reports/${report.id}`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.html_content).toBe("<p>Content</p>");
    expect(body.data.markdown_content).toBe("# MD");
  });

  it("GET /api/reports/:id should return 404 for missing", async () => {
    const res = await app.request("/api/reports/nonexistent");
    expect(res.status).toBe(404);
  });

  it("DELETE /api/reports/:id should delete a report", async () => {
    const report = await saveReport("Test", "<p>Delete me</p>");

    const res = await app.request(`/api/reports/${report.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const check = await app.request(`/api/reports/${report.id}`);
    expect(check.status).toBe(404);
  });

  it("GET /api/topics/:name/reports should return topic reports", async () => {
    await saveReport("TypeScript", "<p>TS Report 1</p>");
    await saveReport("TypeScript", "<p>TS Report 2</p>");
    await saveReport("Python", "<p>PY Report</p>");

    const res = await app.request("/api/topics/TypeScript/reports");
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.length).toBe(2);
  });
});

describe("API Integration - Full Workflow", () => {
  let app: Hono<any>;

  beforeEach(async () => {
    process.env.DATABASE_PATH = ":memory:";
    resetDb();
    await getDb();
    app = await createTestApp();
  });

  afterEach(() => {
    resetDb();
  });

  it("should complete full topic → report → query workflow", async () => {
    // 1. Create a topic
    const createRes = await app.request("/api/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "AI Agents" }),
    });
    expect(createRes.status).toBe(201);
    const topic = (await createRes.json()).data;

    // 2. Simulate saving a report for this topic
    const report = await saveReport(
      topic.name,
      "<div class='report-item'><p>AI agents are evolving...</p></div>",
    );

    // 3. Verify topic has reports
    const reportsRes = await app.request(
      `/api/topics/${encodeURIComponent(topic.name)}/reports`,
    );
    const reportsBody = await reportsRes.json();
    expect(reportsBody.data.length).toBe(1);
    expect(reportsBody.data[0].topic).toBe("AI Agents");

    // 4. Delete topic (should also delete reports)
    const deleteRes = await app.request(`/api/topics/${topic.id}`, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);

    // 5. Verify reports are gone too
    const checkReports = await app.request(`/api/reports/${report.id}`);
    expect(checkReports.status).toBe(404);
  });
});
