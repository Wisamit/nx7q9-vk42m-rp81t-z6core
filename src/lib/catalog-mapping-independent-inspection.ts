import { bundleTriageClass, triagePermissionScope, type TriageClass } from "./catalog-drift-triage.ts";
import {
  mappingDiscussionCurrent, type MappingDiscussionDraft,
} from "./catalog-mapping-discussion-draft.ts";

export type IndependentMappingInspection = {
  status: "INDEPENDENT_FRESH_OBSERVATION_INSPECTION_ONLY";
  category: TriageClass;
  revision: number;
  intent: MappingDiscussionDraft["intent"];
  historicalObservationMatchesDraft: true;
  currentLiveObservationRevalidated: true;
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
 * The caller must recompute the EXACT full author-side live observation using
 * the shared scoped projection, within the same tenant-locked transaction.
 * Fresh parity is a read-only fact, never approval of source lineage or IDs.
 */
export function independentMappingInspection(input: {
  entityType: string;
  authenticatedDraft: MappingDiscussionDraft | null;
  userId: string;
  authorUserId: string;
  currentObservationToken: string;
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
      !mappingDiscussionCurrent(draft,input.currentObservationToken))
    return null;
  return {
    status: "INDEPENDENT_FRESH_OBSERVATION_INSPECTION_ONLY",
    category,revision:draft.revision,intent:draft.intent,
    historicalObservationMatchesDraft:true,
    currentLiveObservationRevalidated:true,
    independentMappingApprovalEligible:false,
    sourceInstanceProven:false,
    mappingApproved:false,signingEnabled:false,reviewOnly:true,
    approved:false,activated:false,liveWrites:false,
  };
}
