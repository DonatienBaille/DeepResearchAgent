import { marked } from "marked";

/**
 * Convert Markdown content to email-optimized HTML.
 *
 * Applies inline styles so the output renders correctly in email clients
 * that strip <style> blocks (Gmail, Outlook, etc.).
 */
export function markdownToEmailHtml(markdown: string): string {
  const rawHtml = marked.parse(markdown, { async: false }) as string;

  // Apply inline styles for common email-client compatibility
  return rawHtml
    .replace(/<h1>/g, '<h1 style="font-size:24px;margin:16px 0 8px;color:#333;">')
    .replace(/<h2>/g, '<h2 style="font-size:20px;margin:14px 0 8px;color:#333;">')
    .replace(/<h3>/g, '<h3 style="font-size:16px;margin:12px 0 6px;color:#444;">')
    .replace(/<p>/g, '<p style="margin:8px 0;line-height:1.6;">')
    .replace(/<ul>/g, '<ul style="margin:8px 0;padding-left:20px;">')
    .replace(/<ol>/g, '<ol style="margin:8px 0;padding-left:20px;">')
    .replace(/<li>/g, '<li style="margin:4px 0;">')
    .replace(/<a /g, '<a style="color:#667eea;text-decoration:underline;" ')
    .replace(/<blockquote>/g, '<blockquote style="margin:8px 0;padding:8px 12px;border-left:3px solid #667eea;background:#f8f9fa;color:#555;">')
    .replace(/<hr\s*\/?>/g, '<hr style="border:none;border-top:1px solid #ddd;margin:16px 0;">');
}
