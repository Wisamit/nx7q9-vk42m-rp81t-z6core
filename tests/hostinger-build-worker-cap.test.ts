import test from "node:test";
import assert from "node:assert/strict";
import nextConfig from "../next.config.ts";

test("Hostinger production build caps Next.js page-data worker concurrency", () => {
  assert.equal(nextConfig.experimental?.cpus, 2);
});

test("Build worker cap preserves existing security headers", async () => {
  assert.equal(nextConfig.poweredByHeader, false);
  assert.equal(typeof nextConfig.headers, "function");
  const rules = await nextConfig.headers!();
  const headers = rules.flatMap(rule => rule.headers);
  for (const key of [
    "Content-Security-Policy",
    "Referrer-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Permissions-Policy",
    "Cross-Origin-Opener-Policy",
    "Cross-Origin-Resource-Policy",
  ]) {
    assert.ok(headers.some(header => header.key === key), key);
  }
});
