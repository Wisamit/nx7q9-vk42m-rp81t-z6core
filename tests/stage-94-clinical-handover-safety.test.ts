import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  ClinicalHandoverError,clinicalHandoverFingerprint,isClinicalUuid,
  parseClinicalHandoverInput,validClinicalReason,
} from "../src/lib/order-clinical-handover.ts";

const orderId=randomUUID(),key=randomUUID();
const payload={clientRequestId:key,category:"LAB_HANDOVER",language:"ar",
 body:"يجب مراجعة تاريخ سحب العينة قبل المتابعة",
 requiresAcknowledgement:true,replacesNoteId:null,correctionReason:null};
const bad=(v:unknown,code:string)=>assert.throws(
  ()=>parseClinicalHandoverInput(v),
  (e:unknown)=>e instanceof ClinicalHandoverError&&e.code===code,
);
test("Stage 94: strict normalized clinical handover contents and correction reason",()=>{
 const n=parseClinicalHandoverInput(payload);
 assert.equal(n.body,payload.body);
 assert.equal(isClinicalUuid(orderId),true);assert.equal(isClinicalUuid("bad"),false);
 assert.equal(n.requiresAcknowledgement,true);
 bad({...payload,clientRequestId:"invalid"},"invalid_idempotency_key");
 bad({...payload,language:"de"},"invalid_handover_metadata");
 bad({...payload,category:"UNSAFE"},"invalid_handover_metadata");
 bad({...payload,requiresAcknowledgement:"true"},"invalid_handover_metadata");
 bad({...payload,body:""},"invalid_handover_text");
 bad({...payload,body:"x".repeat(4001)},"invalid_handover_text");
 bad({...payload,body:"ok\u0000"},"invalid_handover_text");
 bad({...payload,replacesNoteId:"unknown"},"invalid_replaced_note");
 bad({...payload,replacesNoteId:randomUUID(),correctionReason:null},"correction_reason_required");
 bad({...payload,correctionReason:"standalone"},"unexpected_correction_reason");
 assert.equal(validClinicalReason("Correct old specimen instruction"),true);
 assert.equal(validClinicalReason("short"),false);
});
test("Stage 94: fingerprint binds the entire clinical text, order and acknowledgement state",()=>{
 const a=parseClinicalHandoverInput(payload);
 const hash=clinicalHandoverFingerprint(orderId,a);
 assert.match(hash,/^[a-f0-9]{64}$/);
 assert.equal(hash,clinicalHandoverFingerprint(orderId,a));
 assert.notEqual(hash,clinicalHandoverFingerprint(randomUUID(),a));
 assert.notEqual(hash,clinicalHandoverFingerprint(orderId,{...a,body:"تعديل"}));
 assert.notEqual(hash,clinicalHandoverFingerprint(orderId,{...a,requiresAcknowledgement:false}));
 assert.notEqual(hash,clinicalHandoverFingerprint(orderId,{...a,language:"en"}));
});
test("Stage 94: source enforces tenant-scoped active-branch locks and immutable staff-only history",()=>{
 const schema=readFileSync("prisma/schema.prisma","utf8");
 const migration=readFileSync(
  "prisma/migrations/20261012223000_order_clinical_handover/migration.sql","utf8");
 const helper=readFileSync("src/lib/order-clinical-handover.ts","utf8");
 const api=readFileSync("src/app/api/orders/[id]/clinical-handover/route.ts","utf8");
 const page=readFileSync("src/app/orders/[id]/clinical-handover/page.tsx","utf8");
 const order=readFileSync("src/app/orders/[id]/page.tsx","utf8");
 const report=readFileSync("src/lib/report-snapshot.ts","utf8");
 const portal=readFileSync("src/app/portal/reports/[versionId]/page.tsx","utf8");
 assert.match(schema,/model OrderClinicalNote \{/);
 assert.match(schema,/model OrderClinicalNoteAcknowledgement \{/);
 assert.match(schema,/@@unique\(\[organizationId, createdByUserId, clientRequestId\]/);
 assert.match(schema,/@@unique\(\[noteId, acknowledgedByUserId\]/);
 assert.match(migration,/ON DELETE RESTRICT/);
 assert.match(migration,/ocn_order_thread_revision_uq/);
 assert.match(migration,/ocna_note_user_uq/);
 assert.match(helper,/SELECT id, ordering_branch_id, status FROM orders/);
 assert.match(helper,/AND organization_id=\$\{args.organizationId\}/);
 assert.match(helper,/FOR UPDATE/);
 assert.match(helper,/activeBranchId !== order.ordering_branch_id/);
 assert.match(api,/requirePermission\("orders.view"\)/);
 assert.match(api,/rights.has\("orders.create"\)/);
 assert.match(api,/rights.has\("results.medical_validate"\)/);
 assert.match(api,/status:"SUPERSEDED"/);
 assert.match(api,/status:"RETRACTED"/);
 assert.match(api,/orderClinicalNoteAcknowledgement.create/);
 assert.match(api,/independent_acknowledgement_required/);
 assert.match(api,/isolationLevel:"Serializable"/);
 assert.match(api,/ORDER_CLINICAL_HANDOVER_ACKNOWLEDGED/);
 assert.match(api,/ORDER_CLINICAL_HANDOVER_CORRECTED/);
 assert.match(api,/ORDER_CLINICAL_HANDOVER_RETRACTED/);
 assert.match(page,/canAccessBranch\(session,order.orderingBranchId\)/);
 assert.match(page,/take:50,skip:/);
 assert.match(order,/handoverPendingAcknowledgements/);
 assert.doesNotMatch(report,/orderClinicalNote|clinicalHandoverNotes/);
 assert.doesNotMatch(portal,/orderClinicalNote|clinicalHandoverNotes/);
});
