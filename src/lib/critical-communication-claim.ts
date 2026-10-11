import type { Prisma } from "../../generated/prisma/client";

export type CriticalCommunicationOutcome =
  | "ACKNOWLEDGED" | "NO_ANSWER" | "LEFT_MESSAGE" | "FAILED" | "ESCALATED";

export type CriticalCommunicationClaim = {
  eventId: string;
  resultId: string;
  organizationId: string;
  performingBranchId: string;
  observedEscalationLevel: number;
  observedUpdatedAt: Date;
  outcome: CriticalCommunicationOutcome;
  communicatedAt: Date;
  communicatorId: string;
  nextEscalationDueAt: Date | null;
};

/**
 * Atomically reserve an OPEN critical event before persisting an attempt,
 * acknowledgement, escalation or audit. Every attempt increments the row's
 * monotonic concurrency stamp, including failed phone calls: a stale client
 * can never append evidence to an already acknowledged or advanced event.
 */
export async function claimCriticalCommunication(
  tx: Pick<Prisma.TransactionClient, "criticalResultEvent">,
  input: CriticalCommunicationClaim,
): Promise<boolean> {
  const acknowledged = input.outcome === "ACKNOWLEDGED";
  const escalated = input.outcome === "ESCALATED";
  const versionStamp = new Date(Math.max(
    input.communicatedAt.getTime(), input.observedUpdatedAt.getTime() + 1,
  ));
  const update = await tx.criticalResultEvent.updateMany({
    where: {
      id: input.eventId,
      resultId: input.resultId,
      status: "OPEN",
      escalationLevel: input.observedEscalationLevel,
      updatedAt: input.observedUpdatedAt,
      result: {
        organizationId: input.organizationId,
        performingBranchId: input.performingBranchId,
        OR: [
          { status: { in: ["VERIFIED", "RELEASED"] } },
          { status: "ENTERED", validationStage: "MEDICAL_VALIDATION" },
        ],
      },
    },
    data: {
      updatedAt: versionStamp,
      ...(acknowledged ? {
        status: "ACKNOWLEDGED" as const,
        acknowledgedAt: input.communicatedAt,
        acknowledgedByUserId: input.communicatorId,
        nextEscalationDueAt: null,
      } : escalated ? {
        escalationLevel: { increment: 1 },
        nextEscalationDueAt: input.nextEscalationDueAt,
      } : {}),
    },
  });
  return update.count === 1;
}
