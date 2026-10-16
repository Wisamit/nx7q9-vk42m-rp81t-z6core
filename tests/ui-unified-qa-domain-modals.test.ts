import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(file: string) { return readFileSync(file, "utf8"); }

test("UI #265: protected procurement, QC, quality, notification, retention and send-out forms use compact modal triggers", () => {
  const cases = {
    "procurement-manager": ["createRequest", "createOrder"],
    "qc-manager": ["createMaterial", "createLot", "createTarget", "createRun"],
    "notification-center-actions": ["createTemplate"],
    "specimen-retention-manager": ["createPolicy", "requestDisposal"],
    "send-out-manager": ["createLab", "createReferral"],
    "quality-management-console": ["createNonconformance", "createCapa", "createDocument",
      "createTraining", "createCompetency", "grantAuthorization", "createIndicator", "createAudit"],
  };
  for (const [moduleName, names] of Object.entries(cases)) {
    const source = read("src/components/" + moduleName + ".tsx");
    assert.ok(source.includes('import { CrudModal } from "@/components/crud-modal"'),
      moduleName + " must import shared modal");
    assert.equal((source.match(/<CrudModal\b/g) || []).length,
      names.length + (["quality-management-console", "qc-manager", "send-out-manager"].includes(moduleName) ? 1 : 0), moduleName);
    if (moduleName === "qc-manager") {
      assert.ok(source.includes('open={resolutionId!==null}'),
        "QC violation resolution has its own audited compact review dialog");
    }
    if (moduleName === "quality-management-console") {
      assert.ok(source.includes('open={pendingReview!==null}'),
        "Specialty QMS governance modal is separate from the eight create editors");
    }
    for (const name of names) {
      const marker = '<form className="catalog-form" onSubmit={' + name + '}>';
      const start = source.indexOf(marker);
      assert.ok(start >= 0, name + " form must remain accessible");
      const modal = source.lastIndexOf("<CrudModal", start);
      const close = source.indexOf("</CrudModal>", start);
      assert.ok(modal >= 0 && close > start, name + " form must be inside the dialog");
      const wrapper = source.slice(modal, start);
      assert.ok(wrapper.includes('size="compact"'), name + " modal should use compact size");
      assert.ok(wrapper.includes("uiEditor === "), name + " should mount form only when open");
      assert.ok(source.slice(start, close).includes("</form>"), name + " must remain a complete form");
    }
    assert.ok(
      moduleName === "notification-center-actions"
        ? source.includes('if (!submitting.current) setUiEditor("")')
        : ["procurement-manager", "qc-manager", "quality-management-console"].includes(moduleName)
          ? source.includes('if (!submitting.current && !busy) setUiEditor("")')
          : source.includes('if (!busy) setUiEditor("")'),
      moduleName + " must refuse dismissing a modal during an in-flight mutation",
    );
  }
});

test("UI #265: all nine EQA actions use role-gated review dialogs, with custody separate", () => {
  const sendOut = read("src/components/send-out-manager.tsx");
  const eqa = read("src/components/eqa-workspace.tsx");
  assert.ok(sendOut.includes('open={review !== null}'),
    "send-out dispatch/receipt/verification/cancel actions must use a dedicated custody review dialog");
  assert.ok(sendOut.includes('onSubmit={confirmReview}'));
  assert.ok(sendOut.includes('current.specimenBarcode'));
  assert.ok(sendOut.includes('referral.status === "RESULT_RECEIVED" && canVerify'));
  assert.ok(sendOut.includes('const success = await act(referral.id, action, payload)'));
  assert.ok(sendOut.includes('if (success) setReview(null)'));
  assert.ok(sendOut.includes('Documented cancellation reason required.'));
  assert.equal((eqa.match(/<CrudModal\b/g) || []).length, 9);
  assert.equal((eqa.match(/<form\b/g) || []).length, 9);
  assert.ok(!/\bconfirm\s*\(/.test(eqa),
    "EQA uses typed, explicit action dialogs, not browser-native confirmations");
  for (const action of ["CREATE_PROGRAM", "CREATE_ROUND", "ADD_OBSERVATION",
    "SUBMIT_ROUND", "FINALIZE_REVIEW", "CLOSE_ROUND", "REMOVE_OBSERVATION",
    "ASSESS_OBSERVATION", "DEACTIVATE_PROGRAM"]) {
    assert.ok(eqa.includes('send("' + action + '"'),
      "Each governed server action must retain its original request payload: " + action);
  }
  assert.ok(eqa.includes('currentRound.submittedByUserId!==actorId'));
  assert.ok(eqa.includes('o.createdByUserId!==actorId'));
  assert.ok(eqa.includes('currentRound.reviewedByUserId===actorId'));
  assert.ok(eqa.includes('setEditor("");'));
  assert.ok(eqa.includes('if(!busy)setEditor("")'));
  const quality = read("src/components/quality-management-console.tsx");
  assert.ok(quality.includes("confirmQualityReview"), "quality actions require a governed review form");
  assert.ok(quality.includes("openReview({kind:"));
  assert.ok(!/window\.(?:prompt|confirm)\s*\(/.test(quality),
    "quality lifecycle transitions must not use bare browser prompts");
  for (const action of ["NC_STATUS", "CAPA_ACTION_CREATE", "CAPA_ACTION_COMPLETE",
    "CAPA_EFFECTIVENESS", "DOCUMENT_VERSION_CREATE", "DOCUMENT_WORKFLOW",
    "ANALYZER_REVOKE", "INDICATOR_MEASUREMENT", "AUDIT_FINDING_CREATE",
    "AUDIT_FINDING_CLOSE", "AUDIT_COMPLETE"]) {
    assert.ok(quality.includes('"' + action + '"'), "Governed transition missing: " + action);
  }
  assert.ok(quality.includes('reviewSeverity==="CRITICAL"'));
  assert.ok(quality.includes('openCapas.some(item => item.id === capaId)'));
  assert.ok(quality.includes('pendingReview.close'));
  assert.ok(quality.includes('setPendingReview(null)'));
});


test("UI #265: send-out laboratory and referral drafts are failure-safe and preserve custody context", () => {
  const src = read("src/components/send-out-manager.tsx");
  for (const handler of ["createLab", "createReferral"]) {
    const start = src.indexOf("async function " + handler + "(");
    const end = src.indexOf("\n  }", start);
    assert.ok(start >= 0 && end > start, handler);
    const body = src.slice(start, end);
    assert.ok(body.includes("if (busy) return;"));
    assert.ok(body.includes("try {"));
    assert.ok(body.includes("catch {"));
    assert.ok(body.includes("finally {"));
    assert.ok(body.includes("if (!response.ok)"));
    assert.ok(body.includes('setUiEditor("");'), "close modal only after server success");
    assert.ok(body.includes("router.refresh()"));
    assert.doesNotMatch(body, /event\.currentTarget\.reset\(\)/,
      "async handler cannot use reset() on an expired React currentTarget");
  }
  assert.ok(src.includes("Verify the specimen's referral history before any retry"));
  assert.ok(src.includes("branchId: candidate.branchId"));
  assert.ok(src.includes("orderItemId: candidate.orderItemId"));
  assert.ok(src.includes("specimenId: candidate.specimenId"));
  assert.ok(src.includes("costCurrency: form.get"));
  assert.ok(src.includes("externalLaboratoryId: form.get"));
});

test("UI #265: one-time integration secret removed from public page after dialog close", () => {
  const source = read("src/components/integration-manager.tsx");
  assert.ok(source.includes('uiDialog === "key" && secret'));
  assert.ok(source.includes('setSecret(""); setUiDialog("");'));
  assert.ok(!source.includes('className="integration-secret"'));
});

test("UI #265: doctor clinical requisition declines require explicit audited reason", () => {
  const screen = read("src/components/doctor-requisition-review.tsx");
  assert.ok(screen.includes("<CrudModal"));
  assert.ok(screen.includes('size="compact"'));
  assert.ok(screen.includes('minLength={10}'));
  assert.ok(screen.includes('decision:"DECLINE"'));
  assert.ok(screen.includes('reason:decisionReason'));
  assert.doesNotMatch(screen, /(?:window\.)?(?:prompt|confirm)\s*\(/);
  const route = read("src/app/api/doctor-requisitions/review/route.ts");
  assert.ok(route.includes("DECLINE"));
});
