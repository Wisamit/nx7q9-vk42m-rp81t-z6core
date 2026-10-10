import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fitsSafeMasterIdentity, registerSafeMasterUnitAlias, resolveSafeMasterUnitAlias,
  sameSafeMasterTestDefinition,
} from "../src/lib/catalog-safe-master-units.ts";

const definition = {
  nameEn: "Glucose", status: "ACTIVE", defaultUnitId: "unit-mg",
  assay: "Method A", collectionInstructions: "Morning",
  methodId: null, specimenTypeId: null, containerId: null,
  resultType: "NUMERIC", workflowType: "GENERAL",
};
const source = { nameEn: "glucose", unitId: "unit-mg", assay: "Method A", collection: "Morning" };

test("Stage 44: unit codes and symbols resolve only when unambiguous, regardless of insertion order", () => {
  for (const ids of [["first", "second"], ["second", "first"]]) {
    const aliases = new Map<string, string | null>();
    registerSafeMasterUnitAlias(aliases, "MG", ids[0]);
    registerSafeMasterUnitAlias(aliases, "mg/dL", ids[0]);
    registerSafeMasterUnitAlias(aliases, "GLUCOSE_UNIT", ids[1]);
    registerSafeMasterUnitAlias(aliases, " mg/dL ", ids[1]);
    registerSafeMasterUnitAlias(aliases, "mg/dl", ids[0]);
    assert.deepEqual(resolveSafeMasterUnitAlias(aliases, "mg/dL"), {
      ok: false, reason: "UNKNOWN_OR_AMBIGUOUS_TEST_UNIT",
    });
    assert.deepEqual(resolveSafeMasterUnitAlias(aliases, " mg "), {ok: true, unitId: ids[0]});
    assert.deepEqual(resolveSafeMasterUnitAlias(aliases, "GLUCOSE_UNIT"), {ok: true, unitId: ids[1]});
    assert.deepEqual(resolveSafeMasterUnitAlias(aliases, "unmapped"), {
      ok: false, reason: "UNKNOWN_OR_AMBIGUOUS_TEST_UNIT",
    });
    assert.deepEqual(resolveSafeMasterUnitAlias(aliases, " "), {ok: true, unitId: null});
  }
});

test("Stage 44: same code and test name cannot override incompatible clinical definition", () => {
  assert.equal(sameSafeMasterTestDefinition(definition, source), true);
  for (const variant of [
    {defaultUnitId: "unit-mmol"}, {defaultUnitId: null}, {assay: "Method B"},
    {collectionInstructions: "Evening"}, {status: "INACTIVE"},
    {methodId: "method"}, {specimenTypeId: "specimen"}, {containerId: "container"},
    {resultType: "QUALITATIVE"}, {workflowType: "MICROBIOLOGY"},
    {nameEn: "Another test"},
  ]) {
    assert.equal(sameSafeMasterTestDefinition({...definition, ...variant},source), false);
  }
  assert.equal(sameSafeMasterTestDefinition(definition, {...source,unitId:null}),false);
  assert.equal(sameSafeMasterTestDefinition(definition, {...source,assay:"Method B"}),false);
  assert.equal(sameSafeMasterTestDefinition(definition, {...source,collection:"Evening"}),false);
});

test("Stage 44: no truncation of stable master identities", () => {
  assert.equal(fitsSafeMasterIdentity("C".repeat(80),"N".repeat(200),80,200),true);
  assert.equal(fitsSafeMasterIdentity("C".repeat(81),"N",80,200),false);
  assert.equal(fitsSafeMasterIdentity("CODE","N".repeat(201),80,200),false);
  assert.equal(fitsSafeMasterIdentity("","NAME",80,200),false);
});

test("Stage 44: commit route uses bounded, tenant-scoped unit resolution and fails closed", () => {
  const route=readFileSync("src/app/api/catalog/imports/[id]/commit/route.ts","utf8");
  assert.match(route,/registerSafeMasterUnitAlias\(units, existing\.code, existing\.id\)/);
  assert.match(route,/registerSafeMasterUnitAlias\(units, existing\.symbol, existing\.id\)/);
  assert.match(route,/resolveSafeMasterUnitAlias\(units, text\(n\.unit\)\)/);
  assert.match(route,/sameSafeMasterTestDefinition\(existing,/);
  assert.match(route,/defaultUnitId: sourceUnit\.unitId/);
  assert.match(route,/!sourceUnit\.ok/);
  assert.match(route,/fitsSafeMasterIdentity\(code, nameEn, 80, 200\)/);
  assert.match(route,/organizationId: session\.user\.organizationId/);
  assert.doesNotMatch(route,/units\.get\(unitText\)\s*\|\|\s*null/);
  assert.match(route,/resolvedPanelMemberships\(safeRows, testBySourceRowId, panelMap\)/);
});
