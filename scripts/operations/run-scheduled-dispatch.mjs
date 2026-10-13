#!/usr/bin/env node
// Run from a hosting scheduler with environment-based secrets. No CLI/URL tokens.
const endpoint = process.env.FAMILY_LAB_CRON_URL;
const organizationId = process.env.FAMILY_LAB_CRON_TARGET_ORGANIZATION_ID;
const secret = process.env.FAMILY_LAB_CRON_SECRET;
const operation = process.env.FAMILY_LAB_CRON_OPERATION;
const actions = new Set(["TAT", "NOTIFICATIONS", "WEBHOOKS"]);

if (!endpoint || !organizationId || !secret || secret.length < 32 || !actions.has(operation)) {
  console.error("Scheduled dispatch: required environment configuration missing.");
  process.exit(2);
}
let parsed;
try {
  parsed = new URL(endpoint);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password
      || parsed.search || parsed.hash || parsed.pathname !== "/api/cron/dispatch") throw Error("bad_url");
} catch {
  console.error("Scheduled dispatch: a clean HTTPS /api/cron/dispatch endpoint is required.");
  process.exit(2);
}
try {
  const response = await fetch(parsed, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(110_000),
    headers: { "content-type": "application/json", authorization: "Bearer " + secret },
    body: JSON.stringify({ organizationId, operation }),
  });
  // Never echo provider payloads, patient-identifiable details, or tokens.
  if (!response.ok) {
    console.error("Scheduled dispatch failed:", operation, "HTTP", response.status);
    process.exitCode = 1;
  } else {
    const result = await response.json();
    if (result.status !== "ok") {
      console.error("Scheduled dispatch returned unexpected status:", operation);
      process.exitCode = 1;
    } else {
      console.log("Scheduled dispatch completed:", operation);
    }
  }
} catch {
  console.error("Scheduled dispatch network or timeout failure:", operation);
  process.exitCode = 1;
}
