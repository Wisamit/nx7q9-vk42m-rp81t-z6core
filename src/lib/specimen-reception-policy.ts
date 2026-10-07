export type ReceptionLabelAssessment = "MATCHED" | "UNLABELED" | "MISMATCHED";

const RECEPTION_CONDITIONS = new Set([
  "GOOD",
  "HEMOLYZED",
  "CLOTTED",
  "LIPEMIC",
  "ICTERIC",
  "LEAKING",
  "CONTAMINATED",
  "OTHER",
]);

export function receptionAssessmentError(input: {
  labelAssessment: string;
  conditionCode: string;
  temperatureC: string | number | null | undefined;
  expectedContainerCode: string | null;
  observedContainerCode: string | null;
  discrepancyText: string | null;
}) {
  if (!["MATCHED","UNLABELED","MISMATCHED"].includes(input.labelAssessment)) return "invalid_label_assessment";
  if (!RECEPTION_CONDITIONS.has(input.conditionCode)) return "invalid_specimen_condition";

  if (input.temperatureC !== null && input.temperatureC !== undefined && String(input.temperatureC).trim() !== "") {
    const temperature = Number(input.temperatureC);
    if (!Number.isFinite(temperature) || temperature < -100 || temperature > 100) return "invalid_temperature_c";
  }

  const expected = input.expectedContainerCode?.trim().toUpperCase() || null;
  const observed = input.observedContainerCode?.trim().toUpperCase() || null;
  const containerMismatch = Boolean(expected && observed && expected !== observed);
  const discrepancy = input.labelAssessment !== "MATCHED" || input.conditionCode !== "GOOD" || containerMismatch;
  if (discrepancy && !input.discrepancyText?.trim()) return "reception_discrepancy_details_required";
  return null;
}

export function selectedRejectionOrderItemIds(input: {
  scope: string;
  activeOrderItemIds: readonly string[];
  requestedOrderItemIds: readonly string[];
}) {
  const active = [...new Set(input.activeOrderItemIds)];
  if (input.scope === "WHOLE_SPECIMEN") return active.length ? active : null;
  if (input.scope !== "SELECTED_TESTS") return null;

  const requested = [...new Set(input.requestedOrderItemIds)];
  if (!requested.length) return null;
  const activeSet = new Set(active);
  if (requested.some(id => !activeSet.has(id))) return null;
  return requested;
}

export function selectiveRejectionNeedsPatientRecollection(parentRelationType: string | null | undefined) {
  return parentRelationType !== "ALIQUOT";
}

export function activeDerivedAliquotConflict(input: {
  affectedOrderItemIds: readonly string[];
  childAliquots: Array<{ status: string; orderItemIds: readonly string[] }>;
}) {
  const affected = new Set(input.affectedOrderItemIds);
  return input.childAliquots.some(child =>
    !["REJECTED","DISPOSED"].includes(child.status)
    && child.orderItemIds.some(orderItemId => affected.has(orderItemId))
  );
}
