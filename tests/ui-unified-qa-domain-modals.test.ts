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
    assert.equal((source.match(/<CrudModal\b/g) || []).length, names.length, moduleName);
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
    assert.ok(source.includes('if (!busy) setUiEditor("")'));
  }
});

test("UI #265: all nine EQA actions use role-gated review dialogs, with custody separate", () => {
  const sendOut = read("src/components/send-out-manager.tsx");
  const eqa = read("src/components/eqa-workspace.tsx");
  assert.ok(sendOut.includes('onSubmit={event =>'),
    "send-out dispatch/receipt actions need a dedicated chain-of-custody review");
  assert.equal((eqa.match(/<CrudModal\b/g) || []).length, 9);
  assert.equal((eqa.match(/<form\b/g) || []).length, 9);
  assert.ok(!/\\bconfirm\\s*\\(/.test(eqa),
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
  assert.ok(quality.includes("window.prompt("),
    "other high-impact quality actions still require individual review and are not marked done");
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
