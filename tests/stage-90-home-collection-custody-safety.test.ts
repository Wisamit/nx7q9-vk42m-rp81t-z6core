import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homeOrderMatch, homeCollectionStartError, homeCollectionCustodyError,
  type HomeSpecimenEvidence, type HomeFinancialEvidence } from "../src/lib/home-collection-custody.ts";

const match = {
  orderOrganizationId:"org", visitOrganizationId:"org",
  orderPatientId:"patient", visitPatientId:"patient",
  orderingBranchId:"branch",visitBranchId:"branch",
  orderStatus:"REGISTERED",visitStatus:"ASSIGNED",
  hasSpecimens:true,specimensAllPlanned:true,hasOrderItems:true,alreadyLinked:false,
};
const visit = {id:"visit",orderId:"order",branchId:"branch",
  assignedCollectorUserId:"collector",status:"COLLECTING"};
const invoice: HomeFinancialEvidence = {status:"ISSUED",currency:"EGP",
  total:"350.0000",paidAmount:"0.0000",balanceAmount:"350.0000"};
const specimen: HomeSpecimenEvidence={
  id:"specimen",barcode:"BARCODE1",status:"COLLECTED",parentRelationType:null,
  collectionAttempts:[{outcome:"SUCCESS",homeCollectionVisitId:"visit",
    collectionLocationType:"HOME",collectorUserId:"collector"}],
  receptionAssessments:[],
};
test("Stage 90: strictly link same patient, tenant, branch and active order with immutable one-to-one lineage",()=>{
  assert.equal(homeOrderMatch(match),null);
  assert.equal(homeOrderMatch({...match,orderPatientId:"other"}),"home_order_patient_branch_mismatch");
  assert.equal(homeOrderMatch({...match,orderOrganizationId:"other"}),"home_order_patient_branch_mismatch");
  assert.equal(homeOrderMatch({...match,orderingBranchId:"other"}),"home_order_patient_branch_mismatch");
  assert.equal(homeOrderMatch({...match,alreadyLinked:true}),"home_order_already_linked_elsewhere");
  assert.equal(homeOrderMatch({...match,orderStatus:"CANCELLED"}),"home_order_not_active");
  assert.equal(homeOrderMatch({...match,visitStatus:"COLLECTING"}),"home_visit_too_advanced_to_link");
  assert.equal(homeOrderMatch({...match,hasSpecimens:false}),"home_order_specimens_not_ready");
  assert.equal(homeOrderMatch({...match,specimensAllPlanned:false}),"home_order_specimens_not_ready");
  assert.equal(homeOrderMatch({...match,orderStatus:"COLLECTED"}),"home_order_not_active");
  assert.equal(homeOrderMatch({...match,hasOrderItems:false}),"home_order_specimens_not_ready");
});
test("Stage 90: no home draw before priced order and assigned collector",()=>{
  assert.equal(homeCollectionStartError(visit,1,[invoice]),null);
  assert.equal(homeCollectionStartError({...visit,orderId:null},1,[invoice]),"home_order_link_required");
  assert.equal(homeCollectionStartError({...visit,assignedCollectorUserId:null},1,[invoice]),"home_collector_required");
  assert.equal(homeCollectionStartError(visit,0,[invoice]),"home_specimens_required");
  assert.equal(homeCollectionStartError(visit,1,[]),"home_issued_invoice_required");
  assert.equal(homeCollectionStartError(visit,1,[{...invoice,status:"DRAFT"}]),"home_issued_invoice_required");
  assert.equal(homeCollectionStartError(visit,1,[{...invoice,status:"VOID"}]),"home_issued_invoice_required");
  assert.equal(homeCollectionStartError(visit,1,[{...invoice,status:"CREDITED"}]),"home_issued_invoice_required");
});
test("Stage 90: delivered requires accepted per-barcode reception for every physical sample",()=>{
  assert.equal(homeCollectionCustodyError(visit,"COLLECTED",[specimen],[invoice]),null);
  assert.equal(homeCollectionCustodyError(visit,"DELIVERED",[specimen],[invoice]),
    "home_specimen_reception_evidence_missing");
  const received={...specimen,status:"RECEIVED",receptionAssessments:[{branchId:"branch"}]};
  assert.equal(homeCollectionCustodyError(visit,"DELIVERED",[received],[invoice]),null);
  assert.equal(homeCollectionCustodyError(visit,"DELIVERED",[received,{...received,id:"second",barcode:"B2",
    collectionAttempts:[]}],[invoice]),"home_specimen_collection_evidence_missing");
  assert.equal(homeCollectionCustodyError(visit,"DELIVERED",[received,{...received,
    receptionAssessments:[{branchId:"other"}]}],[invoice]),"home_specimen_reception_evidence_missing");
  assert.equal(homeCollectionCustodyError(visit,"COLLECTED",[{...specimen,status:"PLANNED"}],[invoice]),
    "home_specimen_not_collected");
  assert.equal(homeCollectionCustodyError(visit,"COLLECTED",[{...specimen,
    collectionAttempts:[{...specimen.collectionAttempts[0],collectorUserId:"other"}]}],[invoice]),
    "home_specimen_collection_evidence_missing");
  assert.equal(homeCollectionCustodyError(visit,"COLLECTED",[{...specimen,
    collectionAttempts:[{...specimen.collectionAttempts[0],homeCollectionVisitId:"other"}]}],[invoice]),
    "home_specimen_collection_evidence_missing");
  assert.equal(homeCollectionCustodyError(visit,"COLLECTED",[{...specimen,status:"QUARANTINED"}],[invoice]),
    "home_specimen_not_collected");
  assert.equal(homeCollectionCustodyError(visit,"DELIVERED",[received,{...received,id:"aliquot",
    parentRelationType:"ALIQUOT",collectionAttempts:[],receptionAssessments:[]}],[invoice]),null);
});
test("Stage 90: full operational workflow spans schema, approved LIS order, home phlebotomy, lab receipt, invoice and bilingual UI",()=>{
  const read=(p:string)=>readFileSync(p,"utf8");
  const schema=read("prisma/schema.prisma"),migration=read("prisma/migrations/20261012150000_home_collection_order_custody/migration.sql");
  const link=read("src/app/api/home-collections/[id]/order/route.ts");
  const transition=read("src/app/api/home-collections/[id]/route.ts");
  const draw=read("src/app/api/specimens/[id]/collection-attempts/route.ts");
  const card=read("src/components/phlebotomy-collection-card.tsx");
  const phleb=read("src/app/phlebotomy/page.tsx");
  const page=read("src/app/home-collections/[id]/page.tsx");
  const board=read("src/app/home-collections/page.tsx");
  const station=read("src/components/home-collection-workstation.tsx");
  const nav=read("src/components/system-shell.tsx");
  assert.match(schema,/orderId\s+String\?\s+@unique @map\("order_id"\)/);
  assert.match(schema,/homeCollectionVisitId\s+String\?\s+@map\("home_collection_visit_id"\)/);
  assert.match(migration,/UNIQUE INDEX.*order_id_key/);
  assert.match(migration,/FOREIGN KEY.*order_id/);
  assert.match(migration,/FOREIGN KEY.*home_collection_visit_id/);
  assert.match(link,/requirePermission\("home_collection\.manage"\)/);
  assert.match(link,/orders\.view/);
  assert.match(link,/homeOrderMatch/);
  assert.match(link,/SELECT id FROM appointments[\s\S]*FOR UPDATE/);
  assert.match(link,/SELECT id FROM orders[\s\S]*FOR UPDATE/);
  assert.match(link,/homeCollectionVisit\.updateMany/);
  assert.match(link,/HOME_COLLECTION_ORDER_LINKED/);
  assert.match(link,/isolationLevel: "Serializable"/);
  assert.match(transition,/homeCollectionCustodyError/);
  assert.match(transition,/homeCollectionStartError/);
  assert.match(transition,/\["EN_ROUTE","COLLECTING"\]/);
  assert.match(transition,/COLLECTOR_REASSIGNMENT_AFTER_DISPATCH_FORBIDDEN/);
  assert.match(transition,/receptionAssessments/);
  assert.match(transition,/SELECT id FROM home_collection_visits[\s\S]*FOR UPDATE/);
  assert.match(transition,/HOME_SPECIMEN_RECEPTION_EVIDENCE_MISSING/);
  assert.match(transition,/specimenCustodyVerified/);
  assert.match(draw,/suppliedHomeVisitId/);
  assert.match(draw,/home_collection_visit_custody_required/);
  assert.match(draw,/await lockHomeCustody\(tx\)/);
  assert.match(draw,/homeCollectionVisitId: linkedHomeVisit\?\.id \|\| null/);
  assert.match(card,/homeCollectionVisitId: specimen\.homeCollectionVisitId/);
  assert.match(phleb,/homeCollectionVisit: \{ include:/);
  assert.match(page,/HomeCollectionWorkstation/);
  assert.match(page,/invoices:/);
  assert.match(page,/branchId: \{ in: branchIds \}/);
  assert.match(board,/assignedCollectorUserId: session\.user\.id/);
  assert.match(board,/take: 101/);
  assert.match(station,/\/api\/home-collections/);
  assert.match(nav,/href: "\/home-collections"/);
});
