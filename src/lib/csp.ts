/**
 * Per-response nonce CSP used by src/proxy.ts in production.
 *
 * Inline style attributes are intentionally retained because the React UI uses
 * a small number of runtime style props. Script execution, the relevant XSS
 * boundary for rendered Markdown, is nonce-only.
 */
export function productionContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src https://player.bilibili.com https://www.youtube-nocookie.com",
  ].join("; ");
}
