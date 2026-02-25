import { Hono } from "hono";
import type { Context } from "hono";
import { authRouter } from "./web/routes/auth.js";
import { apiRouter } from "./web/routes/api.js";
import {
  authMiddleware,
  initializeOIDC,
  requireAuth,
  isOIDCEnabled,
} from "./web/middleware/auth.js";
import { getDb, getDbStats } from "./db.js";
import { formatErrorResponse, getErrorStatusCode } from "./utils/errors.js";

/**
 * Main Hono Web Server
 * Integrates OIDC authentication, API routes, and dashboard frontend
 */

const app = new Hono<any>();

// ============= Public Routes (no auth) =============

/**
 * GET /health - Health check endpoint
 * Must be before auth middleware so it's always accessible
 */
app.get("/health", async (c: Context<any>) => {
  try {
    const stats = await getDbStats();
    return c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      database: {
        topics: stats.topicsCount,
        reports: stats.reportsCount,
      },
      oidc: isOIDCEnabled(),
    });
  } catch {
    return c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  }
});

// ============= Auth Middleware (applies to everything below) =============

app.use("*", authMiddleware);

// ============= Root Redirect =============

app.get("/", (c: Context<any>) => {
  const isAuthenticated = c.get("isAuthenticated") || false;
  if (isAuthenticated || !isOIDCEnabled()) {
    return c.redirect("/dashboard");
  }
  return c.redirect("/auth/login");
});

// ============= Auth Routes =============

app.route("/auth", authRouter);

// ============= Dashboard =============

/**
 * GET /dashboard - Serve dashboard HTML
 * When OIDC is disabled (dev mode), accessible without auth
 */
app.get("/dashboard", async (c: Context<any>) => {
  const isAuthenticated = c.get("isAuthenticated") || false;

  // Require auth only when OIDC is enabled
  if (!isAuthenticated && isOIDCEnabled()) {
    return c.redirect("/auth/login");
  }

  // Serve the dashboard HTML file directly
  try {
    const dashboardPath = import.meta.dirname + "/web/public/dashboard.html";
    const file = Bun.file(dashboardPath);
    const content = await file.text();
    return c.html(content);
  } catch (error) {
    console.error("[Web] Failed to serve dashboard:", error);
    return c.text("Dashboard not found", 404);
  }
});

// ============= API Routes =============

app.route("/api", apiRouter);

// ============= Stats Endpoint =============

app.get("/api/stats", async (c: Context<any>) => {
  if (isOIDCEnabled() && !requireAuth(c)) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  try {
    const stats = await getDbStats();
    return c.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] Stats error:", error);
    return c.json(formatErrorResponse(error), getErrorStatusCode(error));
  }
});

// ============= Error Handling =============

app.notFound((c: Context<any>) => {
  return c.json(
    {
      success: false,
      error: "Not Found",
      path: c.req.path,
      timestamp: new Date().toISOString(),
    },
    404,
  );
});

app.onError((err, c: Context<any>) => {
  console.error("[Web] Application error:", err);
  return c.json(formatErrorResponse(err), getErrorStatusCode(err));
});

// ============= Server Initialization =============

/**
 * Start the Hono web server
 */
export async function startWebServer(): Promise<void> {
  try {
    // Initialize database
    console.log("[Web] Initializing database...");
    await getDb();

    // Initialize OIDC (non-blocking - reports warning if not configured)
    console.log("[Web] Initializing OIDC...");
    await initializeOIDC();

    const port = parseInt(process.env.PORT || "3000", 10);

    console.log(`[Web] Starting server on http://localhost:${port}`);

    Bun.serve({
      port,
      fetch: app.fetch,
      error: (error: Error) => {
        console.error("[Web] Server error:", error);
        return new Response("Internal Server Error", { status: 500 });
      },
    });

    console.log(
      `[Web] Server started - Dashboard: http://localhost:${port}/dashboard`,
    );
  } catch (error) {
    console.error("[Web] Failed to start server:", error);
    process.exit(1);
  }
}

// Start server if this is the main module
if (import.meta.main) {
  startWebServer().catch((error) => {
    console.error("[Web] Startup error:", error);
    process.exit(1);
  });
}

export { app };
