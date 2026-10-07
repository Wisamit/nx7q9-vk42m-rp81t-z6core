export type CollectionVerificationType =
  | "DATE_OF_BIRTH"
  | "PATIENT_NUMBER"
  | "PHONE"
  | "EXTERNAL_IDENTIFIER";

export type CollectionPatientVerificationInput = {
  fullNameEn: string;
  fullNameAr: string | null;
  patientNumber: string;
  dateOfBirth: string | null;
  normalizedPhone: string | null;
  identifiers: Array<{
    identifierType: string;
    normalizedValue: string;
    status: string;
  }>;
};

function normalizedName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizedPhone(value: string) {
  return value.replace(/\D/g, "");
}

function normalizedIdentifier(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function maskedTail(value: string, visible = 4) {
  const tail = value.slice(-visible);
  return tail ? `••••${tail}` : "••••";
}

export function verifyCollectionPatientIdentity(input: {
  patient: CollectionPatientVerificationInput;
  enteredName: string;
  secondaryType: string;
  secondaryValue: string;
}) {
  const enteredName = normalizedName(input.enteredName);
  const enName = normalizedName(input.patient.fullNameEn);
  const arName = input.patient.fullNameAr ? normalizedName(input.patient.fullNameAr) : "";
  const matchedNameSnapshot =
    enteredName && enteredName === enName ? input.patient.fullNameEn :
    enteredName && arName && enteredName === arName ? input.patient.fullNameAr! :
    null;

  if (!matchedNameSnapshot) {
    return { ok: false as const, error: "patient_name_verification_failed" };
  }

  const secondaryType = input.secondaryType as CollectionVerificationType;
  if (!["DATE_OF_BIRTH","PATIENT_NUMBER","PHONE","EXTERNAL_IDENTIFIER"].includes(secondaryType)) {
    return { ok: false as const, error: "invalid_secondary_verification_type" };
  }

  const raw = input.secondaryValue.trim();
  if (!raw) return { ok: false as const, error: "secondary_verification_required" };

  if (secondaryType === "DATE_OF_BIRTH") {
    if (!input.patient.dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || raw !== input.patient.dateOfBirth) {
      return { ok: false as const, error: "patient_secondary_verification_failed" };
    }
    return {
      ok: true as const,
      matchedNameSnapshot,
      patientNumberSnapshot: input.patient.patientNumber,
      secondaryType,
      secondarySnapshot: input.patient.dateOfBirth,
    };
  }

  if (secondaryType === "PATIENT_NUMBER") {
    if (raw.toUpperCase() !== input.patient.patientNumber.toUpperCase()) {
      return { ok: false as const, error: "patient_secondary_verification_failed" };
    }
    return {
      ok: true as const,
      matchedNameSnapshot,
      patientNumberSnapshot: input.patient.patientNumber,
      secondaryType,
      secondarySnapshot: input.patient.patientNumber,
    };
  }

  if (secondaryType === "PHONE") {
    const enteredPhone = normalizedPhone(raw);
    const storedPhone = normalizedPhone(input.patient.normalizedPhone || "");
    if (!enteredPhone || !storedPhone || enteredPhone !== storedPhone) {
      return { ok: false as const, error: "patient_secondary_verification_failed" };
    }
    return {
      ok: true as const,
      matchedNameSnapshot,
      patientNumberSnapshot: input.patient.patientNumber,
      secondaryType,
      secondarySnapshot: maskedTail(storedPhone),
    };
  }

  const enteredIdentifier = normalizedIdentifier(raw);
  const matchedIdentifier = input.patient.identifiers.find(identifier =>
    identifier.status === "ACTIVE" &&
    normalizedIdentifier(identifier.normalizedValue) === enteredIdentifier
  );
  if (!enteredIdentifier || !matchedIdentifier) {
    return { ok: false as const, error: "patient_secondary_verification_failed" };
  }
  return {
    ok: true as const,
    matchedNameSnapshot,
    patientNumberSnapshot: input.patient.patientNumber,
    secondaryType,
    secondarySnapshot: `${matchedIdentifier.identifierType} ${maskedTail(matchedIdentifier.normalizedValue)}`,
  };
}

export function collectionLocationError(input: {
  locationType: string;
  locationText: string | null;
}) {
  if (!["BRANCH","HOME","OTHER"].includes(input.locationType)) return "invalid_collection_location_type";
  if (input.locationType !== "BRANCH" && !input.locationText?.trim()) return "collection_location_details_required";
  return null;
}

export function failedCollectionReasonError(input: {
  reasonCode: string | null;
  reasonText: string | null;
}) {
  if (!input.reasonCode?.trim()) return "failed_collection_reason_required";
  if (!input.reasonText?.trim()) return "failed_collection_details_required";
  return null;
}
