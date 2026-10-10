import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  blockedComponentReviewRow, componentCsvReviewAllowed, isReviewableComponentStatus,
} from "../src/lib/component-review-disclosure.ts";

test("Stage 41 reads only eligible component staging states", () => {
  assert.equal(isReviewableComponentStatus("VALID"), true);
  assert.equal(isReviewableComponentStatus("WARNING"), true);
  for (const status of ["ERROR", "IMPORTED", "SKIPPED", "DRAFT", ""]) {
    assert.equal(isReviewableComponentStatus(status), false, status);
  }
  for (const status of ["ERROR", "IMPORTED", "SKIPPED"]) {
    const redacted = blockedComponentReviewRow({ rowNumber: 101, status });
    assert.deepEqual(redacted, {
      rowNumber: 101, rowStatus: status, candidate: null,
      disposition: "BLOCKED",
      issues: [status === "ERROR" ? "STAGED_ROW_HAS_ERRORS" : "ROW_ALREADY_PROCESSED"],
      stagedIssues: [], resolvedTestId: null, resolvedUnitId: null,
    });
  }
  assert.deepEqual(blockedComponentReviewRow({ rowNumber: 2, status: "VALID" },
    "PARENT_TEST_NOT_ACTIVE_OR_MISSING").issues, ["PARENT_TEST_NOT_ACTIVE_OR_MISSING"]);
});

test("Stage 41 clinical CSV reconciliation is source-author restricted", () => {
  assert.equal(componentCsvReviewAllowed({sourceType:"CSV_REVIEW",createdByUserId:"alice"}, "alice"), true);
  assert.equal(componentCsvReviewAllowed({sourceType:"CSV_REVIEW",createdByUserId:"alice"}, "bob"), false);
  assert.equal(componentCsvReviewAllowed({sourceType:"LEGACY_MDB_EXPORT",createdByUserId:"alice"}, "bob"), true);
});

test("Stage 41 component API gates ownership before querying candidates and redacts processed and unresolved rows", () => {
  const api=readFileSync("src/app/api/catalog/imports/[id]/components/reconcile/route.ts","utf8");
  const page=readFileSync("src/app/catalog/imports/[id]/page.tsx","utf8");
  assert.match(api,/sourceType: true, createdByUserId: true/);
  assert.match(api,/!componentCsvReviewAllowed\(batch, session\.user\.id\)/);
  assert.ok(api.indexOf("componentCsvReviewAllowed(batch") < api.indexOf("prisma.catalogImportRow.findMany"));
  assert.match(api,/isReviewableComponentStatus\(row\.status\)/);
  assert.match(api,/if \(!candidate\) return blockedComponentReviewRow\(row\)/);
  assert.match(api,/if \(!assessment\.resolvedTestId\)/);
  assert.match(api,/blockedComponentReviewRow\(row, "PARENT_TEST_NOT_ACTIVE_OR_MISSING"\)/);
  assert.match(api,/status: \{ in: \["VALID", "WARNING"\] \}/);
  assert.match(api,/take: 20001/);
  assert.match(api,/duplicateRows\.length > 20000/);
  assert.match(api,/component_review_row_limit_exceeded/);
  assert.match(api,/take: PAGE_SIZE \+ 1/);
  assert.match(api,/liveWrites: false/);
  assert.doesNotMatch(api,/testComponent\.(create|update)|catalogImportRow\.update|prisma\.\$transaction/);
  assert.match(page,/stagedRanges > 0 \|\| stagedComponents > 0/);
  assert.match(page,/batch\.createdByUserId !== session\.user\.id/);
  assert.ok(page.indexOf("stagedRanges > 0 || stagedComponents > 0") < page.indexOf("const [groups, issueRows, rows, totalRows]"));
});

test("Stage 41 component UI cannot render unbounded or posting-capable reconciliation and keeps only a current page", () => {
  const ui=readFileSync("src/components/component-import-reconciliation.tsx","utf8");
  assert.match(ui,/body\.liveWrites !== false/);
  assert.match(ui,/body\.approvalRequired !== true/);
  assert.match(ui,/body\.rows\.length > 100/);
  assert.match(ui,/setRows\(body\.rows\)/);
  assert.doesNotMatch(ui,/setRows\(current => \[\.\.\.current/);
  assert.match(ui,/loadPage\(0, \[\]\)/);
  assert.match(ui,/loadPage\(history\[history\.length - 1\], history\.slice\(0, -1\)\)/);
  assert.match(ui,/loadPage\(nextCursor, \[\.\.\.history, cursor\]\)/);
  assert.match(ui,/row\.candidate \?/);
  assert.match(ui,/row\.candidate\?\.testCode/);
  assert.match(ui,/cache: "no-store"/);
  assert.match(ui,/NOT approved for live import/);
  assert.doesNotMatch(ui,/method: "POST"|method: "PATCH"|method: "DELETE"/);
});
