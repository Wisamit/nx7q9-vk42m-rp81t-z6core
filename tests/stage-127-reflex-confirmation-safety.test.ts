import test from "node:test";
import assert from "node:assert/strict";
import { reflexOrderEvidenceError, type ReflexOrderEvidence } from "../src/lib/reflex-order-confirmation.ts";
import { validationSpecimenCustodyError } from "../src/lib/result-validation-custody.ts";
import { medicalApprovalEvidenceError } from "../src/lib/result-validation.ts";
import { releaseEligibility, amendmentEligibility } from "../src/lib/clinical-safety.ts";
import { parseSpecialtyLayoutPlan, specialtyPlanPreview, type SpecialtySnapshot, SpecialtyPlanError } from "../src/lib/specialty-layout-review.ts";

const base = (): ReflexOrderEvidence => ({
  sameOrganization: true, organizationId: "org", sourcePatientId: "patient", targetPatientId: "patient",
  sourceOrderingBranchId: "branch", targetOrderingBranchId: "branch",
  sourceOrderId: "source-order", targetOrderId: "next-order",
  targetItemId: "item", targetTestId: "test", ruleTargetTestId: "test",
  targetItemStatus: "ORDERED", targetOrderStatus: "REGISTERED",
  targetItemCreatedAt: new Date("2026-10-14T11:00:00Z"), reflexDetectedAt: new Date("2026-10-14T10:00:00Z"),
  invoiceStatus: "ISSUED", invoiceOrderId: "next-order", invoiceCurrency: "AED",
  invoiceLineOrderItemId: "item", invoiceLineTotal: "125.5000",
  targetItemFinalPrice: "125.5000", targetItemCurrency: "AED", invoiceLineQuantity: "1.000",
  specimenRequirementConfigured: true, activeSpecimens: [{
    specimenOrganizationId: "org", specimenOrderId: "next-order", specimenTypeId: "serum",
    requiredSpecimenTypeId: "serum", specimenStatus: "PLANNED", currentBranchId: null,
  }], explicitBillingAcknowledgement: true,
});
test("Stage 127: a properly invoiced, clinically reviewed existing order item can be linked", () => {
  for (const status of ["ISSUED", "PAID", "PARTIALLY_PAID"])
    assert.equal(reflexOrderEvidenceError({ ...base(), invoiceStatus: status }), null);
});
test("Stage 127: patient, branch, tenant, test and ordering time cannot be substituted", () => {
  const changes: Array<[Partial<ReflexOrderEvidence>,string]> = [
    [{sameOrganization:false},"reflex_target_order_identity_mismatch"],
    [{targetPatientId:"other"},"reflex_target_order_identity_mismatch"],
    [{targetOrderingBranchId:"other"},"reflex_target_order_identity_mismatch"],
    [{targetTestId:"other"},"reflex_target_test_mismatch"],
    [{targetItemStatus:"CANCELLED"},"reflex_target_order_invalid_state"],
    [{targetOrderStatus:"CANCELLED"},"reflex_target_order_invalid_state"],
    [{targetItemCreatedAt:new Date("2026-10-14T09:00:00Z")},"reflex_target_order_predates_recommendation"],
    [{explicitBillingAcknowledgement:false},"reflex_confirmation_missing_billing_acknowledgement"],
  ];
  for (const [change, error] of changes) assert.equal(reflexOrderEvidenceError({...base(),...change}),error);
});
test("Stage 127: no void/credited/fabricated invoice amount, unit or currency", () => {
  const changes: Array<[Partial<ReflexOrderEvidence>,string]> = [
    [{invoiceStatus:"VOID"},"reflex_target_invoice_not_issued"],
    [{invoiceStatus:"CREDITED"},"reflex_target_invoice_not_issued"],
    [{invoiceLineOrderItemId:"wrong-item"},"reflex_target_invoice_line_mismatch"],
    [{invoiceOrderId:"wrong-order"},"reflex_target_invoice_line_mismatch"],
    [{invoiceLineQuantity:"2.000"},"reflex_target_invoice_line_mismatch"],
    [{invoiceLineTotal:"125.5001"},"reflex_target_price_currency_mismatch"],
    [{invoiceLineTotal:"125.50001"},"reflex_target_price_currency_mismatch"],
    [{invoiceLineTotal:"not-number"},"reflex_target_price_currency_mismatch"],
    [{invoiceCurrency:"USD"},"reflex_target_price_currency_mismatch"],
    [{targetItemCurrency:"USD"},"reflex_target_price_currency_mismatch"],
  ];
  for (const [change,error] of changes) assert.equal(reflexOrderEvidenceError({...base(),...change}),error);
});
test("Stage 127: specimen identity and valid lifecycle needed when configured",()=>{
  assert.equal(reflexOrderEvidenceError({...base(),activeSpecimens:[]}),"reflex_target_specimen_plan_missing");
  for (const change of [
    {specimenOrganizationId:"other"},{specimenOrderId:"other"},{specimenTypeId:"urine"},
    {specimenStatus:"IN_TRANSIT"},{specimenStatus:"QUARANTINED"},{specimenStatus:"REJECTED"},
  ]) assert.equal(reflexOrderEvidenceError({
    ...base(),activeSpecimens:[{...base().activeSpecimens[0],...change}]
  }),"reflex_target_specimen_plan_missing");
  assert.equal(reflexOrderEvidenceError({...base(),specimenRequirementConfigured:false,activeSpecimens:[]}),null);
  assert.equal(validationSpecimenCustodyError({
    status:"IN_TRANSIT",currentBranchId:"branch",performingBranchId:"branch"
  }),"specimen_not_ready_for_validation");
});
test("Stage 127: release, critical communication and amendments preserve safety gates",()=>{
  assert.equal(releaseEligibility({
    resultStatus:"VERIFIED",qcBlocking:true,criticalCount:0,criticalEventStatus:null
  }).allowed,false);
  assert.equal(releaseEligibility({
    resultStatus:"VERIFIED",qcBlocking:false,criticalCount:1,criticalEventStatus:"OPEN"
  }).allowed,false);
  assert.equal(releaseEligibility({
    resultStatus:"VERIFIED",qcBlocking:false,criticalCount:1,criticalEventStatus:"ACKNOWLEDGED"
  }).allowed,true);
  assert.equal(amendmentEligibility({
    resultStatus:"RELEASED",hasMicrobiologySnapshot:true,newerResultExists:false
  }).allowed,false);
  assert.equal(amendmentEligibility({
    resultStatus:"RELEASED",hasMicrobiologySnapshot:false,newerResultExists:true
  }).allowed,false);
  assert.equal(medicalApprovalEvidenceError({
    policySnapshot:{source:"DEFAULT"},performingBranchId:"branch",testId:"test",departmentId:null,
    technicalReviewedByUserId:null,technicalReviewedAt:null,autoVerified:false,
    technicalReview:null,candidateUserId:"doctor"
  }),"medical_validation_policy_snapshot_invalid");
});
test("Stage 127: specialty layout does not drop or invent required active components",()=>{
  const snapshot:SpecialtySnapshot={layout:"STANDARD",testUpdatedAt:"2026-10-14T10:00:00Z",
    sections:[],components:[
      {id:"c1",code:"COLOR",sectionCode:null,entryWidth:"AUTO",entryHintEn:null,entryHintAr:null,
        status:"ACTIVE",updatedAt:"2026-10-14T10:00:00Z",resultSectionId:null,
        reportNameEn:null,reportNameAr:null,reportVisible:true,reportDisplayOrder:1},
      {id:"c2",code:"APPEARANCE",sectionCode:null,entryWidth:"AUTO",entryHintEn:null,entryHintAr:null,
        status:"ACTIVE",updatedAt:"2026-10-14T10:00:00Z",resultSectionId:null,
        reportNameEn:null,reportNameAr:null,reportVisible:true,reportDisplayOrder:2},
    ]};
  const plan={layout:"SECTIONED",sections:[{
    code:"PHYSICAL",nameEn:"Physical",nameAr:"الفيزيائي",displayOrder:1,columnCount:2,
    hintEn:"Synthetic layout",hintAr:"قالب تجريبي"
  }],components:[
    {code:"COLOR",sectionCode:"PHYSICAL",entryWidth:"STANDARD",entryHintEn:null,entryHintAr:null},
    {code:"APPEARANCE",sectionCode:"PHYSICAL",entryWidth:"STANDARD",entryHintEn:null,entryHintAr:null},
  ]};
  const parsed=parseSpecialtyLayoutPlan(plan,snapshot);
  assert.equal(parsed.components.length,2);
  assert.equal(specialtyPlanPreview(snapshot,parsed).layoutChanged,true);
  assert.throws(()=>parseSpecialtyLayoutPlan({...plan,components:plan.components.slice(0,1)},snapshot),SpecialtyPlanError);
  assert.throws(()=>parseSpecialtyLayoutPlan({...plan,components:[plan.components[0],plan.components[0]]},snapshot),SpecialtyPlanError);
});
