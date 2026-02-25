import { createHash } from "crypto";
import {
  hasContentHash,
  saveContentMemory,
  getRecentSourceUrls,
  getContentMemory,
  createNotification,
} from "./db.js";
// Types used via db.js imports

/**
 * Memory/Novelty tracking system
 * Tracks content hashes to avoid re-notifying the same findings
 * Extracts key findings and source URLs for deduplication
 */

/**
 * Extract key findings from HTML content
 * Strips HTML tags and extracts meaningful sentences
 */
export function extractKeyFindings(htmlContent: string): string[] {
  // Strip HTML tags
  const text = htmlContent
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  // Split into sentences and filter meaningful ones
  const sentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length < 500);

  // Return top key findings (most informative sentences)
  return sentences.slice(0, 10);
}

/**
 * Extract source URLs from HTML content
 */
export function extractSourceUrls(htmlContent: string): string[] {
  const urlRegex = /href="(https?:\/\/[^"]+)"/g;
  const urls = new Set<string>();
  let match;
  while ((match = urlRegex.exec(htmlContent)) !== null) {
    urls.add(match[1]);
  }
  return Array.from(urls);
}

/**
 * Generate a content hash for novelty detection
 * Normalizes content to reduce false positives from minor formatting changes
 */
export function generateContentHash(keyFindings: string[]): string {
  // Sort and normalize findings for consistent hashing
  const normalized = keyFindings
    .map((f) => f.toLowerCase().replace(/\s+/g, " ").trim())
    .sort()
    .join("|");

  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Detect novel content in a report compared to previous reports
 * Returns the novel findings that haven't been seen before
 */
export async function detectNovelContent(
  topic: string,
  htmlContent: string,
): Promise<{
  isNovel: boolean;
  novelFindings: string[];
  knownFindings: string[];
  novelUrls: string[];
  contentHash: string;
}> {
  const keyFindings = extractKeyFindings(htmlContent);
  const sourceUrls = extractSourceUrls(htmlContent);
  const contentHash = generateContentHash(keyFindings);

  // Check if this exact content hash already exists
  const hashExists = await hasContentHash(topic, contentHash);
  if (hashExists) {
    return {
      isNovel: false,
      novelFindings: [],
      knownFindings: keyFindings,
      novelUrls: [],
      contentHash,
    };
  }

  // Check against recent source URLs to find truly new sources
  const recentUrls = await getRecentSourceUrls(topic, 7);
  const recentUrlSet = new Set(recentUrls);
  const novelUrls = sourceUrls.filter((url) => !recentUrlSet.has(url));

  // Check against recent key findings
  const recentMemories = await getContentMemory(topic, 50);
  const recentFindingsSet = new Set<string>();
  for (const memory of recentMemories) {
    try {
      const findings: string[] = JSON.parse(memory.key_findings);
      findings.forEach((f) =>
        recentFindingsSet.add(f.toLowerCase().replace(/\s+/g, " ").trim()),
      );
    } catch {}
  }

  const novelFindings = keyFindings.filter(
    (f) => !recentFindingsSet.has(f.toLowerCase().replace(/\s+/g, " ").trim()),
  );
  const knownFindings = keyFindings.filter((f) =>
    recentFindingsSet.has(f.toLowerCase().replace(/\s+/g, " ").trim()),
  );

  // Content is novel if we have new findings OR new URLs
  const isNovel = novelFindings.length > 0 || novelUrls.length > 0;

  return {
    isNovel,
    novelFindings,
    knownFindings,
    novelUrls,
    contentHash,
  };
}

/**
 * Process a report through the memory system
 * Saves content memory and creates notification if content is novel
 */
export async function processReportMemory(
  topic: string,
  reportId: string,
  htmlContent: string,
  userId: string = "anonymous",
): Promise<{
  isNovel: boolean;
  novelFindings: string[];
  notificationCreated: boolean;
}> {
  const noveltyResult = await detectNovelContent(topic, htmlContent);

  // Save to content memory regardless
  await saveContentMemory(
    topic,
    noveltyResult.contentHash,
    extractKeyFindings(htmlContent),
    extractSourceUrls(htmlContent),
    reportId,
  );

  let notificationCreated = false;

  // Only create notification if content is truly novel
  if (noveltyResult.isNovel) {
    const novelCount = noveltyResult.novelFindings.length;
    const urlCount = noveltyResult.novelUrls.length;

    const title = `New findings for "${topic}"`;
    const message =
      novelCount > 0
        ? `${novelCount} new finding${novelCount > 1 ? "s" : ""} detected${urlCount > 0 ? ` with ${urlCount} new source${urlCount > 1 ? "s" : ""}` : ""}.`
        : `${urlCount} new source${urlCount > 1 ? "s" : ""} found.`;

    await createNotification(reportId, userId, "new_report", title, message);
    notificationCreated = true;

    console.log(
      `[Memory] Novel content detected for "${topic}": ${novelCount} new findings, ${urlCount} new URLs`,
    );
  } else {
    console.log(
      `[Memory] No novel content for "${topic}" — skipping notification`,
    );
  }

  return {
    isNovel: noveltyResult.isNovel,
    novelFindings: noveltyResult.novelFindings,
    notificationCreated,
  };
}
