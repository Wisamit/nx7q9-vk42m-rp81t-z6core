export type PatientDuplicateEvidenceCode = "NAME_DOB" | "PHONE";

export type PatientDuplicateComparable = {
  normalizedName: string;
  dateOfBirth: Date | null;
  normalizedPhone: string | null;
};

function dateKey(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function patientDuplicateEvidence(
  left: PatientDuplicateComparable,
  right: PatientDuplicateComparable,
): PatientDuplicateEvidenceCode[] {
  const evidence: PatientDuplicateEvidenceCode[] = [];

  if (
    left.dateOfBirth
    && right.dateOfBirth
    && left.normalizedName === right.normalizedName
    && dateKey(left.dateOfBirth) === dateKey(right.dateOfBirth)
  ) {
    evidence.push("NAME_DOB");
  }

  if (
    left.normalizedPhone
    && right.normalizedPhone
    && left.normalizedPhone === right.normalizedPhone
  ) {
    evidence.push("PHONE");
  }

  return evidence;
}

export function sortDuplicateCandidates<T extends { evidence: PatientDuplicateEvidenceCode[]; patientNumber: string }>(
  candidates: readonly T[],
) {
  return [...candidates].sort((a, b) =>
    b.evidence.length - a.evidence.length
    || a.patientNumber.localeCompare(b.patientNumber)
  );
}
