import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeImportRow, validateImportRow, rowValidationStatus } from "../src/lib/catalog-import.ts";

const stage = (codes: unknown) => normalizeImportRow({ entityType: "PACKAGE", data: {
  code: " DEMO_PKG ", nameEn: "Synthetic Package",
  memberTestCodes: codes as string[],
} });
test("Stage 126: complete legacy package membership cannot be inferred or silently truncated", () => {
  const good = stage([" DEMO_A ", "DEMO_B"]);
  assert.deepEqual(good.memberTestCodes, ["DEMO_A","DEMO_B"]);
  assert.equal(rowValidationStatus(validateImportRow("PACKAGE",good)), "WARNING");
  assert.ok(validateImportRow("PACKAGE",stage(["DEMO_A", " demo_a "]))
    .some(issue => issue.code === "PACKAGE_MEMBERSHIP_REQUIRED"));
  assert.ok(validateImportRow("PACKAGE",stage([]))
    .some(issue => issue.severity === "ERROR"));
  assert.ok(validateImportRow("PACKAGE",stage(["INVALID TEST SPACE"]))
    .some(issue => issue.severity === "ERROR"));
});
test("Stage 126: legacy package import is create-only inactive, tenant and department bound", () => {
  const code = readFileSync("src/app/api/catalog/imports/[id]/package-drafts/route.ts","utf8");
  for (const pattern of [/withScopedCompositeCreation/,
    /clinicalImportTestWhere\(scope\)/,
    /existing_package_requires_separate_review/,
    /package_membership_not_wholly_authorized/,
    /package_draft_claim_conflict/,
    /status: "INACTIVE", deactivatedAt: new Date\(\)/,
    /clinicalApproved: false/,
    /financialApproved: false/,
    /activated: false/,
  ]) assert.match(code,pattern);
  assert.doesNotMatch(code,/tx\.commercialPackage\.update\(/);
  assert.doesNotMatch(code,/tx\.commercialPackageItem\.deleteMany\(/);
  assert.doesNotMatch(code,/tx\.priceListPackageItem\.update\(/);
});
