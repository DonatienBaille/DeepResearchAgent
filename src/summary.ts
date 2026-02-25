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

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";

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
      maxTokens: 1000,
    });

    const response = await llm.invoke([
      new HumanMessage(
        `Tu es le rédacteur en chef d'une newsletter de veille technologique très pointue, lue par des experts IT.
Ton rôle est de prendre les notes de recherche brutes de la semaine et de les transformer en un résumé hebdomadaire clair, professionnel et scannable.

RÈGLES DE RÉDACTION :
1. Rédige l'intégralité du résumé en français, avec un ton neutre, professionnel et direct.
2. Organise le contenu par sujet. Utilise des titres ### pour chaque technologie ou thème.
3. Synthétise les informations sous forme de bullet points (- ) de 2 à 3 lignes maximum par point. Pas de longs blocs de texte.
4. Intègre systématiquement les liens sources quand ils sont disponibles.
5. S'il est indiqué qu'il n'y a rien de nouveau pour un sujet précis, ignore-le complètement (ne crée pas de section vide).
6. Rédige une très courte introduction chaleureuse et une brève conclusion.
7. Utilise uniquement le formatage Markdown.

DONNÉES DE RECHERCHE DE LA SEMAINE :
${topicSummaries}

FORMAT MARKDOWN :
- Commence par un titre ## avec la plage de la semaine : "Semaine du ${weekStart} au ${weekEnd}"
- Ajoute un court paragraphe d'introduction chaleureuse
- Pour chaque sujet avec des découvertes notables, ajoute un ### avec le nom du sujet et des bullet points résumant les points clés
- Termine avec une section ### Tendances transversales mettant en avant les connexions ou tendances globales
- Ajoute une ligne en italique à la fin avec le nombre total de rapports (${reports.length} rapports)
- Vise 300-500 mots au total, concis mais informatif

Réponse Markdown :`,
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
    await saveWeeklySummary(weekStart, weekEnd, htmlContent, topicsCovered);

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
