/** High-risk clinical rule lifecycle proof is scoped to action, type and immutable UUID. */
export const governedClinicalRuleTypes = [
  "CALCULATED_RESULT_RULE",
  "REFLEX_RULE",
  "DELTA_RULE",
  "AUTOVERIFICATION_POLICY",
  "VALIDATION_HOLD_RULE",
  "CRITICAL_ESCALATION_POLICY",
  "RESULT_VALIDATION_POLICY",
] as const;
export type GovernedClinicalRuleType = (typeof governedClinicalRuleTypes)[number];
export type ClinicalRuleProofAction = "CLINICAL_RULE_APPROVE" | "CLINICAL_RULE_RETIRE";
const typeSet = new Set<string>(governedClinicalRuleTypes);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function clinicalRuleProofResource(
  ruleType: string,
  id: string,
): string | null {
  if (!typeSet.has(ruleType) || !UUID.test(id)) return null;
  return ruleType + ":" + id.toLowerCase();
}
export function validClinicalRuleProofResource(resource: string): boolean {
  const colon = resource.indexOf(":");
  return colon !== -1 &&
    clinicalRuleProofResource(resource.slice(0, colon), resource.slice(colon + 1)) === resource;
}
