import { canonicalJson, type Json } from "./catalog-bundle-attestation.ts";
import { catalogBundleAllowedSourceFields } from "./catalog-bundle-source-boundary.ts";
import { catalogExportTypes, type CatalogExportType } from "./catalog-configuration-export.ts";
import {
  observeCatalogTargetIdentity, type MappingReason,
} from "./catalog-bundle-target-identity.ts";
import { bundleTriageClass, type TriageClass } from "./catalog-drift-triage.ts";

const isObject = (value: unknown): value is Record<string, Json> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const F2_GOVERNED_APPLY_PREREQUISITES = [
  "INDEPENDENT_ORIGINAL_INSTALLATION_PROVENANCE",
  "AUTHORIZED_FOREIGN_TO_LOCAL_ID_MAPPING",
  "QUALIFIED_CLINICAL_POLICY_SIGNOFF",
  "QUALIFIED_FINANCIAL_POLICY_SIGNOFF",
  "EFFECTIVE_DATED_VERSIONED_ATOMIC_APPLY",
  "AUDITED_COMPENSATING_REVERSAL",
  "TEN_CLASS_APPROVED_APPLY_REEXPORT_PARITY",
] as const;

export type F2GovernedReadiness = {
  status: "BLOCKED_EXTERNAL";
  reviewClass: CatalogExportType;
  domain: TriageClass;
  phaseOne: {
    state: "SCOPED_SOURCE_TARGET_EVIDENCE_ONLY";
    signedStageVerified: true;
    liveFieldObservationRevalidated: true;
    sourceInstallationProven: false;
    portableForeignIdentifiers: false;
    identityObservation: "LOCAL_IDENTITY_OBSERVED" | "MAPPING_REQUIRED";
    mappingReasons: readonly MappingReason[];
    projectedFieldCount: number;
    changedFieldCount: number;
    changedFields: readonly string[];
    // No raw source/live values, source UUID or HMAC material is returned.
  };
  phaseTwo: {
    state: "GOVERNED_APPLY_NOT_AUTHORIZED";
    prerequisites: readonly (typeof F2_GOVERNED_APPLY_PREREQUISITES)[number][];
    independentClinicalConsentVerified: false;
    independentFinanceConsentVerified: false;
    approvalPolicyEffectiveDated: false;
    executableApplyPlan: false;
    atomicApplyEnabled: false;
    correctiveReversalEnabled: false;
    approvedRoundTripVerified: false;
  };
  sourceInstanceProven: false;
  mappingApproved: false;
  approved: false;
  signingEnabled: false;
  activated: false;
  liveWrites: false;
  reviewOnly: true;
};

/**
 * Fail-closed, read-only ten-class pre-apply analysis of a previously
 * verified signed stage and exact live observation. The caller MUST enforce
 * current branch/department + finance/clinical grants under one tenant lock.
 *
 * Equal current IDs/codes do not prove an original export installation:
 * no source can acquire medical/finance signoff from this diagnostic route.
 */
export function f2GovernedReadinessPreview(input: {
  entityType: string;
  sourceData: unknown;
  scopedLiveData: unknown;
  signedStageVerified: true;
  liveFieldObservationRevalidated: true;
}): F2GovernedReadiness | null {
  if (!catalogExportTypes.has(input.entityType as CatalogExportType) ||
      !input.signedStageVerified || !input.liveFieldObservationRevalidated ||
      !isObject(input.sourceData) || !isObject(input.scopedLiveData)) return null;
  const reviewClass = input.entityType as CatalogExportType;
  const expected = [...catalogBundleAllowedSourceFields[reviewClass]].sort();
  const sourceFields = Object.keys(input.sourceData).sort();
  const liveFields = Object.keys(input.scopedLiveData).sort();
  // The field contract was already checked against the original export.
  // Refuse to present a supposedly complete dry-run for any partial record.
  if (JSON.stringify(sourceFields) !== JSON.stringify(expected) ||
      JSON.stringify(liveFields) !== JSON.stringify(expected)) return null;
  const domain = bundleTriageClass(reviewClass);
  if (!domain) return null;
  const changedFields: string[] = [];
  try {
    for (const field of expected) {
      const staged = canonicalJson(input.sourceData[field]);
      const live = canonicalJson(input.scopedLiveData[field]);
      if (staged !== live) changedFields.push(field);
    }
  } catch { return null; }
  const identity = observeCatalogTargetIdentity(
    reviewClass, input.sourceData, input.scopedLiveData);
  return {
    status:"BLOCKED_EXTERNAL",reviewClass,domain,
    phaseOne:{
      state:"SCOPED_SOURCE_TARGET_EVIDENCE_ONLY",
      signedStageVerified:true,liveFieldObservationRevalidated:true,
      sourceInstallationProven:false,portableForeignIdentifiers:false,
      identityObservation:identity.status,mappingReasons:identity.reasons,
      projectedFieldCount:expected.length,changedFieldCount:changedFields.length,
      changedFields,
    },
    phaseTwo:{
      state:"GOVERNED_APPLY_NOT_AUTHORIZED",
      prerequisites:F2_GOVERNED_APPLY_PREREQUISITES,
      independentClinicalConsentVerified:false,
      independentFinanceConsentVerified:false,
      approvalPolicyEffectiveDated:false,executableApplyPlan:false,
      atomicApplyEnabled:false,correctiveReversalEnabled:false,
      approvedRoundTripVerified:false,
    },
    sourceInstanceProven:false,mappingApproved:false,approved:false,
    signingEnabled:false,activated:false,liveWrites:false,reviewOnly:true,
  };
}
