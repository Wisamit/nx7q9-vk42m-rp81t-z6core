import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizedPaymentMethodCode,
  paymentMethodIsSettlement,
  paymentMethodReferenceError,
  paymentMethodSnapshot,
} from "../src/lib/payment-methods.ts";

test("payment method codes normalize deterministically", () => {
  assert.equal(normalizedPaymentMethodCode(" Visa POS 1 "), "VISA_POS_1");
  assert.equal(normalizedPaymentMethodCode("tabby/pay"), "TABBY_PAY");
});

test("credit-account and inactive methods cannot be posted as settlement methods", () => {
  assert.equal(paymentMethodIsSettlement({
    status: "ACTIVE",
    isSettlement: true,
    baseMethod: "CARD",
  }), true);
  assert.equal(paymentMethodIsSettlement({
    status: "ACTIVE",
    isSettlement: false,
    baseMethod: "CREDIT_ACCOUNT",
  }), false);
  assert.equal(paymentMethodIsSettlement({
    status: "INACTIVE",
    isSettlement: true,
    baseMethod: "CASH",
  }), false);
});

test("reference requirement is configuration driven", () => {
  assert.equal(paymentMethodReferenceError({ requiresReference: true }, ""), "payment_method_reference_required");
  assert.equal(paymentMethodReferenceError({ requiresReference: true }, "TX-123"), null);
  assert.equal(paymentMethodReferenceError({ requiresReference: false }, ""), null);
});

test("payment snapshots retain operational identity and stable accounting base", () => {
  assert.deepEqual(paymentMethodSnapshot({
    id: "METHOD-1",
    code: "VISA_POS_1",
    nameEn: "Visa POS 1",
    nameAr: "فيزا جهاز 1",
    baseMethod: "CARD",
  }), {
    paymentMethodConfigId: "METHOD-1",
    paymentMethodCodeSnapshot: "VISA_POS_1",
    paymentMethodNameEnSnapshot: "Visa POS 1",
    paymentMethodNameArSnapshot: "فيزا جهاز 1",
    method: "CARD",
  });
});
