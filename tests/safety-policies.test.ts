import test from "node:test";
import assert from "node:assert/strict";
import {
  amendmentEligibility,
  branchScopeAllows,
  departmentScopeAllows,
  releaseEligibility,
  specimenActionError,
} from "../src/lib/clinical-safety.ts";
import { comparePricingCandidates } from "../src/lib/pricing-policy.ts";
import { approverCanAuthorize, discountApprovalMode, effectiveDiscountLimit } from "../src/lib/discount-policy.ts";
import { discountApprovalFingerprint } from "../src/lib/discount-approval.ts";
import { creditNoteError, invoiceAdjustmentState, refundError } from "../src/lib/billing-adjustments.ts";
import { cashierClosingSnapshot, cashierClosureReviewError, cashierShiftActiveKey, cashierTransactionError } from "../src/lib/cashier-shift-policy.ts";
import { buildClientStatementLedger, clientPaymentAllocationError, localDateStartUtc, nextDateString } from "../src/lib/client-accounting.ts";
import { agingBucket, aggregateAging, historicalInvoiceReceivable, invoiceDueDateSnapshot, localCalendarDate } from "../src/lib/accounts-receivable-aging.ts";

test("specimen collection is only allowed from PLANNED with specimen type configured", () => {
  assert.equal(specimenActionError({ status: "PLANNED", action: "COLLECT", specimenTypeConfigured: true }), null);
  assert.equal(specimenActionError({ status: "COLLECTED", action: "COLLECT", specimenTypeConfigured: true }), "specimen_not_collectable");
  assert.equal(specimenActionError({ status: "PLANNED", action: "COLLECT", specimenTypeConfigured: false }), "specimen_type_required_before_collection");
});

test("specimen receive accepts COLLECTED and IN_TRANSIT only", () => {
  assert.equal(specimenActionError({ status: "COLLECTED", action: "RECEIVE", specimenTypeConfigured: true }), null);
  assert.equal(specimenActionError({ status: "IN_TRANSIT", action: "RECEIVE", specimenTypeConfigured: true }), null);
  assert.equal(specimenActionError({ status: "PLANNED", action: "RECEIVE", specimenTypeConfigured: true }), "specimen_not_receivable");
  assert.equal(specimenActionError({ status: "REJECTED", action: "RECEIVE", specimenTypeConfigured: true }), "specimen_not_receivable");
});

test("specimen rejection is limited to collected or received samples", () => {
  assert.equal(specimenActionError({ status: "COLLECTED", action: "REJECT", specimenTypeConfigured: true }), null);
  assert.equal(specimenActionError({ status: "RECEIVED", action: "REJECT", specimenTypeConfigured: true }), null);
  assert.equal(specimenActionError({ status: "IN_PROCESS", action: "REJECT", specimenTypeConfigured: true }), "specimen_not_rejectable");
});

test("result release requires VERIFIED status", () => {
  assert.deepEqual(releaseEligibility({
    resultStatus: "DRAFT",
    qcBlocking: false,
    criticalCount: 0,
    criticalEventStatus: null,
  }), { allowed: false, error: "result_not_releasable" });
});

test("QC blocking state prevents result release", () => {
  assert.deepEqual(releaseEligibility({
    resultStatus: "VERIFIED",
    qcBlocking: true,
    criticalCount: 0,
    criticalEventStatus: null,
  }), { allowed: false, error: "qc_release_blocked" });
});

test("critical results cannot release before acknowledgement", () => {
  assert.deepEqual(releaseEligibility({
    resultStatus: "VERIFIED",
    qcBlocking: false,
    criticalCount: 1,
    criticalEventStatus: "OPEN",
  }), { allowed: false, error: "critical_acknowledgement_required" });
});

test("verified non-critical result can release when QC does not block", () => {
  assert.deepEqual(releaseEligibility({
    resultStatus: "VERIFIED",
    qcBlocking: false,
    criticalCount: 0,
    criticalEventStatus: null,
  }), { allowed: true, error: null });
});

test("acknowledged critical result can release when other gates pass", () => {
  assert.deepEqual(releaseEligibility({
    resultStatus: "VERIFIED",
    qcBlocking: false,
    criticalCount: 2,
    criticalEventStatus: "ACKNOWLEDGED",
  }), { allowed: true, error: null });
});

test("only released results can enter amendment workflow", () => {
  assert.deepEqual(amendmentEligibility({
    resultStatus: "VERIFIED",
    hasMicrobiologySnapshot: false,
    newerResultExists: false,
  }), { allowed: false, error: "only_released_results_can_be_amended" });
});

test("microbiology results require their dedicated amendment workflow", () => {
  assert.deepEqual(amendmentEligibility({
    resultStatus: "RELEASED",
    hasMicrobiologySnapshot: true,
    newerResultExists: false,
  }), { allowed: false, error: "microbiology_requires_dedicated_amendment_workflow" });
});

test("released result cannot spawn another amendment when a newer active version exists", () => {
  assert.deepEqual(amendmentEligibility({
    resultStatus: "RELEASED",
    hasMicrobiologySnapshot: false,
    newerResultExists: true,
  }), { allowed: false, error: "newer_result_version_already_exists" });
});

test("released result can start a versioned amendment when no newer version exists", () => {
  assert.deepEqual(amendmentEligibility({
    resultStatus: "RELEASED",
    hasMicrobiologySnapshot: false,
    newerResultExists: false,
  }), { allowed: true, error: null });
});

test("branch scope rejects missing or unauthorized branches", () => {
  assert.equal(branchScopeAllows(["branch-a", "branch-b"], "branch-a"), true);
  assert.equal(branchScopeAllows(["branch-a", "branch-b"], "branch-c"), false);
  assert.equal(branchScopeAllows(["branch-a"], null), false);
});

test("department scope is unrestricted when no explicit departments are assigned", () => {
  assert.equal(departmentScopeAllows([], "hematology"), true);
  assert.equal(departmentScopeAllows([], null), true);
});

test("department scope restricts access once explicit departments are assigned", () => {
  assert.equal(departmentScopeAllows(["hematology", "chemistry"], "hematology"), true);
  assert.equal(departmentScopeAllows(["hematology", "chemistry"], "microbiology"), false);
  assert.equal(departmentScopeAllows(["hematology"], null), false);
});

test("pricing precedence is CONTRACT > CLIENT > SOURCE > BRANCH > ORGANIZATION", () => {
  const candidates = [
    { scopeType: "ORGANIZATION" as const, priority: 999, effectiveFrom: new Date("2026-01-01") },
    { scopeType: "BRANCH" as const, priority: 999, effectiveFrom: new Date("2026-01-01") },
    { scopeType: "SOURCE" as const, priority: 1, effectiveFrom: new Date("2026-01-01") },
    { scopeType: "CLIENT" as const, priority: 1, effectiveFrom: new Date("2026-01-01") },
    { scopeType: "CONTRACT" as const, priority: 0, effectiveFrom: new Date("2025-01-01") },
  ].sort(comparePricingCandidates);

  assert.deepEqual(candidates.map(item => item.scopeType), ["CONTRACT", "CLIENT", "SOURCE", "BRANCH", "ORGANIZATION"]);
});

test("pricing priority wins within the same scope", () => {
  const candidates = [
    { scopeType: "BRANCH" as const, priority: 10, effectiveFrom: new Date("2026-09-01") },
    { scopeType: "BRANCH" as const, priority: 20, effectiveFrom: new Date("2026-01-01") },
  ].sort(comparePricingCandidates);

  assert.equal(candidates[0].priority, 20);
});

test("newer effective date wins when scope and priority are equal", () => {
  const candidates = [
    { scopeType: "CLIENT" as const, priority: 10, effectiveFrom: new Date("2026-01-01") },
    { scopeType: "CLIENT" as const, priority: 10, effectiveFrom: new Date("2026-10-01") },
  ].sort(comparePricingCandidates);

  assert.equal(candidates[0].effectiveFrom.toISOString().slice(0, 10), "2026-10-01");
});


test("source pricing priority wins within the source scope", () => {
  const candidates = [
    { scopeType: "SOURCE" as const, priority: 10, effectiveFrom: new Date("2026-09-01") },
    { scopeType: "SOURCE" as const, priority: 20, effectiveFrom: new Date("2026-01-01") },
  ].sort(comparePricingCandidates);

  assert.equal(candidates[0].priority, 20);
});


test("user discount override takes precedence over assigned role limits", () => {
  assert.equal(effectiveDiscountLimit({
    userOverride: 7.5,
    roleLimits: [5, 20],
  }), 7.5);
});

test("highest active role discount limit is used when user has no override", () => {
  assert.equal(effectiveDiscountLimit({
    userOverride: null,
    roleLimits: [5, 12.5, 10],
  }), 12.5);
});

test("discount above requester limit requires approval workflow", () => {
  assert.equal(discountApprovalMode({ requestedPercent: 6, requesterLimitPercent: 5 }), "APPROVAL_WORKFLOW");
  assert.equal(discountApprovalMode({ requestedPercent: 5, requesterLimitPercent: 5 }), "SELF_LIMIT");
  assert.equal(discountApprovalMode({ requestedPercent: 0, requesterLimitPercent: 0 }), "NONE");
});

test("discount approver must have permission, branch access and sufficient limit", () => {
  assert.equal(approverCanAuthorize({
    requestedPercent: 15,
    approverLimitPercent: 20,
    hasApprovalPermission: true,
    branchAllowed: true,
  }), true);
  assert.equal(approverCanAuthorize({
    requestedPercent: 15,
    approverLimitPercent: 10,
    hasApprovalPermission: true,
    branchAllowed: true,
  }), false);
  assert.equal(approverCanAuthorize({
    requestedPercent: 15,
    approverLimitPercent: 20,
    hasApprovalPermission: false,
    branchAllowed: true,
  }), false);
  assert.equal(approverCanAuthorize({
    requestedPercent: 15,
    approverLimitPercent: 20,
    hasApprovalPermission: true,
    branchAllowed: false,
  }), false);
});


test("discount approval fingerprint is stable for equivalent sorted pricing context", () => {
  const base = {
    organizationId: "org-a",
    branchId: "branch-a",
    patientId: "patient-a",
    sourceId: "source-a",
    referrerId: null,
    clientId: null,
    directTestIds: ["test-b", "test-a"],
    packageIds: ["package-b", "package-a"],
    discountPercent: "10.00",
    discountReason: "Campaign adjustment",
    currency: "EGP",
    pricing: [
      { kind: "PACKAGE" as const, id: "package-b", priceReferenceId: "price-p-b", unitPrice: "200.0000" },
      { kind: "TEST" as const, id: "test-a", priceReferenceId: "price-t-a", unitPrice: "100.0000" },
    ],
  };
  const reordered = {
    ...base,
    directTestIds: [...base.directTestIds].reverse(),
    packageIds: [...base.packageIds].reverse(),
    pricing: [...base.pricing].reverse(),
  };
  assert.equal(discountApprovalFingerprint(base), discountApprovalFingerprint(reordered));
});

test("discount approval fingerprint changes when financial context changes", () => {
  const base = {
    organizationId: "org-a",
    branchId: "branch-a",
    patientId: "patient-a",
    sourceId: "source-a",
    referrerId: null,
    clientId: null,
    directTestIds: ["test-a"],
    packageIds: [],
    discountPercent: "10.00",
    discountReason: "Campaign adjustment",
    currency: "EGP",
    pricing: [
      { kind: "TEST" as const, id: "test-a", priceReferenceId: "price-t-a", unitPrice: "100.0000" },
    ],
  };
  assert.notEqual(
    discountApprovalFingerprint(base),
    discountApprovalFingerprint({ ...base, sourceId: "source-b" }),
  );
  assert.notEqual(
    discountApprovalFingerprint(base),
    discountApprovalFingerprint({
      ...base,
      pricing: [{ ...base.pricing[0], unitPrice: "110.0000" }],
    }),
  );
  assert.notEqual(
    discountApprovalFingerprint(base),
    discountApprovalFingerprint({ ...base, discountPercent: "11.00" }),
  );
});


test("credit notes cannot exceed the uncredited invoice amount", () => {
  assert.equal(creditNoteError({
    invoiceStatus: "PAID",
    total: "100.0000",
    credited: "25.0000",
    requested: "75.0000",
  }), null);
  assert.equal(creditNoteError({
    invoiceStatus: "PAID",
    total: "100.0000",
    credited: "25.0000",
    requested: "75.0001",
  }), "credit_exceeds_remaining_amount");
});

test("full credit closes invoice obligation without rewriting original total", () => {
  assert.deepEqual(invoiceAdjustmentState({
    total: "100.0000",
    credited: "100.0000",
    netPaid: "100.0000",
  }), {
    status: "CREDITED",
    balance: "0.0000",
    overpayment: "100.0000",
    obligation: "0.0000",
  });
});

test("refund reduces net paid and reopens an unpaid invoice balance", () => {
  assert.deepEqual(invoiceAdjustmentState({
    total: "100.0000",
    credited: "0.0000",
    netPaid: "60.0000",
  }), {
    status: "PARTIALLY_PAID",
    balance: "40.0000",
    overpayment: "0.0000",
    obligation: "100.0000",
  });
});

test("full credit plus full refund remains credited with zero balance", () => {
  assert.deepEqual(invoiceAdjustmentState({
    total: "100.0000",
    credited: "100.0000",
    netPaid: "0.0000",
  }), {
    status: "CREDITED",
    balance: "0.0000",
    overpayment: "0.0000",
    obligation: "0.0000",
  });
});

test("refund cannot exceed the remaining payment allocation", () => {
  assert.equal(refundError({
    paymentStatus: "POSTED",
    allocated: "100.0000",
    refundedForAllocation: "40.0000",
    requested: "60.0000",
  }), null);
  assert.equal(refundError({
    paymentStatus: "POSTED",
    allocated: "100.0000",
    refundedForAllocation: "40.0000",
    requested: "60.0001",
  }), "refund_exceeds_allocation");
  assert.equal(refundError({
    paymentStatus: "REFUNDED",
    allocated: "100.0000",
    refundedForAllocation: "100.0000",
    requested: "1.0000",
  }), "payment_not_refundable");
});


test("cashier closing expected cash uses opening plus cash receipts minus cash refunds", () => {
  assert.deepEqual(cashierClosingSnapshot({
    openingCash: "100.0000",
    cashReceipts: "350.2500",
    cashRefunds: "50.2500",
    actualCash: "401.0000",
  }), {
    expectedCash: "400.0000",
    differenceAmount: "1.0000",
  });
});

test("cashier closing preserves negative cash differences exactly", () => {
  assert.deepEqual(cashierClosingSnapshot({
    openingCash: "25.0000",
    cashReceipts: "75.0000",
    cashRefunds: "10.0000",
    actualCash: "89.5000",
  }), {
    expectedCash: "90.0000",
    differenceAmount: "-0.5000",
  });
});

test("cashier transactions require an open shift with matching branch cashier and currency", () => {
  const base = {
    shiftStatus: "OPEN",
    shiftBranchId: "branch-a",
    transactionBranchId: "branch-a",
    shiftCashierUserId: "user-a",
    actorUserId: "user-a",
    shiftCurrency: "EGP",
    transactionCurrency: "EGP",
  };
  assert.equal(cashierTransactionError(base), null);
  assert.equal(cashierTransactionError({ ...base, shiftStatus: "PENDING_APPROVAL" }), "cashier_shift_not_open");
  assert.equal(cashierTransactionError({ ...base, transactionBranchId: "branch-b" }), "cashier_shift_branch_mismatch");
  assert.equal(cashierTransactionError({ ...base, actorUserId: "user-b" }), "cashier_shift_cashier_mismatch");
  assert.equal(cashierTransactionError({ ...base, transactionCurrency: "USD" }), "cashier_shift_currency_mismatch");
});

test("cashier closing review requires independent approver and rejection note", () => {
  const base = {
    closureStatus: "PENDING",
    shiftStatus: "PENDING_APPROVAL",
    cashierUserId: "cashier-a",
    reviewerUserId: "manager-a",
    action: "APPROVE" as const,
    note: "",
  };
  assert.equal(cashierClosureReviewError(base), null);
  assert.equal(cashierClosureReviewError({ ...base, reviewerUserId: "cashier-a" }), "self_approval_forbidden");
  assert.equal(cashierClosureReviewError({ ...base, action: "REJECT", note: "" }), "rejection_note_required");
  assert.equal(cashierClosureReviewError({ ...base, closureStatus: "APPROVED" }), "closure_not_pending");
});

test("cashier active key isolates branch cashier and currency", () => {
  assert.equal(cashierShiftActiveKey("branch-a", "user-a", "egp"), "branch-a:user-a:EGP");
  assert.notEqual(
    cashierShiftActiveKey("branch-a", "user-a", "EGP"),
    cashierShiftActiveKey("branch-a", "user-a", "USD"),
  );
});


test("client statement ledger preserves opening balance and period movements", () => {
  const before = new Date("2026-09-30T10:00:00.000Z");
  const inside = new Date("2026-10-05T10:00:00.000Z");
  const base = { sourceId: "x", branchId: "b1", branchCode: "BR1", description: "event" };

  const ledger = buildClientStatementLedger({
    openingEvents: [
      { ...base, sourceNumber: "INV-1", occurredAt: before, lineType: "INVOICE", amount: "100.0000" },
      { ...base, sourceNumber: "PAY-1", occurredAt: before, lineType: "PAYMENT", amount: "30.0000" },
    ],
    periodEvents: [
      { ...base, sourceNumber: "INV-2", occurredAt: inside, lineType: "INVOICE", amount: "50.0000" },
      { ...base, sourceNumber: "CN-1", occurredAt: new Date(inside.getTime() + 1000), lineType: "CREDIT_NOTE", amount: "10.0000" },
      { ...base, sourceNumber: "PAY-2", occurredAt: new Date(inside.getTime() + 2000), lineType: "PAYMENT", amount: "20.0000" },
      { ...base, sourceNumber: "RF-1", occurredAt: new Date(inside.getTime() + 3000), lineType: "REFUND", amount: "5.0000" },
    ],
  });

  assert.ok(ledger);
  assert.equal(ledger.openingBalance, "70.0000");
  assert.equal(ledger.invoiceCharges, "50.0000");
  assert.equal(ledger.creditNotes, "10.0000");
  assert.equal(ledger.payments, "20.0000");
  assert.equal(ledger.refunds, "5.0000");
  assert.equal(ledger.closingBalance, "95.0000");
  assert.deepEqual(ledger.lines.map(line => line.runningBalance), ["120.0000", "110.0000", "90.0000", "95.0000"]);
});

test("client payment allocation must equal payment and stay within invoice balances", () => {
  assert.equal(clientPaymentAllocationError({
    paymentAmount: "100.0000",
    allocations: [
      { amount: "40.0000", invoiceBalance: "40.0000" },
      { amount: "60.0000", invoiceBalance: "75.0000" },
    ],
  }), null);
  assert.equal(clientPaymentAllocationError({
    paymentAmount: "100.0000",
    allocations: [{ amount: "100.0000", invoiceBalance: "90.0000" }],
  }), "allocation_exceeds_invoice_balance");
  assert.equal(clientPaymentAllocationError({
    paymentAmount: "100.0000",
    allocations: [{ amount: "99.0000", invoiceBalance: "100.0000" }],
  }), "allocation_total_mismatch");
});

test("client statement date boundaries respect the reporting timezone", () => {
  assert.equal(nextDateString("2026-10-07"), "2026-10-08");
  assert.equal(localDateStartUtc("2026-10-07", "Asia/Dubai")?.toISOString(), "2026-10-06T20:00:00.000Z");
  assert.equal(localDateStartUtc("2026-02-30", "Asia/Dubai"), null);
});


test("invoice due date snapshot uses branch-local issuance date and frozen payment terms", () => {
  const issuedAt = new Date("2026-10-06T22:30:00.000Z");
  assert.equal(localCalendarDate(issuedAt, "Asia/Dubai"), "2026-10-07");
  assert.equal(invoiceDueDateSnapshot(issuedAt, "Asia/Dubai", 30)?.toISOString().slice(0, 10), "2026-11-06");
  assert.equal(invoiceDueDateSnapshot(issuedAt, "Asia/Dubai", -1), null);
});

test("aging bucket boundaries are stable at current, 30, 60 and 90 days", () => {
  assert.deepEqual(agingBucket("2026-10-07", "2026-10-07"), { bucket: "CURRENT", daysOverdue: 0 });
  assert.deepEqual(agingBucket("2026-10-08", "2026-10-07"), { bucket: "CURRENT", daysOverdue: 0 });
  assert.deepEqual(agingBucket("2026-09-07", "2026-10-07"), { bucket: "DAYS_1_30", daysOverdue: 30 });
  assert.deepEqual(agingBucket("2026-09-06", "2026-10-07"), { bucket: "DAYS_31_60", daysOverdue: 31 });
  assert.deepEqual(agingBucket("2026-08-08", "2026-10-07"), { bucket: "DAYS_31_60", daysOverdue: 60 });
  assert.deepEqual(agingBucket("2026-08-07", "2026-10-07"), { bucket: "DAYS_61_90", daysOverdue: 61 });
  assert.deepEqual(agingBucket("2026-07-09", "2026-10-07"), { bucket: "DAYS_61_90", daysOverdue: 90 });
  assert.deepEqual(agingBucket("2026-07-08", "2026-10-07"), { bucket: "DAYS_91_PLUS", daysOverdue: 91 });
});

test("historical invoice receivable reconstructs credits payments and refunds without current balance", () => {
  assert.deepEqual(historicalInvoiceReceivable({
    total: "100.0000",
    creditNotes: "10.0000",
    payments: "50.0000",
    refunds: "5.0000",
  }), {
    rawBalance: "45.0000",
    receivable: "45.0000",
    creditBalance: "0.0000",
  });

  assert.deepEqual(historicalInvoiceReceivable({
    total: "100.0000",
    creditNotes: "100.0000",
    payments: "40.0000",
    refunds: "0.0000",
  }), {
    rawBalance: "-40.0000",
    receivable: "0.0000",
    creditBalance: "40.0000",
  });
});

test("aging aggregation keeps buckets and client credit balance separate", () => {
  assert.deepEqual(aggregateAging([
    { bucket: "CURRENT", receivable: "100.0000", creditBalance: "0.0000" },
    { bucket: "DAYS_1_30", receivable: "50.0000", creditBalance: "0.0000" },
    { bucket: "DAYS_91_PLUS", receivable: "25.0000", creditBalance: "10.0000" },
  ]), {
    current: "100.0000",
    days1to30: "50.0000",
    days31to60: "0.0000",
    days61to90: "0.0000",
    days91plus: "25.0000",
    receivableTotal: "175.0000",
    creditBalanceTotal: "10.0000",
  });
});
