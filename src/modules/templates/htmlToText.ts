/**
 * Derives a plain-text fallback from an HTML template source.
 *
 * Runs on the raw template (before `{{variable}}` substitution), so
 * placeholders pass through untouched — only surrounding markup is removed.
 * This is intentionally simple (no full HTML parser): it's producing a
 * *fallback* for clients that can't render HTML, not a faithful text
 * rendering, so approximate block/line spacing is good enough.
 */
export function htmlToText(html: string): string {
  return html
    // Block-level and line-break tags become newlines before their content
    // is stripped, so paragraphs/lines don't collapse into one run-on line.
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '\t')
    // Drop non-visible content entirely rather than turning it into text.
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Strip remaining tags.
    .replace(/<[^>]+>/g, '')
    // Decode the small set of entities plausible in hand-written template HTML.
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // Collapse the whitespace the tag-stripping leaves behind.
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}
