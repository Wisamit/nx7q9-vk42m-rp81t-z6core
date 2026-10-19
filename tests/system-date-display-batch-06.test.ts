import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseBranchExpectedInstant } from "../src/lib/branch-wall-clock.ts";
import { formatInstantDisplay, formatCalendarDisplay } from "../src/lib/system-date-display.ts";

const routeScreens = [
  "src/app/billing/accounts/credit-limits/page.tsx",
  "src/app/billing/cashier/page.tsx",
  "src/app/billing/payment-methods/page.tsx",
  "src/app/microbiology/page.tsx",
  "src/app/phlebotomy/page.tsx",
  "src/app/specimens/scan/page.tsx",
  "src/app/specimens/retention/page.tsx",
  "src/app/send-outs/page.tsx",
  "src/app/referrers/page.tsx",
  "src/app/report-templates/page.tsx",
] as const;

test("UI batch 06 touches ten distinct previously uncovered routes", () => {
  assert.equal(routeScreens.length, 10);
  assert.equal(new Set(routeScreens).size, 10);
  for (const path of routeScreens) assert.ok(readFileSync(path, "utf8").length > 300, path);
});

test("batch 06 operational screens use configured date widgets; original ISO stays on the wire", () => {
  const components = [
    "client-credit-limit-manager", "cashier-shift-manager", "payment-method-manager",
    "specimen-retention-manager", "send-out-manager", "report-template-manager",
    "specimen-aliquot-manager",
  ];
  for (const name of components) {
    const source = readFileSync("src/components/" + name + ".tsx", "utf8");
    assert.ok(source.includes("<SystemDateText"), name);
  }
  const phlebotomy = readFileSync("src/components/phlebotomy-collection-card.tsx", "utf8");
  assert.match(phlebotomy, /<SystemDateField name="secondaryVerificationValue" required \/>/);
  assert.doesNotMatch(phlebotomy, /secondaryType === "DATE_OF_BIRTH" \? "date" : "text"/);
  const sendOut = readFileSync("src/components/send-out-manager.tsx", "utf8");
  assert.match(sendOut, /<SystemDateTimeField name="expectedResultAt" \/>/);
  assert.match(sendOut, /form\.get\("expectedResultAt"\)/);
  assert.ok(readFileSync("src/app/send-outs/page.tsx", "utf8").includes("expectedResultAt: referral.expectedResultAt?.toISOString()"));
  assert.ok(readFileSync("src/app/billing/cashier/page.tsx", "utf8").includes("openingCash: shift.openingCash.toFixed(4)"));
  assert.ok(readFileSync("src/app/report-templates/page.tsx", "utf8").includes("latestCreatedAt:t.versions[0]?.createdAt.toISOString()"));
});

test("batch 06 branch-local and calendar dates are not confused across midnight", () => {
  const pref = { dateFormat: "DD/MM/YYYY" as const, timeZone: "Asia/Dubai", timeFormat: "24" as const, showSeconds: false };
  assert.equal(formatCalendarDisplay("2024-02-29", "DD/MM/YYYY"), "29/02/2024");
  assert.equal(formatInstantDisplay("2026-10-31T21:15:00.000Z", pref), "01/11/2026 01:15");
  assert.equal(formatInstantDisplay("2026-10-31T21:15:00.000Z", { ...pref, timeZone: "UTC" }), "31/10/2026 21:15");
  assert.equal(formatInstantDisplay("2026-10-31T21:15", pref), "—");
});

test("branch wall-clock parser requires explicit zone and rejects DST folds/gaps", () => {
  assert.equal(parseBranchExpectedInstant("2026-11-05T23:30", "Asia/Dubai")?.toISOString(), "2026-11-05T19:30:00.000Z");
  assert.equal(parseBranchExpectedInstant("2026-11-05T23:30Z", "Asia/Dubai")?.toISOString(), "2026-11-05T23:30:00.000Z");
  assert.equal(parseBranchExpectedInstant("2026-02-29T12:00", "Asia/Dubai"), null);
  assert.equal(parseBranchExpectedInstant("2024-02-29T12:00", "Asia/Dubai")?.toISOString(), "2024-02-29T08:00:00.000Z");
  assert.equal(parseBranchExpectedInstant("2026-03-08T02:30", "America/New_York"), null);
  assert.equal(parseBranchExpectedInstant("2026-11-01T01:30", "America/New_York"), null);
  assert.equal(parseBranchExpectedInstant("2026-11-01T02:30", "America/New_York")?.toISOString(), "2026-11-01T07:30:00.000Z");
  assert.equal(parseBranchExpectedInstant("2026-11-05T23:30", "Invalid/Zone"), null);
  assert.equal(parseBranchExpectedInstant("05/11/2026", "Asia/Dubai"), null);
});

test("send-out API enforces chosen authorized active branch timezone without reinterpreting existing instants", () => {
  const source = readFileSync("src/app/api/send-outs/route.ts", "utf8");
  assert.match(source, /canAccessBranch\(session, branchId\)/);
  assert.match(source, /organizationId: session\.user\.organizationId, status: "ACTIVE"/);
  assert.match(source, /parseBranchExpectedInstant\(expectedResultAtText, branch\.timezone\)/);
  assert.ok(source.includes("invalid_or_ambiguous_branch_local_time"));
  assert.ok(source.includes("costAmount: cost.amount === null ? null : new Prisma.Decimal(cost.amount).toFixed(4)"));
  assert.ok(source.includes("parseSendOutCost(body.costAmount, body.costCurrency)"));
});

test("branch-scoped clinical and finance timestamps use their original operational branch", () => {
  const pages: Array<[string, string]> = [
    ["src/app/microbiology/page.tsx", "item.performingBranch.timezone"],
    ["src/app/phlebotomy/page.tsx", "attempt.branchId)?.timezone"],
    ["src/app/specimens/scan/page.tsx", "attempt.branch.timezone"],
    ["src/app/send-outs/page.tsx", "referral.branch.timezone"],
    ["src/app/billing/cashier/page.tsx", "shift.branch.timezone"],
  ];
  for (const [path, token] of pages) assert.ok(readFileSync(path, "utf8").includes(token), path + ": " + token);
  const retention = readFileSync("src/components/specimen-retention-manager.tsx", "utf8");
  assert.ok(retention.includes("value={item.retentionDueAt} timeZone={branchTimeZone}"));
});
