import { Prisma } from "../../generated/prisma/client";

type MicrobiologyCaseLock = {
  id: string;
  status: string;
  result_id: string | null;
  specimen_id: string;
  performing_branch_id: string;
};

/**
 * Lock specimen before case to align with results/release locking order.
 * All case mutations must claim this gate inside their database transaction,
 * not only check a stale UI/preflight case snapshot.
 */
export async function lockMicrobiologyCaseForEdit(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    caseId: string;
    specimenId: string;
    performingBranchId: string;
    allowSubmittedResult?: boolean;
  },
): Promise<"READY" | "SPECIMEN_CHANGED" | "CASE_CHANGED" | "CASE_LOCKED" | "RESULT_ALREADY_SUBMITTED"> {
  const specimen = await tx.$queryRaw<Array<{ id: string; status: string; current_branch_id: string | null }>>`
    SELECT id, status, current_branch_id FROM specimens
    WHERE id = ${input.specimenId}
      AND organization_id = ${input.organizationId}
    FOR UPDATE
  `;
  if (specimen.length !== 1 ||
    specimen[0].status !== "IN_PROCESS" ||
    specimen[0].current_branch_id !== input.performingBranchId) {
    return "SPECIMEN_CHANGED";
  }

  const cases = await tx.$queryRaw<MicrobiologyCaseLock[]>`
    SELECT id, status, result_id, specimen_id, performing_branch_id
    FROM microbiology_cases
    WHERE id = ${input.caseId}
      AND organization_id = ${input.organizationId}
    FOR UPDATE
  `;
  if (cases.length !== 1 ||
    cases[0].specimen_id !== input.specimenId ||
    cases[0].performing_branch_id !== input.performingBranchId) {
    return "CASE_CHANGED";
  }
  if (cases[0].status === "FINAL" || cases[0].status === "CANCELLED") return "CASE_LOCKED";
  if (cases[0].result_id && !input.allowSubmittedResult) return "RESULT_ALREADY_SUBMITTED";
  return "READY";
}

export class MicrobiologyEditRejected extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export async function requireEditableMicrobiologyCase(
  tx: Prisma.TransactionClient,
  input: Parameters<typeof lockMicrobiologyCaseForEdit>[1],
): Promise<void> {
  const state = await lockMicrobiologyCaseForEdit(tx, input);
  if (state !== "READY") {
    const code = state === "SPECIMEN_CHANGED" ? "specimen_not_ready_for_microbiology"
      : state === "CASE_LOCKED" ? "microbiology_case_locked"
        : state === "RESULT_ALREADY_SUBMITTED" ? "microbiology_result_submitted_withdraw_before_edit"
          : "microbiology_case_state_changed";
    throw new MicrobiologyEditRejected(code);
  }
}
