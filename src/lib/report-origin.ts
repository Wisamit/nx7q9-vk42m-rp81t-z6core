/**
 * A portal or report verification link must never inherit an untrusted
 * Host/X-Forwarded-Host header. A poisoned origin could redirect confidential
 * report notifications to an attacker-controlled website.
 */
export function canonicalReportOrigin(
  configured: string | null | undefined,
  production = true,
): string | null {
  if (!configured || !configured.trim()) return null;
  try {
    const url = new URL(configured.trim());
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    if (url.protocol === "https:") return url.origin;
    if (!production && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      return url.origin;
    }
    return null;
  } catch {
    return null;
  }
}
