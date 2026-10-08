export type SpecimenRequirementInput = {
  orderItemId: string;
  testId: string;
  testCode: string;
  specimenTypeId: string | null;
  specimenTypeCode: string | null;
  specimenTypeNameEn?: string | null;
  specimenTypeNameAr?: string | null;
  containerId: string | null;
  containerCode: string | null;
  containerNameEn?: string | null;
  containerNameAr?: string | null;
  minimumVolume: string | null;
  minimumVolumeUnit: string | null;
  patientPreparation?: string | null;
  collectionInstructions: string | null;
  storageConditions: string | null;
  stabilityMinutes: number | null;
};

export type SpecimenRequirementMemberSnapshot = {
  orderItemId: string;
  testId: string;
  testCode: string;
  minimumVolume: string | null;
  minimumVolumeUnit: string | null;
  patientPreparation: string | null;
  collectionInstructions: string | null;
  storageConditions: string | null;
  stabilityMinutes: number | null;
};

export type SpecimenPlan = {
  specimenTypeId: string | null;
  specimenTypeCode: string | null;
  specimenTypeNameEn: string | null;
  specimenTypeNameAr: string | null;
  containerId: string | null;
  containerCode: string | null;
  containerNameEn: string | null;
  containerNameAr: string | null;
  requiredVolume: string | null;
  requiredVolumeUnit: string | null;
  volumeRequirementComplete: boolean;
  patientPreparation: string[];
  collectionInstructions: string[];
  storageConditions: string | null;
  stabilityMinutes: number | null;
  shared: boolean;
  configurationComplete: boolean;
  orderItemIds: string[];
  members: SpecimenRequirementMemberSnapshot[];
};

function normalizedText(value: string | null | undefined) {
  const normalized = value?.trim() || "";
  return normalized ? normalized.replace(/\s+/g, " ") : "";
}

function parseVolume3(value: string | null) {
  if (value == null || value.trim() === "") return null;
  if (!/^\d+(?:\.\d{1,3})?$/.test(value.trim())) return undefined;
  const [whole, fraction = ""] = value.trim().split(".");
  return BigInt(whole) * BigInt(1000) + BigInt((fraction + "000").slice(0, 3));
}

function formatVolume3(value: bigint) {
  return `${value / BigInt(1000)}.${(value % BigInt(1000)).toString().padStart(3, "0")}`;
}

function compatibilityKey(input: SpecimenRequirementInput) {
  if (!input.specimenTypeId) return `UNCONFIGURED:${input.orderItemId}`;
  const unit = normalizedText(input.minimumVolumeUnit).toUpperCase() || "NO_UNIT";
  const storage = normalizedText(input.storageConditions).toUpperCase() || "NO_STORAGE_RULE";
  const stability = input.stabilityMinutes == null ? "NO_STABILITY_RULE" : String(input.stabilityMinutes);
  return [
    input.specimenTypeId,
    input.containerId || "NO_CONTAINER",
    unit,
    storage,
    stability,
  ].join(":");
}

export function buildSpecimenPlans(inputs: SpecimenRequirementInput[]): SpecimenPlan[] {
  const groups = new Map<string, SpecimenRequirementInput[]>();
  const groupOrder: string[] = [];

  for (const input of inputs) {
    const key = compatibilityKey(input);
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key)!.push(input);
  }

  return groupOrder.map(key => {
    const members = groups.get(key)!;
    const first = members[0];
    const volumes = members.map(member => parseVolume3(member.minimumVolume));
    const invalidVolume = volumes.some(value => value === undefined);
    const missingVolume = volumes.some(value => value === null);
    const volumeUnit = normalizedText(first.minimumVolumeUnit) || null;
    const patientPreparation = [...new Set(
      members.map(member => normalizedText(member.patientPreparation)).filter(Boolean),
    )];
    const instructions = [...new Set(
      members.map(member => normalizedText(member.collectionInstructions)).filter(Boolean),
    )];

    let requiredVolume: string | null = null;
    if (!invalidVolume && !missingVolume && volumes.length > 0) {
      const total = (volumes as bigint[]).reduce((sum, value) => sum + value, BigInt(0));
      requiredVolume = formatVolume3(total);
    }

    return {
      specimenTypeId: first.specimenTypeId,
      specimenTypeCode: first.specimenTypeCode,
      specimenTypeNameEn: first.specimenTypeNameEn || null,
      specimenTypeNameAr: first.specimenTypeNameAr || null,
      containerId: first.containerId,
      containerCode: first.containerCode,
      containerNameEn: first.containerNameEn || null,
      containerNameAr: first.containerNameAr || null,
      requiredVolume,
      requiredVolumeUnit: volumeUnit,
      volumeRequirementComplete: !invalidVolume && !missingVolume,
      patientPreparation,
      collectionInstructions: instructions,
      storageConditions: normalizedText(first.storageConditions) || null,
      stabilityMinutes: first.stabilityMinutes,
      shared: members.length > 1,
      configurationComplete: Boolean(first.specimenTypeId),
      orderItemIds: members.map(member => member.orderItemId),
      members: members.map(member => ({
        orderItemId: member.orderItemId,
        testId: member.testId,
        testCode: member.testCode,
        minimumVolume: member.minimumVolume,
        minimumVolumeUnit: normalizedText(member.minimumVolumeUnit) || null,
        patientPreparation: normalizedText(member.patientPreparation) || null,
        collectionInstructions: normalizedText(member.collectionInstructions) || null,
        storageConditions: normalizedText(member.storageConditions) || null,
        stabilityMinutes: member.stabilityMinutes,
      })),
    };
  });
}

export function specimenRequirementEventDetails(
  plan: SpecimenPlan,
  input: {
    requirementSource: string;
    capturedAt: Date;
    extra?: Record<string, unknown>;
  },
) {
  return {
    ...(input.extra || {}),
    requirementsFinalized: true,
    requirementEngineVersion: 2,
    requirementSource: input.requirementSource,
    requirementCapturedAt: input.capturedAt.toISOString(),
    specimenTypeId: plan.specimenTypeId,
    specimenTypeCode: plan.specimenTypeCode,
    specimenTypeNameEn: plan.specimenTypeNameEn,
    specimenTypeNameAr: plan.specimenTypeNameAr,
    containerId: plan.containerId,
    containerCode: plan.containerCode,
    containerNameEn: plan.containerNameEn,
    containerNameAr: plan.containerNameAr,
    requiredVolume: plan.requiredVolume,
    requiredVolumeUnit: plan.requiredVolumeUnit,
    volumeRequirementComplete: plan.volumeRequirementComplete,
    patientPreparation: plan.patientPreparation,
    collectionInstructions: plan.collectionInstructions,
    storageConditions: plan.storageConditions,
    stabilityMinutes: plan.stabilityMinutes,
    shared: plan.shared,
    configurationComplete: plan.configurationComplete,
    orderItemIds: plan.orderItemIds,
    requirementMembers: plan.members,
  };
}

export function specimenCollectionVolumeError(input: {
  requiredVolume: string | null;
  requiredVolumeUnit: string | null;
  collectedVolume: string | null;
  collectedVolumeUnit: string | null;
}) {
  if (!input.requiredVolume) return null;
  const required = parseVolume3(input.requiredVolume);
  const collected = parseVolume3(input.collectedVolume);
  if (required === undefined || required === null) return "invalid_requirement_snapshot";
  if (collected === null) return "specimen_volume_required";
  if (collected === undefined) return "invalid_volume";

  const requiredUnit = normalizedText(input.requiredVolumeUnit).toUpperCase();
  const collectedUnit = normalizedText(input.collectedVolumeUnit).toUpperCase();
  if (requiredUnit && requiredUnit !== collectedUnit) return "specimen_volume_unit_mismatch";
  if (collected < required) return "insufficient_specimen_volume";
  return null;
}

export function specimenRequirementSnapshotFromDetails(details: unknown) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const record = details as Record<string, unknown>;
  if (record.requirementsFinalized !== true) return null;
  const requiredVolume = typeof record.requiredVolume === "string" ? record.requiredVolume : null;
  const requiredVolumeUnit = typeof record.requiredVolumeUnit === "string" ? record.requiredVolumeUnit : null;
  const members = Array.isArray(record.requirementMembers) ? record.requirementMembers : [];
  const patientPreparation = Array.isArray(record.patientPreparation)
    ? record.patientPreparation.filter((value): value is string => typeof value === "string")
    : [];
  const collectionInstructions = Array.isArray(record.collectionInstructions)
    ? record.collectionInstructions.filter((value): value is string => typeof value === "string")
    : [];
  return {
    requirementEngineVersion: typeof record.requirementEngineVersion === "number" ? record.requirementEngineVersion : 1,
    requirementSource: typeof record.requirementSource === "string" ? record.requirementSource : "LEGACY_FINALIZATION",
    requirementCapturedAt: typeof record.requirementCapturedAt === "string" ? record.requirementCapturedAt : null,
    specimenTypeId: typeof record.specimenTypeId === "string" ? record.specimenTypeId : null,
    specimenTypeCode: typeof record.specimenTypeCode === "string" ? record.specimenTypeCode : null,
    specimenTypeNameEn: typeof record.specimenTypeNameEn === "string" ? record.specimenTypeNameEn : null,
    specimenTypeNameAr: typeof record.specimenTypeNameAr === "string" ? record.specimenTypeNameAr : null,
    containerId: typeof record.containerId === "string" ? record.containerId : null,
    containerCode: typeof record.containerCode === "string" ? record.containerCode : null,
    containerNameEn: typeof record.containerNameEn === "string" ? record.containerNameEn : null,
    containerNameAr: typeof record.containerNameAr === "string" ? record.containerNameAr : null,
    requiredVolume,
    requiredVolumeUnit,
    volumeRequirementComplete: record.volumeRequirementComplete === true,
    patientPreparation,
    collectionInstructions,
    storageConditions: typeof record.storageConditions === "string" ? record.storageConditions : null,
    stabilityMinutes: typeof record.stabilityMinutes === "number" ? record.stabilityMinutes : null,
    shared: record.shared === true,
    configurationComplete: record.configurationComplete === true,
    requirementMembers: members,
  };
}
