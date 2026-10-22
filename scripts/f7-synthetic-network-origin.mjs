/**
 * Strict outbound network allowlist for the F7 synthetic-only browser harness.
 * Requests may address exactly the attested origin (or its matching WS/WSS
 * companion); off-origin requests must be blocked BEFORE they leave Chromium.
 * Do not log URLs, query parameters, authorization headers or page content.
 */
export function isAllowedSyntheticNetworkRequest(requestUrl, baseOrigin) {
  try {
    const url = new URL(requestUrl);
    if (url.username || url.password) return false;
    // WSS accompanies HTTPS and WS accompanies loopback HTTP. Do not grant
    // subdomains, alternate ports, downgraded protocols or arbitrary schemes.
    const mappedProtocol = url.protocol === "wss:" ? "https:" :
      url.protocol === "ws:" ? "http:" : url.protocol;
    return (mappedProtocol === "http:" || mappedProtocol === "https:") &&
      new URL(mappedProtocol + "//" + url.host).origin === baseOrigin;
  } catch {
    return false;
  }
}
