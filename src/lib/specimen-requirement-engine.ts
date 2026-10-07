export type SpecimenRequirementInput = {
  orderItemId: string;
  testId: string;
  testCode: string;
  specimenTypeId: string | null;
  specimenTypeCode: string | null;
  containerId: string | null;
  containerCode: string | null;
  minimumVolume: string | null;
  minimumVolumeUnit: string | null;
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
  collectionInstructions: string | null;
  storageConditions: string | null;
  stabilityMinutes: number | null;
};

export type SpecimenPlan = {
  specimenTypeId: string | null;
  specimenTypeCode: string | null;
  containerId: string | null;
  containerCode: string | null;
  requiredVolume: string | null;
  requiredVolumeUnit: string | null;
  volumeRequirementComplete: boolean;
  collectionInstructions: string[];
  storageConditions: string | null;
  stabilityMinutes: number | null;
  shared: boolean;
  configurationComplete: boolean;
  orderItemIds: string[];
  members: SpecimenRequirementMemberSnapshot[];
};

function normalizedText(value: string | null) {
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
    const instructions = [...new Set(
      members
        .map(member => normalizedText(member.collectionInstructions))
        .filter(Boolean),
    )];

    let requiredVolume: string | null = null;
    if (!invalidVolume && !missingVolume && volumes.length > 0) {
      const total = (volumes as bigint[]).reduce((sum, value) => sum + value, BigInt(0));
      requiredVolume = formatVolume3(total);
    }

    return {
      specimenTypeId: first.specimenTypeId,
      specimenTypeCode: first.specimenTypeCode,
      containerId: first.containerId,
      containerCode: first.containerCode,
      requiredVolume,
      requiredVolumeUnit: volumeUnit,
      volumeRequirementComplete: !invalidVolume && !missingVolume,
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
        collectionInstructions: normalizedText(member.collectionInstructions) || null,
        storageConditions: normalizedText(member.storageConditions) || null,
        stabilityMinutes: member.stabilityMinutes,
      })),
    };
  });
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
  const requiredVolume = typeof record.requiredVolume === "string" ? record.requiredVolume : null;
  const requiredVolumeUnit = typeof record.requiredVolumeUnit === "string" ? record.requiredVolumeUnit : null;
  const members = Array.isArray(record.requirementMembers) ? record.requirementMembers : [];
  const collectionInstructions = Array.isArray(record.collectionInstructions)
    ? record.collectionInstructions.filter((value): value is string => typeof value === "string")
    : [];
  return {
    requiredVolume,
    requiredVolumeUnit,
    volumeRequirementComplete: record.volumeRequirementComplete === true,
    collectionInstructions,
    storageConditions: typeof record.storageConditions === "string" ? record.storageConditions : null,
    stabilityMinutes: typeof record.stabilityMinutes === "number" ? record.stabilityMinutes : null,
    shared: record.shared === true,
    configurationComplete: record.configurationComplete === true,
    requirementMembers: members,
  };
}
