import type { Prisma } from "../../generated/prisma/client";

/**
 * A UUID generated once per local upload attempt. Absence is accepted for
 * pre-migration/manual clients; a malformed supplied key is rejected.
 */
export function catalogStageSubmissionKey(value: string | null):
  { valid: true; key: string | null } | { valid: false; key: null } {
  if (value === null) return { valid: true, key: null };
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) {
    return { valid: false, key: null };
  }
  return { valid: true, key: value.toLowerCase() };
}

type StageReplayArgs = {
  organizationId: string;
  authorId: string;
  sourceType: string;
  sourceName: string;
  checksum: string;
  submissionKey: string | null;
  expectedStatus: "DRAFT" | "VALIDATED";
};

/**
 * Run ONLY within the same organization-locked transaction AFTER live access
 * validation. A reused key cannot redirect a different payload, source, or
 * processed stage into an apparently successful review receipt.
 */
export async function lookupCatalogStageReplay(
  tx: Pick<Prisma.TransactionClient, "catalogImportBatch">,
  input: StageReplayArgs,
): Promise<{ kind: "new" } | { kind: "conflict" } | { kind: "replay"; id: string }> {
  if (!input.submissionKey) return { kind: "new" };
  const prior = await tx.catalogImportBatch.findFirst({
    where: {
      organizationId: input.organizationId,
      createdByUserId: input.authorId,
      sourceType: input.sourceType,
      submissionKey: input.submissionKey,
    },
    select: {
      id: true, sourceName: true, sourceChecksum: true, status: true,
      importedAt: true,
    },
  });
  if (!prior) return { kind: "new" };
  if (prior.sourceName !== input.sourceName ||
    prior.sourceChecksum !== input.checksum ||
    prior.status !== input.expectedStatus || prior.importedAt !== null) {
    return { kind: "conflict" };
  }
  return { kind: "replay", id: prior.id };
}
