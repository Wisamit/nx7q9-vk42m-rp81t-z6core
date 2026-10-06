export type DiscountLimitValue = number | string | { toString(): string } | null | undefined;

function normalizeLimit(value: DiscountLimitValue) {
  if (value == null) return null;
  const numeric = Number(typeof value === "object" ? value.toString() : value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, numeric));
}

export function effectiveDiscountLimit(input: {
  userOverride: DiscountLimitValue;
  roleLimits: DiscountLimitValue[];
}): number {
  const override = normalizeLimit(input.userOverride);
  if (override !== null) return override;

  let highest = 0;
  for (const value of input.roleLimits) {
    highest = Math.max(highest, normalizeLimit(value) ?? 0);
  }
  return highest;
}

export function discountApprovalMode(input: {
  requestedPercent: number;
  requesterLimitPercent: number;
}) {
  if (!Number.isFinite(input.requestedPercent) || input.requestedPercent < 0 || input.requestedPercent > 100) {
    return "INVALID" as const;
  }
  if (input.requestedPercent === 0) return "NONE" as const;
  return input.requestedPercent <= input.requesterLimitPercent
    ? "SELF_LIMIT" as const
    : "APPROVAL_WORKFLOW" as const;
}

export function approverCanAuthorize(input: {
  requestedPercent: number;
  approverLimitPercent: number;
  hasApprovalPermission: boolean;
  branchAllowed: boolean;
}) {
  return (
    input.hasApprovalPermission
    && input.branchAllowed
    && input.requestedPercent > 0
    && input.requestedPercent <= input.approverLimitPercent
  );
}
