import { bundleTriageClass, triagePermissionScope, type TriageClass } from "./catalog-drift-triage.ts";
import {
  mappingDiscussionCurrent, type MappingDiscussionDraft,
} from "./catalog-mapping-discussion-draft.ts";

export type IndependentMappingInspection = {
  status: "INDEPENDENT_DISCUSSION_INSPECTION_ONLY";
  category: TriageClass;
  revision: number;
  intent: MappingDiscussionDraft["intent"];
  historicalObservationMatchesDraft: true;
  currentLiveObservationRevalidated: false;
  independentMappingApprovalEligible: false;
  sourceInstanceProven: false;
  mappingApproved: false;
  signingEnabled: false;
  reviewOnly: true;
  approved: false;
  activated: false;
  liveWrites: false;
};

/**
 * This preflight only surfaces authenticated historical discussion metadata.
 * It cannot recompute the full live drift HMAC, and must NEVER claim that
 * historical observation tokens are still fresh or approve target IDs.
 */
export function independentMappingInspection(input: {
  entityType: string;
  authenticatedDraft: MappingDiscussionDraft | null;
  userId: string;
  authorUserId: string;
  originalPermissions: ReadonlySet<string>;
  currentPermissions: ReadonlySet<string>;
}): IndependentMappingInspection | null {
  const category = bundleTriageClass(input.entityType);
  const draft = input.authenticatedDraft;
  if (!category || !draft || !input.userId ||
      input.userId === input.authorUserId ||
      draft.authorUserId !== input.authorUserId ||
      draft.entityType !== input.entityType ||
      !triagePermissionScope(category,input.originalPermissions) ||
      !triagePermissionScope(category,input.currentPermissions) ||
      !mappingDiscussionCurrent(draft,draft.observationToken))
    return null;
  return {
    status: "INDEPENDENT_DISCUSSION_INSPECTION_ONLY",
    category,revision:draft.revision,intent:draft.intent,
    historicalObservationMatchesDraft:true,
    currentLiveObservationRevalidated:false,
    independentMappingApprovalEligible:false,
    sourceInstanceProven:false,
    mappingApproved:false,signingEnabled:false,reviewOnly:true,
    approved:false,activated:false,liveWrites:false,
  };
}
