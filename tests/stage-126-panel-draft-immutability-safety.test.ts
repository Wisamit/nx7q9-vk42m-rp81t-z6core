import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Stage 126: legacy profile admission cannot rewrite or autoactivate existing panel memberships", () => {
  const source = readFileSync("src/app/api/catalog/imports/[id]/commit/route.ts", "utf8");
  assert.match(source, /if \(!existingPanel && fitsSafeMasterIdentity/);
  assert.match(source, /status: "INACTIVE", deactivatedAt: new Date\(\)/);
  assert.match(source, /EXISTING_OR_INVALID_PANEL_PENDING_REVIEW/);
  assert.match(source, /resolvedPanelMemberships\(safeRows, testBySourceRowId, panelMap\)/);
  assert.doesNotMatch(source, /sameImportTestIdentity\(/);
  assert.doesNotMatch(source, /tx\.testPanelItem\.deleteMany/);
  assert.doesNotMatch(source, /tx\.testPanel\.update\(/);
});
