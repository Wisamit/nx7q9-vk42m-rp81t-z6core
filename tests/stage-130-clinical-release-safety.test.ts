import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validationSpecimenCustodyError } from "../src/lib/result-validation-custody.ts";

test("Stage 130: release requires live source custody and rejects stale or wrong branch",()=>{
  const performing="performing-branch";
  for(const status of ["IN_TRANSIT","QUARANTINED","REJECTED","DISPOSED","COLLECTED","PLANNED"]){
    assert.equal(validationSpecimenCustodyError({
      status,currentBranchId:performing,performingBranchId:performing,
    }),"specimen_not_ready_for_validation",status);
  }
  for(const status of ["RECEIVED","IN_PROCESS"]){
    assert.equal(validationSpecimenCustodyError({
      status,currentBranchId:performing,performingBranchId:performing,
    }),null);
    assert.equal(validationSpecimenCustodyError({
      status,currentBranchId:"other-branch",performingBranchId:performing,
    }),"specimen_performing_branch_mismatch");
  }
});

test("Stage 130: transactional report release rechecks live locked specimen before version allocation",()=>{
  const route=readFileSync("src/app/api/results/[id]/release/route.ts","utf8");
  const ui=readFileSync("src/components/result-workflow-actions.tsx","utf8");
  const lock=route.indexOf("SELECT DISTINCT s.id, s.status, s.current_branch_id");
  const source=route.indexOf("associatedSpecimens.find(specimen => specimen.id === result.specimenId)");
  const gate=route.indexOf("validationSpecimenCustodyError({",source);
  const claim=route.indexOf("const claim = await tx.laboratoryResult.updateMany");
  const version=route.indexOf("const reportVersion = await tx.diagnosticReportVersion.create");
  assert.ok(lock>0 && source>lock && gate>source && claim>gate && version>claim,
    "release must lock and revalidate custody before editing clinical/report snapshots");
  assert.match(route,/if \(!source \|\| validationSpecimenCustodyError/);
  assert.match(route,/specimen_custody_changed_blocks_release/);
  assert.match(ui,/specimen_custody_changed_blocks_release/);
  assert.match(ui,/راجع تتبع العينة واعتماد النتيجة/);
});
