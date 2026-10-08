import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("payment and refund schema stores immutable configured-method snapshots", () => {
  const schema = source("prisma/schema.prisma");
  assert.match(schema, /model PaymentMethodConfig \{/);
  for (const field of [
    "paymentMethodConfigId",
    "paymentMethodCodeSnapshot",
    "paymentMethodNameEnSnapshot",
    "paymentMethodNameArSnapshot",
  ]) {
    assert.ok(schema.split("model Payment {")[1].split("model PaymentAllocation")[0].includes(field));
    assert.ok(schema.split("model Refund {")[1].split("model CashierShift")[0].includes(field));
  }
});

test("standard methods are backfilled before snapshot fields become required", () => {
  const migration = source("prisma/migrations/20261008073500_configurable_payment_methods/migration.sql");
  assert.match(migration, /CREATE TABLE `payment_method_configs`/);
  assert.match(migration, /UPDATE `payments` p[\s\S]*payment_method_code_snapshot/);
  assert.match(migration, /UPDATE `refunds` r[\s\S]*payment_method_code_snapshot/);
  assert.match(migration, /MODIFY COLUMN `payment_method_config_id` CHAR\(36\) NOT NULL/);
  assert.match(migration, /'CREDIT_ACCOUNT'.*FALSE/s);
});

test("all settlement posting routes resolve configured methods and persist snapshots", () => {
  for (const path of [
    "src/app/api/billing/payments/route.ts",
    "src/app/api/billing/client-payments/route.ts",
    "src/app/api/billing/refunds/route.ts",
  ]) {
    const route = source(path);
    assert.match(route, /resolveSettlementPaymentMethod/);
    assert.match(route, /paymentMethodSnapshot/);
    assert.match(route, /payment_method_not_available/);
  }
});

test("cashier reconciliation remains based on stable base method", () => {
  const submit = source("src/app/api/billing/cashier-shifts/[id]/submit/route.ts");
  assert.match(submit, /item\.method === "CASH"/);
  const helper = source("src/lib/payment-methods.ts");
  assert.match(helper, /method: method\.baseMethod/);
});

test("financial report filters by configured method identity and shows historical snapshots", () => {
  const report = source("src/app/billing/reports/page.tsx");
  assert.match(report, /name="paymentMethodId"/);
  assert.match(report, /paymentMethodConfigId: paymentMethodId/);
  assert.match(report, /paymentMethodNameEnSnapshot/);
  assert.match(report, /paymentMethodNameArSnapshot/);
  assert.doesNotMatch(report, /const PAYMENT_METHODS/);
});

test("payment method master data is organization governed and soft-deactivated", () => {
  const createRoute = source("src/app/api/billing/payment-methods/route.ts");
  const updateRoute = source("src/app/api/billing/payment-methods/[id]/route.ts");
  assert.match(createRoute, /billing\.payment_methods\.manage/);
  assert.match(createRoute, /organization_scope_incomplete/);
  assert.match(updateRoute, /billing\.payment_methods\.manage/);
  assert.match(updateRoute, /deactivatedAt/);
  assert.doesNotMatch(updateRoute, /\.delete\(/);
});
