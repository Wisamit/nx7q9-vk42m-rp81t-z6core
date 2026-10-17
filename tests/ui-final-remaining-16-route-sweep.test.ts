import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatCalendarDisplay, formatInstantDisplay } from "../src/lib/system-date-display.ts";

const read = (path: string) => readFileSync(path, "utf8");
const remaining = [
  "src/app/catalog/expert-reviews/page.tsx",
  "src/app/catalog/imports/[id]/page.tsx",
  "src/app/catalog/legacy-master-data/page.tsx",
  "src/app/clinical-comments/revisions/page.tsx",
  "src/app/login/page.tsx",
  "src/app/organization/branches/page.tsx",
  "src/app/page.tsx",
  "src/app/patients/identifier-schemes/page.tsx",
  "src/app/portal/change-password/page.tsx",
  "src/app/portal/login/page.tsx",
  "src/app/portal/reports/[versionId]/page.tsx",
  "src/app/roles/page.tsx",
  "src/app/settings/page.tsx",
  "src/app/setup/page.tsx",
  "src/app/specimens/[id]/label/page.tsx",
  "src/app/users/page.tsx",
];

test("final consolidated UI source sweep completes all 81 canonical Next.js routes once", () => {
  const manifest = JSON.parse(read("docs/UI_ROUTE_MANIFEST.json")) as {
    routes: Array<{ file: string }>;
  };
  const manifestRoutes = manifest.routes.map(route => route.file);
  assert.equal(manifestRoutes.length, 81);
  assert.equal(new Set(manifestRoutes).size, 81);
  assert.equal(remaining.length, 16);
  assert.equal(new Set(remaining).size, 16);
  for (const file of remaining) {
    assert.ok(manifestRoutes.includes(file), file + " must be canonical");
    assert.ok(read(file).includes("export default"), file + " must still render or redirect");
  }

  // Batch 01/02 changed shared components, while batches 03–07 named actual route files.
  // Count canonical routes, never component files, and never count a repeated route twice.
  const earlyComponentsToRoutes = [
    "patients", "patients/[id]", "orders", "billing/accounts", "pricing", "qc",
    "quality", "digital-services", "inventory/procurement", "equipment",
    "catalog", "catalog/tests/[id]", "clinical-rules", "critical-results",
    "analyzers", "billing/taxes", "billing/reports", "billing/accounts/aging",
    "quality/eqa", "portal", "inventory",
  ].map(route => "src/app/" + route + "/page.tsx");
  const covered = new Set(earlyComponentsToRoutes);
  for (const batch of ["03", "04", "05", "06", "07"]) {
    const src = read("tests/system-date-display-batch-" + batch + ".test.ts");
    for (const match of src.matchAll(/src\/app\/[^"'\s]+?\/page\.tsx/g)) covered.add(match[0]);
  }
  assert.equal(covered.size, 65, "Reconcile true unique coverage instead of assuming 67");
  assert.deepEqual(manifestRoutes.filter(file => !covered.has(file)).sort(), [...remaining].sort());
  assert.equal(new Set([...covered, ...remaining]).size, 81);
});

test("historical import review and export show original recorded instants without import writes", () => {
  const batch = read(remaining[1]);
  const expert = read("src/components/catalog-expert-review-queue.tsx");
  const policy = read("src/components/catalog-policy-draft-review-queue.tsx");
  const master = read("src/components/legacy-master-configuration-export.tsx");
  assert.ok(batch.includes("batch.createdAt.toISOString()"));
  assert.ok(batch.includes("where: { id, organizationId: session.user.organizationId }"));
  assert.ok(expert.includes('value={entry.flaggedAt} timeZone="UTC"'));
  assert.ok(policy.includes('value={entry.recordedAt} timeZone="UTC"'));
  assert.ok(master.includes('value={archive.exportedAt} timeZone="UTC"'));
  assert.ok(master.includes("archive.integritySha256"), "Manifest hash must remain visible and untouched");
  assert.ok(read(remaining[2]).includes("LegacyMasterConfigurationExport"));
  assert.ok(read(remaining[0]).includes("CatalogPolicyDraftReviewQueue"));
});

test("comment revision and identity configuration show provenance without altering clinical revisions", () => {
  assert.ok(read(remaining[3]).includes("createdAt: row.createdAt.toISOString()"));
  const revision = read("src/components/comment-revision-editor.tsx");
  assert.ok(revision.includes('value={current.createdAt} timeZone="UTC"'));
  assert.ok(revision.includes("fingerprint: string"));
  assert.ok(revision.includes("The source remains active until independent approval"));
  assert.ok(read(remaining[7]).includes("updatedAt: item.updatedAt.toISOString()"));
  const schemes = read("src/components/patient-identifier-scheme-manager.tsx");
  assert.ok(schemes.includes("<SystemDateText value={scheme.updatedAt} />"));
  assert.ok(schemes.includes('scheme.code !== "LEGACY_OTHER"'));
});

test("staff and portal authentication pages remain independent and scoped", () => {
  assert.ok(read(remaining[4]).includes('href="/portal/login"'));
  assert.ok(read(remaining[9]).includes('href="/login"'));
  assert.ok(read(remaining[8]).includes("mustChangePassword"));
  assert.ok(read(remaining[8]).includes("PortalChangePasswordForm"));
  assert.ok(read(remaining[8]).includes('href="/portal/login"'));
  assert.ok(read(remaining[5]).includes('allowed.has("roles.view")'));
  assert.ok(read(remaining[11]).includes('permissions.has("users.view")'));
  assert.ok(read(remaining[15]).includes('permissionSet(session).has("roles.view")'));
  assert.ok(read(remaining[15]).includes('permissionSet(session).has("branches.view")'));
  const root = read(remaining[6]);
  assert.ok(root.includes('if (session) redirect("/dashboard")'));
  assert.ok(root.includes('prisma.user.findFirst({ select: { id: true } })'));
  assert.ok(root.includes('redirect(firstUser ? "/login" : "/setup")'));
});

test("released report branch instant display is outside immutable snapshot values", () => {
  const report = read(remaining[10]);
  assert.ok(report.includes('doctorAccessWhere({ organizationId: account.organizationId'));
  assert.ok(report.includes('where: { id: versionId }'));
  assert.ok(report.includes('branch: { select: { timezone: true } }'));
  assert.ok(report.includes('timeZone={version.branch.timezone}'));
  assert.ok(report.includes("const snapshot = version.contentSnapshot"));
  assert.ok(report.includes("version.report.currentVersion !== version.version"));
  assert.ok(report.includes("PORTAL_RETRACTED_REPORT_VIEW_BLOCKED"));
  assert.ok(report.includes("PORTAL_REPORT_VIEWED"));
  assert.equal(formatInstantDisplay("2026-11-05T22:35:00Z", {
    dateFormat: "DD/MM/YYYY", timeFormat: "24", showSeconds: false, timeZone: "Asia/Dubai"
  }), "06/11/2026 02:35");
});

test("specimen label barcode and historical DOB on print remain byte-identical in markup", () => {
  const page = read(remaining[14]);
  assert.ok(page.includes('const dob = specimen.order.patient.dateOfBirth?.toISOString().slice(0, 10) || "—"'));
  assert.ok(page.includes('<strong>{dob}</strong>'));
  assert.ok(page.includes('aria-label={specimen.barcode}'));
  assert.ok(page.includes('code128BBars'));
  assert.ok(page.includes('className="no-print muted"'));
  assert.ok(page.includes('value={dob} kind="calendar"'));
  assert.ok(page.includes("plannedWithoutFinalizedRequirements"));
  assert.ok(page.includes('["COLLECTION_FAILED","REJECTED","DISPOSED"]'));
  assert.equal(formatCalendarDisplay("2026-11-05", "DD/MM/YYYY"), "05/11/2026");
});

test("setup error flow, saved organization time and cross-links remain safe", () => {
  const setup = read(remaining[13]);
  assert.ok(setup.includes('if (state === "saving") return'));
  assert.ok(setup.includes('method: "POST"'));
  assert.ok(setup.includes('if (response.ok)'));
  assert.ok(setup.includes("setup_already_completed"));
  assert.ok(setup.includes('setMessage(tr("Connection failed.'));
  assert.ok(setup.includes('setState("error")'));
  const settings = read(remaining[12]);
  assert.ok(settings.includes("getOrganizationSystemSettings(session.user.organizationId)"));
  assert.ok(settings.includes('timeZone={settings.timezone}'));
  assert.ok(settings.includes('<SystemSettingsDialog initial={settings} locale={locale} />'));
});
