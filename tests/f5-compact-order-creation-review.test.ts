import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("F5: registration modal is compact, still shows all required fields and has bilingual patient/test/finance guidance", () => {
  const modal = read("src/components/order-create-modal.tsx");
  const form = read("src/components/order-create-form.tsx");
  assert.ok(modal.includes('size="compact"'));
  assert.ok(!modal.includes('size="full"'));
  assert.ok(modal.includes('className="order-modal-compact-flow"'));
  assert.ok(modal.includes("Review patient identity, ordering branch and test selection carefully"));
  assert.ok(modal.includes("راجع هوية المريض وفرع الطلب والفحوصات"));
  assert.ok(modal.includes("<OrderCreateForm {...props}"));
  assert.ok(form.includes('return <form className="order-form" onSubmit={submit}>'));
  assert.equal(form.split("order-step-heading").length - 1, 4);
  for (const title of [
    "Patient and ordering context",
    "Tests and packages",
    "Billing and discount",
    "Test-specific clinical questions",
    "Final identity and billing check",
  ]) assert.ok(form.includes(title), title);
  assert.ok(!form.includes("order-step-hidden"));
  assert.ok(!form.includes("<fieldset hidden"));
});

test("F5: clinically significant registration and invoice authorization logic is unchanged", () => {
  const form = read("src/components/order-create-form.tsx");
  for (const required of [
    "if (submitting.current) return;",
    "patientId!==initialDoctorRequisition.patientId",
    "if (!patientId)",
    "if (effectiveTestIds.length === 0)",
    "new FormData(formElement)",
    'fetch("/api/orders"',
    'name="branchId" required',
    'name="sourceId" required',
    'name="discountPercent"',
    '"question_" + question.id',
    "Register Order & Invoice",
    "manager approval",
    "discountApprovalRequestId",
  ]) assert.ok(form.includes(required), required);
  assert.ok(form.includes("Patient") && form.includes("Clinical notes"));
  assert.ok(form.includes("selectedPackages.map"));
});

test("F5: desktop one-third and mobile full-screen form remain readable without horizontal clipping", () => {
  const css=read("src/app/globals.css");
  assert.ok(css.includes(".crud-modal-compact{width:min(33.333vw,520px)"));
  assert.ok(css.includes(".crud-modal-compact .order-modal-compact-flow .order-form>.form-grid"));
  assert.ok(css.includes(".crud-modal-compact .order-modal-compact-flow .order-question-grid"));
  assert.ok(css.includes(".order-modal-compact-flow .inline-search"));
  assert.ok(css.includes(".order-modal-compact-flow .selected-test-chip"));
  assert.ok(css.includes("@media(max-width:760px)"));
  assert.ok(css.includes("overflow:auto"));
  const styles=css.slice(css.lastIndexOf("/* Compact order registration:"));
  assert.ok(styles.includes("var(--fl-border)"));
  assert.ok(styles.includes("var(--fl-primary)"));
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(styles));
});
