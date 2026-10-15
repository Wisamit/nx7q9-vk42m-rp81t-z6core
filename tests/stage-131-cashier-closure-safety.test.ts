import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cashierClosingSnapshot, cashierClosureReviewError, cashierTransactionError,
  cashierShiftActiveKey,
} from "../src/lib/cashier-shift-policy.ts";

test("Stage 131: cashier closing uses exact fixed-point monetary values",()=>{
  const total=cashierClosingSnapshot({
    openingCash:"100000000000.0001",
    cashReceipts:"13.5002",
    cashRefunds:"3.0001",
    actualCash:"100000000010.5002",
  });
  assert.deepEqual(total,{expectedCash:"100000000010.5002",differenceAmount:"0.0000"});
  assert.deepEqual(cashierClosingSnapshot({
    openingCash:"10.0000",cashReceipts:"1.0000",
    cashRefunds:"0.0000",actualCash:"10.0000",
  }),{expectedCash:"11.0000",differenceAmount:"-1.0000"});
  assert.equal(cashierClosingSnapshot({
    openingCash:"0",cashReceipts:"0",cashRefunds:"0",actualCash:"-1",
  }),null);
});
test("Stage 131: cashier submit/review is branch-scoped and forbids self-signoff",()=>{
  const scope={shiftStatus:"OPEN",shiftBranchId:"A",transactionBranchId:"A",
    shiftCashierUserId:"cashier",actorUserId:"cashier",
    shiftCurrency:"AED",transactionCurrency:"AED"};
  assert.equal(cashierTransactionError(scope),null);
  assert.equal(cashierTransactionError({...scope,shiftBranchId:"B"}),"cashier_shift_branch_mismatch");
  assert.equal(cashierTransactionError({...scope,shiftCashierUserId:"other"}),"cashier_shift_cashier_mismatch");
  assert.equal(cashierTransactionError({...scope,shiftCurrency:"USD"}),"cashier_shift_currency_mismatch");
  assert.equal(cashierTransactionError({...scope,shiftStatus:"CLOSED"}),"cashier_shift_not_open");
  assert.notEqual(cashierShiftActiveKey("A","cashier","AED"),cashierShiftActiveKey("B","cashier","AED"));
  const approval={closureStatus:"PENDING",shiftStatus:"PENDING_APPROVAL",
    cashierUserId:"cashier",reviewerUserId:"independent",action:"APPROVE" as const,note:""};
  assert.equal(cashierClosureReviewError(approval),null);
  assert.equal(cashierClosureReviewError({...approval,reviewerUserId:"cashier"}),"self_approval_forbidden");
  assert.equal(cashierClosureReviewError({...approval,action:"REJECT",note:""}),"rejection_note_required");
  assert.equal(cashierClosureReviewError({...approval,shiftStatus:"OPEN"}),"closure_not_pending");

  const submit=readFileSync("src/app/api/billing/cashier-shifts/[id]/submit/route.ts","utf8");
  const review=readFileSync("src/app/api/billing/cashier-shifts/closures/[id]/review/route.ts","utf8");
  assert.match(submit,/where: \{ id, status: "OPEN", activityVersion: current.activityVersion \}/);
  assert.match(submit,/status: "PENDING_APPROVAL"/);
  assert.match(review,/permissionSet\(session\)\.has\("billing.cashier.approve"\)/);
  assert.match(review,/canAccessBranch\(session, closure\.cashierShift\.branchId\)/);
  assert.match(review,/activityVersion: closure\.activityVersionSnapshot/);
  assert.match(review,/cashierClosureReviewError/);
});
