import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isSafeMasterTestRow, registerPanelAlias, resolvedPanelMemberships, sameImportTestIdentity,
} from "../src/lib/catalog-panel-membership.ts";

const row = (id: string, status: string, panel: string, code: string, issues: unknown = []) => ({
  id, entityType: "TEST", status, validationIssues: issues,
  normalizedData: {panel, nameEn: "Same displayed name", code},
});

test("Stage 43 only maps eligible, individually resolved test rows; never by duplicate display name", () => {
  const safeA = row("row-a", "VALID", "Metabolic Panel", "T1");
  const safeB = row("row-b", "VALID", "Metabolic Panel", "T2");
  const invalid = row("row-invalid", "ERROR", "Metabolic Panel", "T3");
  const imported = row("row-imported", "IMPORTED", "Metabolic Panel", "T4");
  const unrelated = row("row-other", "VALID", "Metabolic Panel", "T5");
  const aliases = new Map<string,string|null>();
  registerPanelAlias(aliases, "Metabolic Panel", "panel-1");
  registerPanelAlias(aliases, "METABOLIC_PANEL", "panel-1");
  const links = resolvedPanelMemberships(
    [safeA, safeB, invalid, imported, unrelated, safeA],
    new Map([
      ["row-a", "test-a"], ["row-b", "test-b"],
      ["row-invalid", "test-invalid"], ["row-imported", "test-imported"],
    ]), aliases);
  assert.deepEqual(links, [
    {panelId:"panel-1",testId:"test-a",displayOrder:0,required:true},
    {panelId:"panel-1",testId:"test-b",displayOrder:0,required:true},
  ]);
  assert.notEqual(links[0].testId,links[1].testId);
});

test("Stage 43 generated codes are safe only with exactly the approved warning", () => {
  const approved = row("generated", "WARNING", "Metabolic Panel", "GENERATED",
    [{code:"GENERATED_TEST_CODE",severity:"WARNING"}]);
  assert.equal(isSafeMasterTestRow(approved),true);
  assert.deepEqual(resolvedPanelMemberships([approved],new Map([["generated","safe-test"]]),
    new Map([["METABOLIC PANEL","panel"]])),[
    {panelId:"panel",testId:"safe-test",displayOrder:0,required:true},
  ]);
  for (const issues of [[],[{code:"GENERATED_TEST_CODE"},{code:"OTHER"}],
    [{code:"DUPLICATE_TEST_CODE"}],null,[{code:"ERROR"}]]) {
    assert.equal(isSafeMasterTestRow({...approved,validationIssues:issues}),false);
  }
  for(const status of ["SKIPPED","IMPORTED","ERROR","DRAFT"]){
    assert.equal(isSafeMasterTestRow({...approved,status}),false);
  }
});

test("Stage 43 conflicting name/code aliases fail closed without picking arbitrary panels", () => {
  const aliases = new Map<string,string|null>();
  registerPanelAlias(aliases,"Panel Alpha","p1");
  registerPanelAlias(aliases,"PANEL_ALPHA","p2");
  registerPanelAlias(aliases,"Panel Alpha","p3");
  assert.equal(aliases.get("PANEL ALPHA"),null);
  assert.deepEqual(resolvedPanelMemberships([row("r","VALID","Panel Alpha","T1")],
    new Map([["r","t1"]]),aliases),[]);
  const safe = new Map<string,string|null>([["PANEL ALPHA","p1"],["PANEL_ALPHA","p2"]]);
  assert.deepEqual(resolvedPanelMemberships([row("r","VALID","Panel Alpha","T1")],
    new Map([["r","t1"]]),safe),[]);
  assert.equal(sameImportTestIdentity("Exact test","exact test"),true);
  assert.equal(sameImportTestIdentity("Other test","exact test"),false);
  assert.equal(sameImportTestIdentity("", "exact test"),false);
});

test("Stage 43 commit uses source-row identity, never untrusted test-name-based joins", () => {
  const s=readFileSync("src/app/api/catalog/imports/[id]/commit/route.ts","utf8");
  assert.match(s,/isSafeMasterTestRow\(row\)/);
  assert.match(s,/const testBySourceRowId = new Map<string, string>\(\)/);
  assert.match(s,/testBySourceRowId\.set\(row\.id, existing\.id\)/);
  assert.match(s,/testBySourceRowId\.set\(row\.id, created\.id\)/);
  // Stage 44 strengthens the existing-name check to a full clinical definition comparison.
  assert.match(s,/sameSafeMasterTestDefinition\(existing,/);
  assert.match(s,/sameImportTestIdentity\(existingPanel\.nameEn, nameEn\)/);
  assert.match(s,/resolvedPanelMemberships\(safeRows, testBySourceRowId, panelMap\)/);
  assert.match(s,/registerPanelAlias\(panelMap, nameEn, panel\.id\)/);
  assert.doesNotMatch(s,/testByLegacyName|row\.importedEntityId \|\| testByLegacyName/);
  assert.match(s,/tx\.testPanelItem\.createMany\(\{ data: panelMemberships, skipDuplicates: true \}\)/);
  assert.match(s,/tx\.catalogImportBatch\.updateMany\(/);
  assert.match(s,/batch\.sourceType === "CSV_REVIEW"/);
});
