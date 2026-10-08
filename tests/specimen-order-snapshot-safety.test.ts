import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("new orders finalize specimen requirements from an immutable order-registration snapshot", () => {
  const orderRoute = source("src/app/api/orders/route.ts");
  assert.match(orderRoute, /buildSpecimenPlans\(specimenRequirementInputs\)/);
  assert.match(orderRoute, /requirementSource:\s*"ORDER_REGISTRATION_SNAPSHOT"/);
  assert.match(orderRoute, /specimenRequirementEventDetails\(plan/);
});

test("legacy finalization never re-reads current catalog requirements", () => {
  const finalizeRoute = source("src/app/api/orders/[id]/specimen-requirements/finalize/route.ts");
  assert.doesNotMatch(finalizeRoute, /minimumVolume/);
  assert.doesNotMatch(finalizeRoute, /collectionInstructions/);
  assert.doesNotMatch(finalizeRoute, /storageConditions/);
  assert.match(finalizeRoute, /order_time_specimen_requirement_snapshot_missing/);
  assert.match(finalizeRoute, /Current catalog values are not substituted/);
});

test("specimen reception validates against the captured expected container", () => {
  const receptionRoute = source("src/app/api/specimens/[id]/actions/route.ts");
  assert.match(receptionRoute, /specimenRequirementSnapshotFromDetails/);
  assert.match(receptionRoute, /const expectedContainerCode = requirementSnapshot\.containerCode/);
  assert.doesNotMatch(receptionRoute, /expectedContainerCode:\s*specimen\.container\?\.code/);
});
