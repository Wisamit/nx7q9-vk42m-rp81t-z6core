import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseBranchExpectedInstant } from "../src/lib/branch-wall-clock.ts";
import { formatCalendarDisplay, formatInstantDisplay } from "../src/lib/system-date-display.ts";

const read = (path: string) => readFileSync(path, "utf8");
const pages = [
  "src/app/catalog/tests/[id]/page.tsx",
  "src/app/clinical-comments/review/page.tsx",
  "src/app/doctor-portal-access/page.tsx",
  "src/app/doctor-requisitions/page.tsx",
  "src/app/security/page.tsx",
  "src/app/queue-display/[branchId]/page.tsx",
  "src/app/verify/report/[token]/page.tsx",
  "src/app/portal/page.tsx",
  "src/app/catalog/imports/reconciliation-ledger/page.tsx",
  "src/app/settings/specimens/page.tsx",
] as const;

test("UI batch 07 accounts for ten distinct canonical routes", () => {
  assert.equal(pages.length, 10);
  assert.equal(new Set(pages).size, 10);
  for (const page of pages) assert.ok(read(page).includes("export default"), page);
});

test("clinical catalog effective dates retain calendar-only semantics and provenance", () => {
  const page = read(pages[0]);
  assert.ok(page.includes('kind="calendar"'), "No timezone-shifted clinical effective dates");
  assert.ok(page.includes("timeZone={policy.branch?.timezone}"));
  assert.ok(page.includes("timeZone={range.branch?.timezone}"));
  assert.ok(page.includes("policy.effectiveFrom.toISOString().slice(0,10)"));
  assert.ok(page.includes("range.effectiveFrom.toISOString().slice(0,10)"));
  assert.ok(page.includes("question.effectiveFrom.toISOString().slice(0,10)"));
  assert.equal(formatCalendarDisplay("2026-11-05", "DD/MM/YYYY"), "05/11/2026");
  assert.equal(formatCalendarDisplay("2024-02-29", "DD/MM/YYYY"), "29/02/2024");
});

test("doctor portal grant editor serializes explicit branch local instants and rejects DST ambiguity", () => {
  const editor = read("src/components/doctor-portal-access-manager.tsx");
  const route = read("src/app/doctor-portal-access/page.tsx");
  const api = read("src/app/api/doctor-portal-access/route.ts");
  assert.ok(route.includes('requirePermission("portal_accounts.manage")'));
  assert.ok(route.includes("branchTimeZone={session.user.branchScopes.find"));
  assert.ok(editor.includes('SystemDateTimeField name="effectiveFrom"'));
  assert.ok(editor.includes('SystemDateTimeField name="effectiveTo"'));
  assert.ok(editor.includes("parseBranchExpectedInstant(from, branchTimeZone)"));
  assert.ok(editor.includes("parseBranchExpectedInstant(to, branchTimeZone)"));
  assert.ok(editor.includes("effectiveFrom:effectiveFrom?.toISOString()"));
  assert.ok(editor.includes("effectiveTo:effectiveTo?.toISOString()"));
  assert.doesNotMatch(editor, /new Date\(from\)|new Date\(to\)|type="datetime-local"/);
  assert.ok(api.includes("validDoctorAccessDates(start,end)"));
  assert.ok(api.includes('status:"ACTIVE"'));
  assert.equal(parseBranchExpectedInstant("2026-11-05T23:30", "Asia/Dubai")?.toISOString(), "2026-11-05T19:30:00.000Z");
  assert.equal(parseBranchExpectedInstant("2026-03-08T02:30", "America/New_York"), null);
  assert.equal(parseBranchExpectedInstant("2026-11-01T01:30", "America/New_York"), null);
  assert.equal(parseBranchExpectedInstant("2026-11-01T02:30", "America/New_York")?.toISOString(), "2026-11-01T07:30:00.000Z");
});

test("clinical and public audit events display configured dates without changing payload snapshots", () => {
  const comment = read(pages[1]);
  const security = read("src/components/security-settings.tsx");
  const doctor = read("src/components/doctor-requisition-review.tsx");
  const verification = read(pages[6]);
  const portal = read(pages[7]);
  assert.ok(comment.includes('timeZone="UTC"'));
  assert.ok(security.includes("<SystemDateText value={mfaConfirmedAt} />"));
  assert.ok(doctor.includes("timeZone={r.branchTimeZone}"));
  assert.ok(verification.includes('timeZone="UTC"'));
  assert.ok(verification.includes("version.contentSnapshot"));
  for (const z of [
    "order.orderingBranch.timezone", "report.branch.timezone",
    "item.branch.timezone", "invoice.branch.timezone",
  ]) assert.ok(portal.includes("timeZone={" + z + "}"), z);
  assert.ok(portal.includes("invoice.total.toString()"));
  assert.ok(portal.includes("report.report.order.accessionNumber"));
  const pref = { dateFormat: "DD/MM/YYYY" as const, timeZone: "Asia/Dubai", timeFormat: "24" as const, showSeconds: false };
  assert.equal(formatInstantDisplay("2026-11-05T22:35:00Z", pref), "06/11/2026 02:35");
});

test("public waiting display uses branch business date and must not disclose PHI", () => {
  const queue = read(pages[5]);
  assert.ok(queue.includes("branchLocalDate(branch.timezone)"));
  assert.ok(queue.includes('kind="calendar" value={queueDate.toISOString().slice(0, 10)}'));
  assert.ok(queue.includes('status: { in: ["CALLED","SERVING"] }'));
  assert.ok(queue.includes("no patient names"));
  assert.doesNotMatch(queue, /select:\s*\{[^}]*patientName/);
});

test("import and specimen configuration timelines remain read-only, server-scoped historical data", () => {
  const ledger = read("src/components/legacy-import-reconciliation-ledger.tsx");
  const reasonPage = read(pages[9]);
  const reasonManager = read("src/components/specimen-rejection-reason-manager.tsx");
  assert.ok(ledger.includes('<SystemDateText value={item.createdAt} />'));
  assert.ok(ledger.includes('<SystemDateText value={item.validatedAt} />'));
  assert.ok(ledger.includes('<SystemDateText value={item.importedAt} />'));
  assert.ok(reasonPage.includes('where: { organizationId: session.user.organizationId }'));
  assert.ok(reasonPage.includes("updatedAt: item.updatedAt.toISOString()"));
  assert.ok(reasonManager.includes('<SystemDateText value={reason.updatedAt} />'));
  assert.ok(reasonPage.includes("Existing rejection history keeps immutable snapshots."));
});
