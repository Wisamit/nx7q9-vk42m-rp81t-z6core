import assert from "node:assert/strict";
import {catalogBundleAllowedSourceFields} from "../src/lib/catalog-bundle-source-boundary.ts";
import {compileF2ApplyPlan,type F2ApplyPlanRow,type F2ApplyPlan} from "../src/lib/catalog-f2-apply-plan.ts";

/**
 * Tests run the production compiler, including the complete exact field
 * contract and HMAC-adjacent SHA plan digest, before invoking SQL mutation.
 * This is synthetic test data, never a production catalog import.
 */
export function canonicalF2TestPlan(input:{
  rows:readonly F2ApplyPlanRow[];effectiveAt:string;
}):F2ApplyPlan{
  const rows=input.rows.map((row,index)=>{
    const fields=catalogBundleAllowedSourceFields[row.entityType];
    const previous=Object.fromEntries(fields.map(field=>[
      field,row.originalSnapshot[field]===undefined?null:row.originalSnapshot[field],
    ]));
    const desired=Object.fromEntries(fields.map(field=>[
      field,row.desiredSnapshot[field]===undefined?null:row.desiredSnapshot[field],
    ]));
    return {rowNumber:index+1,entityType:row.entityType,
      normalizedData:{id:row.targetId},
      sourceData:desired,scopedLiveData:previous};
  });
  const plan=compileF2ApplyPlan({rows,effectiveAt:input.effectiveAt,
    signedStageVerified:true,independentDomainApprovalsVerified:true,
    scopedLiveSnapshotVerified:true});
  assert.ok(plan,"fixture must pass the entire production plan field contract");
  assert.equal(plan.changedRows,input.rows.length);
  return plan;
}
