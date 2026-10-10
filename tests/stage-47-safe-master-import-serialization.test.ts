import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Stage 47: safe master commit obtains organization lock before reading mutable source rows and masters",()=>{
 const s=readFileSync("src/app/api/catalog/imports/[id]/commit/route.ts","utf8");
 const lock=s.indexOf("const ownerLock = await tx.$queryRaw");
 const reread=s.indexOf("const latestBatch = await tx.catalogImportBatch.findFirst");
 const newSafe=s.indexOf("const safeRows = latestBatch.rows.filter");
 const claim=s.indexOf("const claim = await tx.catalogImportBatch.updateMany");
 const units=s.indexOf("const units = new Map");
 assert.ok(lock>=0&&reread>lock&&newSafe>reread&&claim>newSafe&&units>claim);
 assert.match(s,/WHERE id = \$\{session\.user\.organizationId\} FOR UPDATE/);
 assert.match(s,/status: "VALIDATED"/);
 assert.match(s,/latestBatch\.sourceType === "CONFIG_BUNDLE_REVIEW"/);
 assert.match(s,/latestBatch\.sourceType === "CSV_REVIEW"/);
 assert.match(s,/results\.deferred = latestBatch\.rows\.filter/);
 assert.match(s,/latestBatch\.rows\.filter\(row =>/);
 assert.match(s,/catalog_import_no_safe_rows/);
 assert.match(s,/catalog_import_branch_scope_changed/);
 assert.match(s,/grant\.branchId === branch\.id && grant\.branch\.status === "ACTIVE"/);
 assert.match(s,/status: "IMPORTED", importedAt: new Date\(\)/);
 assert.match(s,/sameSafeMasterTestDefinition\(existing,/);
 assert.match(s,/resolvedPanelMemberships\(safeRows, testBySourceRowId, panelMap\)/);
});
