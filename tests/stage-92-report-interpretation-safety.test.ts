import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  InterpretationError, interpretationFingerprint, interpretationReviewError,
  parseInterpretationDecision, parseInterpretationDraft,
} from "../src/lib/report-interpretation.ts";

const org=randomUUID(), order=randomUUID(), author=randomUUID(),reviewer=randomUUID(),id=randomUUID();
const data={id,organizationId:org,orderId:order,revisionNumber:1,
  status:"DRAFT" as const, textEn:"Clinically reviewed interpretive statement",
  textAr:"بيان تفسيري سريري تمت مراجعته",supersedesCommentId:null,
  createdByUserId:author,createdAt:new Date("2026-10-12T08:00:00Z")};
const fingerprint=interpretationFingerprint(data);
const fails=(fn:()=>unknown,code:string)=>assert.throws(fn,
  (error:unknown)=>error instanceof InterpretationError && error.code===code);

test("Stage 92: approved report interpretations require strict bilingual text",()=>{
  assert.deepEqual(parseInterpretationDraft({orderId:order,textEn:data.textEn,textAr:data.textAr}),
    {orderId:order,textEn:data.textEn,textAr:data.textAr});
  fails(()=>parseInterpretationDraft({orderId:order,textEn:"ok",textAr:""}),"invalid_textAr");
  fails(()=>parseInterpretationDraft({orderId:order,textEn:"",textAr:"ok"}),"invalid_textEn");
  fails(()=>parseInterpretationDraft({orderId:order,textEn:"x".repeat(5001),textAr:"ok"}),"invalid_textEn");
  fails(()=>parseInterpretationDraft({orderId:"bad",textEn:"ok",textAr:"ok"}),"invalid_order");
  fails(()=>parseInterpretationDraft({orderId:order,textEn:"ok\u0000",textAr:"ok"}),"invalid_textEn");
  fails(()=>parseInterpretationDraft([]),"invalid_request");
});

test("Stage 92: exact fingerprint, independent author/reviewer and controlled retirement",()=>{
  assert.equal(interpretationReviewError(data,reviewer,fingerprint,null),null);
  assert.equal(interpretationReviewError(data,author,fingerprint,null),"independent_reviewer_required");
  assert.equal(interpretationReviewError(data,reviewer,"0".repeat(64),null),"interpretation_stale");
  assert.equal(interpretationReviewError({...data,status:"APPROVED"},reviewer,fingerprint,null),"interpretation_not_draft");
  assert.notEqual(interpretationFingerprint({...data,textAr:"تعديل"}),fingerprint);
  assert.notEqual(interpretationFingerprint({...data,createdByUserId:reviewer}),fingerprint);
  assert.notEqual(interpretationFingerprint({...data,revisionNumber:2}),fingerprint);
  const next={...data,revisionNumber:2,supersedesCommentId:randomUUID()};
  assert.equal(interpretationReviewError(next,reviewer,interpretationFingerprint(next),null),
    "interpretation_predecessor_changed");
  assert.equal(interpretationReviewError(next,reviewer,interpretationFingerprint(next),
    {id:next.supersedesCommentId!,status:"RETIRED",orderId:order}),"interpretation_predecessor_changed");
  assert.equal(interpretationReviewError(next,reviewer,interpretationFingerprint(next),
    {id:next.supersedesCommentId!,status:"APPROVED",orderId:order}),null);
  const approved=parseInterpretationDecision({id,expectedFingerprint:fingerprint,
    decision:"APPROVE",reason:"Reviewed the exact bilingual wording and target order",
    confirmation:"APPROVE_EXACT_BILINGUAL_REPORT_INTERPRETATION"});
  assert.equal(approved.decision,"APPROVE");
  fails(()=>parseInterpretationDecision({...approved,confirmation:"bad"}),"explicit_clinical_approval_required");
  fails(()=>parseInterpretationDecision({...approved,reason:"bad"}),"interpretation_reason_required");
});

test("Stage 92: clinical write, review and release respect immutable tenant-scoped report snapshots",()=>{
  const schema=readFileSync("prisma/schema.prisma","utf8");
  const migration=readFileSync("prisma/migrations/20261012180000_report_interpretation_governance/migration.sql","utf8");
  const api=readFileSync("src/app/api/reports/interpretations/route.ts","utf8");
  const snapshot=readFileSync("src/lib/report-snapshot.ts","utf8");
  const release=readFileSync("src/app/api/results/[id]/release/route.ts","utf8");
  const report=readFileSync("src/app/reports/[orderId]/page.tsx","utf8");
  const page=readFileSync("src/app/reports/[orderId]/interpretation/page.tsx","utf8");
  const ui=readFileSync("src/components/report-interpretation-manager.tsx","utf8");
  assert.match(schema,/model ReportInterpretiveComment \{/);
  assert.match(schema, /@@unique\(\[orderId, revisionNumber\], map: "ric_order_revision_uq"\)/);
  assert.match(migration,/FOREIGN KEY \(`order_id`\)/);
  assert.match(migration,/ON DELETE RESTRICT/);
  assert.match(api,/rights\.has\("results\.medical_validate"\)/);
  assert.match(api,/rights\.has\("results\.release"\)/);
  assert.match(api,/rights\.has\("reports\.view"\)/);
  assert.match(api,/FROM orders WHERE id=\$\{orderId\}[\s\S]*FOR UPDATE/);
  assert.match(api,/canAccessBranch\(session,order\.orderingBranchId\)/);
  assert.match(api,/authorizedDepartmentIds\(session\)/);
  assert.match(api,/order\.items\.some/);
  assert.match(api,/review_pending_for_order/);
  assert.match(api,/interpretationReviewError\(note,session\.user\.id/);
  assert.match(api,/status:"RETIRED"/);
  assert.match(api,/status:nextStatus/);
  assert.match(api,/REPORT_INTERPRETATION_INDEPENDENTLY_APPROVED/);
  assert.match(api,/REPORT_INTERPRETATION_SUPERSEDED/);
  assert.match(api,/isolationLevel:"Serializable"/);
  assert.match(snapshot,/where: \{ status: "APPROVED" \}/);
  assert.match(release,/lockedOrderForInterpretation/);
  assert.match(release,/SELECT id FROM orders[\s\S]*FOR UPDATE/);
  assert.match(snapshot,/reportInterpretation: order\.interpretiveComments\[0\]/);
  assert.match(report,/snapshot\.reportInterpretation/);
  assert.match(report,/showEnglish.*snapshot\.reportInterpretation\.textEn/);
  assert.match(report,/showArabic.*snapshot\.reportInterpretation\.textAr/);
  assert.match(page,/requirePermission\("reports\.view"\)/);
  assert.match(page,/canAccessBranch\(session,order\.orderingBranchId\)/);
  assert.match(ui,/APPROVE_EXACT_BILINGUAL_REPORT_INTERPRETATION/);
  assert.match(ui,/only newly issued report snapshots/);
});
