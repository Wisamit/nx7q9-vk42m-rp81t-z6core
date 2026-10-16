import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(file, "utf8");

test("Issue #265: inventory, equipment and integration forms have explicit compact UI dialogs", () => {
  const cases: Array<[string, string[], string]> = [
    ["inventory-manager", ["createCategory", "createSupplier", "createItem", "createReceipt"], "uiEditor"],
    ["inventory-operations-manager", ["adjust", "consume"], "uiEditor"],
    ["equipment-manager", ["createEquipment", "maintenance", "calibration", "downtime",
      "maintenancePlan", "equipmentDocument"], "uiEditor"],
    ["integration-manager", ["createEndpoint", "createMapping", "createKey", "subscribe"], "uiDialog"],
    ["digital-services-console", ["createPortalAccount", "createCorporateAccess",
      "createAppointment", "issueQueueTicket"], "uiDialog"],
  ];
  for (const [moduleName, handlers, stateName] of cases) {
    const source = read("src/components/" + moduleName + ".tsx");
    assert.ok(source.includes('import { CrudModal } from "@/components/crud-modal";'), moduleName);
    assert.equal((source.match(/<CrudModal\b/g) || []).length,
      handlers.length + (moduleName === "digital-services-console" ? 1 : 0));
    for (const handler of handlers) {
      const tag = '<form className="catalog-form" onSubmit={' + handler + '}>';
      const formStart = source.indexOf(tag);
      const modalStart = source.lastIndexOf("<CrudModal", formStart);
      const modalEnd = source.indexOf("</CrudModal>", formStart);
      assert.ok(formStart >= 0 && modalStart >= 0 && modalEnd > formStart,
        moduleName + ": " + handler + " is mounted in a modal");
      const before = source.slice(modalStart, formStart);
      assert.ok(before.includes('size="compact"'));
      assert.ok(before.includes(stateName + ' === "'));
      assert.ok(source.slice(formStart, modalEnd).includes("</form>"));
    }
    assert.ok(source.includes("role=") || source.includes("form-warning"));
    assert.ok(source.includes("if (!busy) setUi") ||
      source.includes("if (!busy) setUiEditor"), "inflight dismiss must be blocked");
  }
  const integration = read("src/components/integration-manager.tsx");
  assert.ok(integration.includes('uiDialog === "key" && secret'));
  assert.ok(integration.includes('secret will not be displayed by the server again.'));
});

test("Issue #265: sensitive customer actions never use browser-native prompt/confirm", () => {
  const digital = read("src/components/digital-services-console.tsx");
  const access = read("src/components/doctor-portal-access-manager.tsx");
  const discounts = read("src/components/discount-approval-manager.tsx");
  for (const [name, source] of [["digital", digital], ["access", access], ["discount", discounts]]) {
    assert.doesNotMatch(source, /(?:window\.)?(?:prompt|confirm)\s*\(/,
      name + " must use professional bilingual review dialogs, not native prompts");
    assert.ok(source.includes("CrudModal"));
    assert.ok(source.includes('size="compact"'));
  }
  assert.ok(digital.includes('kind: "portal-status" | "portal-password" | "appointment-cancel" | "queue-call"'));
  assert.ok(digital.includes('autoComplete="new-password"'));
  assert.ok(digital.includes('type="password"'));
  assert.ok(digital.includes('minLength={12}'));
  for (const endpoint of [
    "/api/portal-accounts", "/api/corporate-portal-access", "/api/appointments",
    "/api/queue", "/api/home-collections",
  ]) assert.ok(digital.includes(endpoint));
  assert.ok(digital.includes('String(form.get("reason") || "").trim()'));
  assert.ok(access.includes('name') || access.includes("revokeReason"));
  assert.ok(access.includes('minLength={10}'));
  assert.ok(access.includes('"PATCH"'));
  assert.ok(access.includes('/api/doctor-portal-access'));
  assert.ok(discounts.includes("StaffStepUpDialog"));
  assert.ok(discounts.includes("setPendingStepUpId(id)"));
  assert.ok(discounts.includes("x-staff-step-up-token"));
  assert.ok(discounts.includes("DISCOUNT_APPROVAL"));
  assert.ok(discounts.includes('"REJECT", undefined, rejectionNote.trim()'));
  assert.ok(discounts.includes("row.finalTotal"));
  assert.ok(discounts.includes("row.discountPercent"));
});

test("Issue #265: financial and clinical HTTP server authority unchanged", () => {
  const creditUI = read("src/components/client-credit-limit-manager.tsx");
  const creditAPI = read("src/app/api/billing/credit-limits/route.ts");
  const digital = read("src/components/digital-services-console.tsx");
  assert.ok(creditUI.includes('size="compact"'));
  assert.ok(creditUI.includes('method: "PUT"'));
  assert.ok(creditUI.includes("JSON.stringify({ clientId, currency, mode, limitAmount, reason })"));
  assert.ok(creditUI.includes("setFormError("));
  assert.ok(creditAPI.includes("auditEvent.create"));
  assert.ok(digital.includes('if (!response.ok)'));
  assert.ok(digital.includes("catch {"));
  const discountAPI = read("src/app/api/billing/discount-approvals/[id]/route.ts");
  assert.ok(discountAPI.includes("discount_limit_exceeded"));
  assert.ok(discountAPI.includes("x-staff-step-up-token"));
});
