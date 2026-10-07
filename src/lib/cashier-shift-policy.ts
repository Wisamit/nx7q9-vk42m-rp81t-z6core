import { minorToMoney4, money4ToMinor } from "./billing-adjustments.ts";

export function cashierShiftActiveKey(branchId: string, cashierUserId: string, currency: string) {
  return `${branchId}:${cashierUserId}:${currency.trim().toUpperCase()}`;
}

export function cashierClosingSnapshot(input: {
  openingCash: string;
  cashReceipts: string;
  cashRefunds: string;
  actualCash: string;
}) {
  const openingCash = money4ToMinor(input.openingCash);
  const cashReceipts = money4ToMinor(input.cashReceipts);
  const cashRefunds = money4ToMinor(input.cashRefunds);
  const actualCash = money4ToMinor(input.actualCash);
  if ([openingCash, cashReceipts, cashRefunds, actualCash].some(value => value === null)) return null;

  const expected = openingCash! + cashReceipts! - cashRefunds!;
  const difference = actualCash! - expected;
  return {
    expectedCash: minorToMoney4(expected),
    differenceAmount: minorToMoney4(difference),
  };
}

export function cashierTransactionError(input: {
  shiftStatus: string;
  shiftBranchId: string;
  transactionBranchId: string;
  shiftCashierUserId: string;
  actorUserId: string;
  shiftCurrency: string;
  transactionCurrency: string;
}) {
  if (input.shiftStatus !== "OPEN") return "cashier_shift_not_open";
  if (input.shiftBranchId !== input.transactionBranchId) return "cashier_shift_branch_mismatch";
  if (input.shiftCashierUserId !== input.actorUserId) return "cashier_shift_cashier_mismatch";
  if (input.shiftCurrency !== input.transactionCurrency) return "cashier_shift_currency_mismatch";
  return null;
}

export function cashierClosureReviewError(input: {
  closureStatus: string;
  shiftStatus: string;
  cashierUserId: string;
  reviewerUserId: string;
  action: "APPROVE" | "REJECT";
  note: string;
}) {
  if (input.closureStatus !== "PENDING" || input.shiftStatus !== "PENDING_APPROVAL") return "closure_not_pending";
  if (input.cashierUserId === input.reviewerUserId) return "self_approval_forbidden";
  if (input.action === "REJECT" && !input.note.trim()) return "rejection_note_required";
  return null;
}
