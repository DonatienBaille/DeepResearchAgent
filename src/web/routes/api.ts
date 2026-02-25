import { Hono } from "hono";
import type { Context } from "hono";
import {
  getTopics,
  getActiveTopics,
  getTopicById,
  createTopic,
  updateTopic,
  deleteTopic,
  getReports,
  getReportById,
  getReportsByTopic,
  deleteReport,
  clearTopicReports,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  addTopicCategory,
  removeTopicCategory,
  getTopicCategories,
  getBookmarks,
  addBookmark,
  removeBookmark,
  isBookmarked,
  getNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  getWeeklySummaries,
  getWeeklySummaryById,
  deleteWeeklySummary,
} from "../../db.js";
import { requireAuth, isOIDCEnabled } from "../middleware/auth.js";
import { getPipelineStatus, triggerManualRun, triggerManualSummary } from "../../pipeline.js";
import {
  AppError,
  formatErrorResponse,
  getErrorStatusCode,
} from "../../utils/errors.js";
import type {
  ApiResponse,
  PaginatedResponse,
  Report,
  Topic,
  Category,
} from "../../types.js";

/**
 * API Routes: Reports and Topics management
 * All write endpoints require auth when OIDC is enabled
 * Read endpoints are public when OIDC is disabled (dev mode)
 */

export const apiRouter = new Hono<any>();

// ============= Auth Helper =============

/**
 * Check auth requirement (only enforced when OIDC is enabled)
 */
function checkAuth(c: Context<any>): boolean {
  if (!isOIDCEnabled()) return true; // Dev mode: skip auth
  return requireAuth(c);
}

/**
 * Return 401 response
 */
function unauthorizedResponse(c: Context<any>) {
  return c.json<ApiResponse<null>>(
    {
      success: false,
      error: "Unauthorized",
      timestamp: new Date().toISOString(),
    },
    401,
  );
}

// ============= Topics Endpoints =============

/**
 * GET /api/topics - Get all topics
 */
apiRouter.get("/topics", async (c: Context<any>) => {
  try {
    const topics = await getTopics();
    
    // Fetch categories for each topic
    const topicsWithCategories = await Promise.all(
      topics.map(async (topic) => {
        const categories = await getTopicCategories(topic.id);
        return { ...topic, categories };
      })
    );

    return c.json<ApiResponse<Topic[]>>({
      success: true,
      data: topicsWithCategories,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] GetTopics error:", error);
    return c.json(formatErrorResponse(error), getErrorStatusCode(error));
  }
});

/**
 * GET /api/topics/active - Get only active topics
 */
apiRouter.get("/topics/active", async (c: Context<any>) => {
  try {
    const topics = await getActiveTopics();
    
    // Fetch categories for each topic
    const topicsWithCategories = await Promise.all(
      topics.map(async (topic) => {
        const categories = await getTopicCategories(topic.id);
        return { ...topic, categories };
      })
    );

    return c.json<ApiResponse<Topic[]>>({
      success: true,
      data: topicsWithCategories,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] GetActiveTopics error:", error);
    return c.json(formatErrorResponse(error), getErrorStatusCode(error));
  }
});

/**
 * GET /api/topics/:id - Get single topic
 */
apiRouter.get("/topics/:id", async (c: Context<any>) => {
  try {
    const id = c.req.param("id");
    const topic = await getTopicById(id);

    if (!topic) {
      return c.json<ApiResponse<null>>(
        {
          success: false,
          error: "Topic not found",
          timestamp: new Date().toISOString(),
        },
        404,
      );
    }

    const categories = await getTopicCategories(topic.id);

    return c.json<ApiResponse<Topic>>({
      success: true,
      data: { ...topic, categories },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] GetTopic error:", error);
    return c.json(formatErrorResponse(error), getErrorStatusCode(error));
  }
});

/**
 * POST /api/topics - Create new topic (requires auth)
 */
apiRouter.post("/topics", async (c: Context<any>) => {
  if (!checkAuth(c)) return unauthorizedResponse(c);

  try {
    const body = await c.req.json<{ name: string }>();

    if (!body.name || body.name.trim().length === 0) {
      return c.json<ApiResponse<null>>(
        {
          success: false,
          error: "Topic name is required",
          timestamp: new Date().toISOString(),
        },
        400,
      );
    }

    const newTopic = await createTopic(body.name);

    return c.json<ApiResponse<Topic>>(
      {
        success: true,
        data: newTopic,
        timestamp: new Date().toISOString(),
      },
      201,
    );
  } catch (error: any) {
    console.error("[API] CreateTopic error:", error);

    if (error instanceof AppError) {
      return c.json(formatErrorResponse(error), error.statusCode);
    }

    return c.json(formatErrorResponse(error), 500);
  }
});

/**
 * PATCH /api/topics/:id - Update topic (requires auth)
 */
apiRouter.patch("/topics/:id", async (c: Context<any>) => {
  if (!checkAuth(c)) return unauthorizedResponse(c);

  try {
    const id = c.req.param("id");
    const body = await c.req.json<{ name?: string; active?: boolean }>();

    const updated = await updateTopic(id, body.name, body.active);

    return c.json<ApiResponse<Topic>>({
      success: true,
      data: updated,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[API] UpdateTopic error:", error);

    if (error instanceof AppError) {
      return c.json(formatErrorResponse(error), error.statusCode);
    }

    return c.json(formatErrorResponse(error), 500);
  }
});

/**
 * DELETE /api/topics/:id - Delete topic and its reports (requires auth)
 */
apiRouter.delete("/topics/:id", async (c: Context<any>) => {
  if (!checkAuth(c)) return unauthorizedResponse(c);

  try {
    const id = c.req.param("id");
    await deleteTopic(id);

    return c.json<ApiResponse<null>>({
      success: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[API] DeleteTopic error:", error);

    if (error instanceof AppError) {
      return c.json(formatErrorResponse(error), error.statusCode);
    }

    return c.json(formatErrorResponse(error), 500);
  }
});

// ============= Reports Endpoints =============

/**
 * GET /api/reports - Get paginated reports
 */
apiRouter.get("/reports", async (c: Context<any>) => {
  if (!checkAuth(c)) return unauthorizedResponse(c);

  try {
    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(c.req.query("limit") || "20", 10)),
    );
    const topicFilter = c.req.query("topic") || undefined;
    const dateFrom = c.req.query("from") || undefined;
    const dateTo = c.req.query("to") || undefined;
    const search = c.req.query("search") || undefined;

    const offset = (page - 1) * limit;
    const { reports, total } = await getReports(
      limit,
      offset,
      topicFilter,
      dateFrom,
      dateTo,
      search,
    );

    return c.json<ApiResponse<PaginatedResponse<Report>>>({
      success: true,
      data: {
        items: reports,
        total,
        page,
        limit,
        hasMore: offset + limit < total,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] GetReports error:", error);
    return c.json(formatErrorResponse(error), getErrorStatusCode(error));
  }
});

/**
 * GET /api/reports/:id - Get single report
 */
apiRouter.get("/reports/:id", async (c: Context<any>) => {
  if (!checkAuth(c)) return unauthorizedResponse(c);

  try {
    const id = c.req.param("id");
    const report = await getReportById(id);

    if (!report) {
      return c.json<ApiResponse<null>>(
        {
          success: false,
          error: "Report not found",
          timestamp: new Date().toISOString(),
        },
        404,
      );
    }

    return c.json<ApiResponse<Report>>({
      success: true,
      data: report,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] GetReport error:", error);
    return c.json(formatErrorResponse(error), getErrorStatusCode(error));
  }
});

/**
 * DELETE /api/reports/:id - Delete a single report (requires auth)
 */
apiRouter.delete("/reports/:id", async (c: Context<any>) => {
  if (!checkAuth(c)) return unauthorizedResponse(c);

  try {
    const id = c.req.param("id");
    await deleteReport(id);

    return c.json<ApiResponse<null>>({
      success: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[API] DeleteReport error:", error);

    if (error instanceof AppError) {
      return c.json(formatErrorResponse(error), error.statusCode);
    }

    return c.json(formatErrorResponse(error), 500);
  }
});

/**
 * GET /api/topics/:name/reports - Get reports for specific topic
 */
apiRouter.get("/topics/:name/reports", async (c: Context<any>) => {
  if (!checkAuth(c)) return unauthorizedResponse(c);

  try {
    const topic = decodeURIComponent(c.req.param("name"));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(c.req.query("limit") || "20", 10)),
    );

    const reports = await getReportsByTopic(topic, limit);

    return c.json<ApiResponse<Report[]>>({
      success: true,
      data: reports,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] GetTopicReports error:", error);
    return c.json(formatErrorResponse(error), getErrorStatusCode(error));
  }
});

/**
 * DELETE /api/topics/:name/reports - Clear all reports for a topic (requires auth)
 */
apiRouter.delete("/topics/:name/reports", async (c: Context<any>) => {
  if (!checkAuth(c)) return unauthorizedResponse(c);

  try {
    const topic = decodeURIComponent(c.req.param("name"));
    const count = await clearTopicReports(topic);

    return c.json<ApiResponse<{ deleted: number }>>({
      success: true,
      data: { deleted: count },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] ClearTopicReports error:", error);
    return c.json(formatErrorResponse(error), getErrorStatusCode(error));
  }
});

// ============= Categories Endpoints =============

/**
 * GET /api/categories - Get all categories
 */
apiRouter.get("/categories", async (c: Context<any>) => {
  try {
    const categories = await getCategories();
    return c.json<ApiResponse<Category[]>>({
      success: true,
      data: categories,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] GetCategories error:", error);
    return c.json(formatErrorResponse(error), getErrorStatusCode(error));
  }
});

/**
 * POST /api/categories - Create category (requires auth)
 */
apiRouter.post("/categories", async (c: Context<any>) => {
  if (!checkAuth(c)) return unauthorizedResponse(c);

  try {
    const body = await c.req.json<{ name: string; color?: string }>();
    if (!body.name || body.name.trim().length === 0) {
      return c.json<ApiResponse<null>>(
        {
          success: false,
          error: "Category name is required",
          timestamp: new Date().toISOString(),
        },
        400,
      );
    }
    const category = await createCategory(body.name, body.color);
    return c.json<ApiResponse<Category>>(
      {
        success: true,
        data: category,
        timestamp: new Date().toISOString(),
      },
      201,
    );
  } catch (error: any) {
    console.error("[API] CreateCategory error:", error);
    if (error instanceof AppError)
      return c.json(formatErrorResponse(error), error.statusCode);
    return c.json(formatErrorResponse(error), 500);
  }
});

/**
 * PATCH /api/categories/:id - Update category (requires auth)
 */
apiRouter.patch("/categories/:id", async (c: Context<any>) => {
  if (!checkAuth(c)) return unauthorizedResponse(c);

  try {
    const id = c.req.param("id");
    const body = await c.req.json<{ name?: string; color?: string }>();
    const updated = await updateCategory(id, body.name, body.color);
    return c.json<ApiResponse<Category>>({
      success: true,
      data: updated,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[API] UpdateCategory error:", error);
    if (error instanceof AppError)
      return c.json(formatErrorResponse(error), error.statusCode);
    return c.json(formatErrorResponse(error), 500);
  }
});

/**
 * DELETE /api/categories/:id - Delete category (requires auth)
 */
apiRouter.delete("/categories/:id", async (c: Context<any>) => {
  if (!checkAuth(c)) return unauthorizedResponse(c);

  try {
    const id = c.req.param("id");
    await deleteCategory(id);
    return c.json<ApiResponse<null>>({
      success: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[API] DeleteCategory error:", error);
    if (error instanceof AppError)
      return c.json(formatErrorResponse(error), error.statusCode);
    return c.json(formatErrorResponse(error), 500);
  }
});

/**
 * POST /api/topics/:id/categories - Add category to topic
 */
apiRouter.post("/topics/:id/categories", async (c: Context<any>) => {
  if (!checkAuth(c)) return unauthorizedResponse(c);

  try {
    const topicId = c.req.param("id");
    const body = await c.req.json<{ category_id: string }>();
    await addTopicCategory(topicId, body.category_id);
    const categories = await getTopicCategories(topicId);
    return c.json<ApiResponse<Category[]>>({
      success: true,
      data: categories,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[API] AddTopicCategory error:", error);
    if (error instanceof AppError)
      return c.json(formatErrorResponse(error), error.statusCode);
    return c.json(formatErrorResponse(error), 500);
  }
});

/**
 * DELETE /api/topics/:id/categories/:categoryId - Remove category from topic
 */
apiRouter.delete(
  "/topics/:id/categories/:categoryId",
  async (c: Context<any>) => {
    if (!checkAuth(c)) return unauthorizedResponse(c);

    try {
      const topicId = c.req.param("id");
      const categoryId = c.req.param("categoryId");
      await removeTopicCategory(topicId, categoryId);
      return c.json<ApiResponse<null>>({
        success: true,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[API] RemoveTopicCategory error:", error);
      return c.json(formatErrorResponse(error), 500);
    }
  },
);

/**
 * GET /api/topics/:id/categories - Get categories for a topic
 */
apiRouter.get("/topics/:id/categories", async (c: Context<any>) => {
  try {
    const topicId = c.req.param("id");
    const categories = await getTopicCategories(topicId);
    return c.json<ApiResponse<Category[]>>({
      success: true,
      data: categories,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] GetTopicCategories error:", error);
    return c.json(formatErrorResponse(error), getErrorStatusCode(error));
  }
});

// ============= Bookmarks Endpoints =============

/**
 * GET /api/bookmarks - Get user's bookmarks
 */
apiRouter.get("/bookmarks", async (c: Context<any>) => {
  try {
    const userId = c.get("user")?.sub || "anonymous";
    const bookmarks = await getBookmarks(userId);
    return c.json<ApiResponse<any[]>>({
      success: true,
      data: bookmarks,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] GetBookmarks error:", error);
    return c.json(formatErrorResponse(error), getErrorStatusCode(error));
  }
});

/**
 * POST /api/bookmarks - Add bookmark
 */
apiRouter.post("/bookmarks", async (c: Context<any>) => {
  try {
    const userId = c.get("user")?.sub || "anonymous";
    const body = await c.req.json<{ report_id: string; note?: string }>();
    if (!body.report_id) {
      return c.json<ApiResponse<null>>(
        {
          success: false,
          error: "report_id is required",
          timestamp: new Date().toISOString(),
        },
        400,
      );
    }
    const bookmark = await addBookmark(body.report_id, userId, body.note);
    return c.json<ApiResponse<any>>(
      {
        success: true,
        data: bookmark,
        timestamp: new Date().toISOString(),
      },
      201,
    );
  } catch (error: any) {
    console.error("[API] AddBookmark error:", error);
    if (error instanceof AppError)
      return c.json(formatErrorResponse(error), error.statusCode);
    return c.json(formatErrorResponse(error), 500);
  }
});

/**
 * DELETE /api/bookmarks/:reportId - Remove bookmark
 */
apiRouter.delete("/bookmarks/:reportId", async (c: Context<any>) => {
  try {
    const userId = c.get("user")?.sub || "anonymous";
    const reportId = c.req.param("reportId");
    await removeBookmark(reportId, userId);
    return c.json<ApiResponse<null>>({
      success: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] RemoveBookmark error:", error);
    return c.json(formatErrorResponse(error), getErrorStatusCode(error));
  }
});

/**
 * GET /api/bookmarks/check/:reportId - Check if report is bookmarked
 */
apiRouter.get("/bookmarks/check/:reportId", async (c: Context<any>) => {
  try {
    const userId = c.get("user")?.sub || "anonymous";
    const reportId = c.req.param("reportId");
    const bookmarked = await isBookmarked(reportId, userId);
    return c.json<ApiResponse<{ bookmarked: boolean }>>({
      success: true,
      data: { bookmarked },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] CheckBookmark error:", error);
    return c.json(formatErrorResponse(error), getErrorStatusCode(error));
  }
});

// ============= Notifications Endpoints =============

/**
 * GET /api/notifications - Get user notifications
 */
apiRouter.get("/notifications", async (c: Context<any>) => {
  try {
    const userId = c.get("user")?.sub || "anonymous";
    const unreadOnly = c.req.query("unread") === "true";
    const notifications = await getNotifications(userId, unreadOnly);
    const unreadCount = await getUnreadNotificationCount(userId);
    return c.json<ApiResponse<{ notifications: any[]; unreadCount: number }>>({
      success: true,
      data: { notifications, unreadCount },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] GetNotifications error:", error);
    return c.json(formatErrorResponse(error), getErrorStatusCode(error));
  }
});

/**
 * PATCH /api/notifications/:id/read - Mark notification as read
 */
apiRouter.patch("/notifications/:id/read", async (c: Context<any>) => {
  try {
    const id = c.req.param("id");
    await markNotificationRead(id);
    return c.json<ApiResponse<null>>({
      success: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] MarkNotificationRead error:", error);
    return c.json(formatErrorResponse(error), getErrorStatusCode(error));
  }
});

/**
 * POST /api/notifications/read-all - Mark all as read
 */
apiRouter.post("/notifications/read-all", async (c: Context<any>) => {
  try {
    const userId = c.get("user")?.sub || "anonymous";
    await markAllNotificationsRead(userId);
    return c.json<ApiResponse<null>>({
      success: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] MarkAllRead error:", error);
    return c.json(formatErrorResponse(error), getErrorStatusCode(error));
  }
});

// ============= Weekly Summaries Endpoints =============

/**
 * GET /api/summaries - Get weekly summaries
 */
apiRouter.get("/summaries", async (c: Context<any>) => {
  if (!checkAuth(c)) return unauthorizedResponse(c);

  try {
    const limit = Math.min(
      50,
      Math.max(1, parseInt(c.req.query("limit") || "10", 10)),
    );
    const summaries = await getWeeklySummaries(limit);
    return c.json<ApiResponse<any[]>>({
      success: true,
      data: summaries,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] GetWeeklySummaries error:", error);
    return c.json(formatErrorResponse(error), getErrorStatusCode(error));
  }
});

/**
 * GET /api/summaries/:id - Get a single weekly summary by ID
 */
apiRouter.get("/summaries/:id", async (c: Context<any>) => {
  if (!checkAuth(c)) return unauthorizedResponse(c);

  try {
    const id = c.req.param("id");
    const summary = await getWeeklySummaryById(id);
    if (!summary) {
      return c.json(
        { success: false, error: "Summary not found", timestamp: new Date().toISOString() },
        404,
      );
    }
    return c.json<ApiResponse<any>>({
      success: true,
      data: summary,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] GetWeeklySummaryById error:", error);
    return c.json(formatErrorResponse(error), getErrorStatusCode(error));
  }
});

/**
 * DELETE /api/summaries/:id - Delete a weekly summary
 */
apiRouter.delete("/summaries/:id", async (c: Context<any>) => {
  if (!checkAuth(c)) return unauthorizedResponse(c);

  try {
    const id = c.req.param("id");
    const deleted = await deleteWeeklySummary(id);
    if (!deleted) {
      return c.json(
        { success: false, error: "Summary not found", timestamp: new Date().toISOString() },
        404,
      );
    }
    return c.json<ApiResponse<{ deleted: boolean }>>({
      success: true,
      data: { deleted: true },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] DeleteWeeklySummary error:", error);
    return c.json(formatErrorResponse(error), getErrorStatusCode(error));
  }
});

// ============= Pipeline Endpoints =============

/**
 * GET /api/pipeline/status - Get pipeline running status, last/next run info
 */
apiRouter.get("/pipeline/status", (c: Context<any>) => {
  try {
    const status = getPipelineStatus();
    return c.json<ApiResponse<any>>({
      success: true,
      data: status,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] PipelineStatus error:", error);
    return c.json(formatErrorResponse(error), getErrorStatusCode(error));
  }
});

/**
 * POST /api/pipeline/run - Manually trigger a research pipeline run
 */
apiRouter.post("/pipeline/run", async (c: Context<any>) => {
  if (!checkAuth(c)) return unauthorizedResponse(c);

  try {
    const result = await triggerManualRun();

    if (!result.started) {
      return c.json<ApiResponse<{ started: boolean; reason?: string }>>({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    }

    return c.json<ApiResponse<{ started: boolean }>>(
      {
        success: true,
        data: { started: true },
        timestamp: new Date().toISOString(),
      },
      202,
    );
  } catch (error) {
    console.error("[API] PipelineRun error:", error);
    return c.json(formatErrorResponse(error), getErrorStatusCode(error));
  }
});

/**
 * POST /api/summaries/generate - Manually trigger weekly summary generation
 */
apiRouter.post("/summaries/generate", async (c: Context<any>) => {
  if (!checkAuth(c)) return unauthorizedResponse(c);

  try {
    const result = await triggerManualSummary();

    if (!result.started) {
      return c.json<ApiResponse<{ started: boolean; reason?: string }>>({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    }

    return c.json<ApiResponse<{ started: boolean }>>(
      {
        success: true,
        data: { started: true },
        timestamp: new Date().toISOString(),
      },
      202,
    );
  } catch (error) {
    console.error("[API] GenerateSummary error:", error);
    return c.json(formatErrorResponse(error), getErrorStatusCode(error));
  }
});
