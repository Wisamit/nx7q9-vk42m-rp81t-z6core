/**
 * Client-safe proposal vocabulary. Every selection is a nonbinding draft,
 * NOT an authorized role, electronic signature or activation permission.
 */
export const catalogPolicyChoices = {
  clinicalAuthority: ["UNDECIDED", "MEDICAL_DIRECTOR", "DESIGNATED_CLINICAL_LEAD"],
  financialAuthority: ["UNDECIDED", "FINANCE_DIRECTOR", "DESIGNATED_FINANCIAL_LEAD"],
  branchDelegation: ["UNDECIDED", "BRANCH_SPECIFIC", "CENTRAL_WITH_BRANCH_SCOPE"],
  reviewerSeparation: ["UNDECIDED", "AUTHOR_AND_TWO_DISTINCT_REVIEWERS"],
  signerAuthentication: ["UNDECIDED", "MFA_REAUTH_AT_SIGNING"],
  versionedApplication: ["UNDECIDED", "ATOMIC_EFFECTIVE_DATED_VERSIONING"],
  clinicalSafetyCheck: ["UNDECIDED", "INDEPENDENT_CLINICAL_RANGE_REVIEW"],
} as const;

export type CatalogPolicyKey = keyof typeof catalogPolicyChoices;
export type CatalogPolicyProposal = {
  [K in CatalogPolicyKey]: (typeof catalogPolicyChoices)[K][number]
};
export const policyKeys = Object.keys(catalogPolicyChoices).sort() as CatalogPolicyKey[];
