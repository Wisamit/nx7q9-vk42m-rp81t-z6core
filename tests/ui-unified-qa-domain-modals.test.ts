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

test("UI #265: regulated send-out movement and EQA work actions remain separate review candidates", () => {
  const sendOut = read("src/components/send-out-manager.tsx");
  const eqa = read("src/components/eqa-workspace.tsx");
  assert.ok(sendOut.includes('onSubmit={event =>'),
    "direct custody-changing inline actions need separate review, not blindly wrapped");
  assert.ok(eqa.includes('onSubmit={e=>void send("ASSESS_OBSERVATION",e'),
    "EQA assessment must retain authorized reviewer workflow");
  const quality = read("src/components/quality-management-console.tsx");
  assert.ok(quality.includes("window.prompt("),
    "other 29 high-impact quality actions are explicitly pending review, not marked done");
});

test("UI #265: one-time integration secret removed from public page after dialog close", () => {
  const source = read("src/components/integration-manager.tsx");
  assert.ok(source.includes('uiDialog === "key" && secret'));
  assert.ok(source.includes('setSecret(""); setUiDialog("");'));
  assert.ok(!source.includes('className="integration-secret"'));
});
