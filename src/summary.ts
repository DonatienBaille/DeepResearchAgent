import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import {
  getReports,
  saveWeeklySummary,
  getWeeklySummaryByWeek,
  createNotification,
} from "./db.js";
import { sanitizeErrorForLog } from "./utils/errors.js";

/**
 * Weekly multi-topic summary generator
 * Synthesizes key findings across all active topics for the past week
 */

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/**
 * Get the ISO date string for the start of the current week (Monday)
 */
export function getWeekStart(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split("T")[0];
}

/**
 * Get the ISO date string for the end of the current week (Sunday)
 */
export function getWeekEnd(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? 0 : 7); // Sunday
  d.setDate(diff);
  d.setHours(23, 59, 59, 999);
  return d.toISOString().split("T")[0];
}

/**
 * Generate a weekly cross-topic summary
 */
export async function generateWeeklySummary(): Promise<string | null> {
  try {
    const now = new Date();
    const weekStart = getWeekStart(now);
    const weekEnd = getWeekEnd(now);

    // Check if summary already exists for this week
    const existing = await getWeeklySummaryByWeek(weekStart);
    if (existing) {
      console.log(
        `[Summary] Weekly summary already exists for week ${weekStart}`,
      );
      return existing.html_content;
    }

    // Get all reports from this week
    const weekStartDate = `${weekStart}T00:00:00`;
    const weekEndDate = `${weekEnd}T23:59:59`;
    const { reports } = await getReports(
      200,
      0,
      undefined,
      weekStartDate,
      weekEndDate,
    );

    if (reports.length === 0) {
      console.log("[Summary] No reports found for this week, skipping summary");
      return null;
    }

    // Group reports by topic
    const reportsByTopic: Record<string, string[]> = {};
    for (const report of reports) {
      if (!reportsByTopic[report.topic]) {
        reportsByTopic[report.topic] = [];
      }
      // Strip HTML for summary
      const text = report.html_content
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 500);
      reportsByTopic[report.topic].push(text);
    }

    // Build context for LLM
    const topicSummaries = Object.entries(reportsByTopic)
      .map(
        ([topic, texts]) =>
          `## ${topic}\n${texts.map((t, i) => `Report ${i + 1}: ${t}`).join("\n")}`,
      )
      .join("\n\n");

    const llm = new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      modelName: OPENAI_MODEL,
      temperature: 0.5,
      maxTokens: 1000,
    });

    const response = await llm.invoke([
      new HumanMessage(
        `You are a technology research analyst. Create a professional weekly synthesis summarizing the key highlights across all research topics from this week.

WEEKLY RESEARCH DATA:
${topicSummaries}

FORMAT AS VALID HTML:
- Start with <div class="weekly-summary">
- Add an <h2> with the week range: "${weekStart} to ${weekEnd}"
- For each topic with notable findings, add an <h3> with the topic name and a <p> summarizing key points
- End with a "Cross-Topic Insights" section highlighting connections or overarching trends
- Add a <p class="summary-meta"> at the end with total reports count
- Keep it concise but informative (300-500 words total)
- Use professional tone suitable for a tech team

HTML Response:`,
      ),
    ]);

    const htmlContent =
      typeof response.content === "string"
        ? response.content
        : response.content
            .map((c) => (typeof c === "string" ? c : ""))
            .join("");

    // Save to database
    const topicsCovered = Object.keys(reportsByTopic);
    await saveWeeklySummary(
      weekStart,
      weekEnd,
      htmlContent,
      topicsCovered,
    );

    // Create notification for the summary
    await createNotification(
      null,
      "anonymous",
      "weekly_summary",
      `Weekly Summary: ${weekStart}`,
      `Cross-topic synthesis covering ${topicsCovered.length} topics with ${reports.length} reports.`,
    );

    console.log(
      `[Summary] Generated weekly summary for ${weekStart}: ${topicsCovered.length} topics, ${reports.length} reports`,
    );

    return htmlContent;
  } catch (error) {
    console.error(
      "[Summary] Failed to generate weekly summary:",
      sanitizeErrorForLog(error),
    );
    return null;
  }
}
