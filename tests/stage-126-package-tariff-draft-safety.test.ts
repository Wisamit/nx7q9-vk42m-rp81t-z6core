import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeImportRow, rowValidationStatus, validateImportRow } from "../src/lib/catalog-import.ts";

const route = readFileSync("src/app/api/catalog/imports/[id]/package-price-drafts/route.ts", "utf8");
test("Stage 126: imported composite tariffs are staged for review and never go live", () => {
  const d = normalizeImportRow({ entityType: "PRICE_LIST_PACKAGE_ITEM", data: {
    priceListCode: " PUBLIC ", packageCode: " CBC_PROFILE ",
    unitPrice: "999.1234", effectiveFrom: "2027-02-01",
  } });
  assert.equal(d.priceListCode, "PUBLIC");
  assert.equal(d.packageCode, "CBC_PROFILE");
  assert.equal(d.unitPrice, "999.1234");
  const issues = validateImportRow("PRICE_LIST_PACKAGE_ITEM", d);
  assert.equal(rowValidationStatus(issues), "WARNING");
  assert.ok(issues.some(i => i.code === "PACKAGE_TARIFF_APPROVAL_REQUIRED"));
  assert.ok(validateImportRow("PRICE_LIST_PACKAGE_ITEM", { ...d, unitPrice: "999.12345" })
    .some(i => i.severity === "ERROR"));
});
test("Stage 126: package draft rechecks live finance, clinical members, currency and windows", () => {
  for (const pattern of [
    /permissionSet\(session\)\.has\("catalog\.manage"\)/,
    /pricing_permission_revoked/,
    /withScopedCompositeCreation/,
    /clinicalImportTestWhere\(scope\)/,
    /some: \{\}, every:/,
    /sourceId: null, referrerId: null, clientId: null, contractId: null/,
    /staged_package_tariff_overlap/,
    /existing_package_tariff_window_overlap/,
    /updateMany/,
    /new Prisma\.Decimal/,
    /status: "INACTIVE"/,
    /financialApproved: false, activated: false/,
    /historicalInvoicesChanged: false/,
  ]) assert.match(route, pattern);
  for (const pattern of [/\.priceListPackageItem\.update\(/,
    /\.invoice\.update\(/, /\.priceListPackageItem\.deleteMany\(/])
    assert.doesNotMatch(route, pattern);
});
