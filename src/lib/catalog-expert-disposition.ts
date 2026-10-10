import {
  bundleTriageClass, matchesCatalogDriftObservation,
  triagePermissionScope, type TriageClass,
} from "./catalog-drift-triage.ts";

export type ExpertDisposition = "CONFIRM_FINDING" | "RETURN_FOR_CORRECTION";

export function validExpertDisposition(value: unknown): value is ExpertDisposition {
  return value === "CONFIRM_FINDING" || value === "RETURN_FOR_CORRECTION";
}

/**
 * Independent second-party review of a precise, current Stage 53 finding.
 * This is a procedural disposition, NEVER clinical/price approval.
 */
export function expertDispositionAllowed(input: {
  expertUserId: string;
  batchAuthorId: string;
  flagActorUserId: string | null;
  eventCategory: unknown;
  entityType: string;
  flaggedEvidence: unknown;
  latestEvidence: string;
  sessionPermissions: ReadonlySet<string>;
  livePermissions: ReadonlySet<string>;
  isLatestFlag: boolean;
  isOpenDraft: boolean;
}) {
  const category = bundleTriageClass(input.entityType);
  if (!category || !input.isOpenDraft) return { allowed: false, reason: "review_not_open" } as const;
  if (input.expertUserId === input.batchAuthorId ||
      input.flagActorUserId !== input.batchAuthorId ||
      input.flagActorUserId === input.expertUserId) {
    return { allowed: false, reason: "independent_reviewer_required" } as const;
  }
  if (input.eventCategory !== category ||
      !triagePermissionScope(category, input.sessionPermissions) ||
      !triagePermissionScope(category, input.livePermissions)) {
    return { allowed: false, reason: "expert_domain_permission_required" } as const;
  }
  if (!input.isLatestFlag ||
      !matchesCatalogDriftObservation(input.flaggedEvidence, input.latestEvidence)) {
    return { allowed: false, reason: "expert_evidence_stale" } as const;
  }
  return { allowed: true, category: category as TriageClass } as const;
}
