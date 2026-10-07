const VOLUME_SCALE = BigInt(1000);
const MAX_VOLUME_MINOR = BigInt("9999999999");

export type VolumeTrackedSpecimenStatus =
  | "COLLECTED"
  | "RECEIVED"
  | "IN_PROCESS"
  | "PLANNED"
  | "IN_TRANSIT"
  | "REJECTED"
  | "DISPOSED";

export function volume3ToMinor(value: string | number | null | undefined) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!/^\d{1,7}(?:\.\d{1,3})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const minor = BigInt(whole) * VOLUME_SCALE + BigInt((fraction + "000").slice(0, 3));
  return minor <= MAX_VOLUME_MINOR ? minor : null;
}

export function minorToVolume3(value: bigint) {
  if (value < BigInt(0) || value > MAX_VOLUME_MINOR) return null;
  return `${value / VOLUME_SCALE}.${(value % VOLUME_SCALE).toString().padStart(3, "0")}`;
}

export function normalizeVolumeUnit(value: string | null | undefined) {
  const unit = value?.trim() || "";
  return unit ? unit.toLowerCase() : null;
}

export function volumeUnitsMatch(left: string | null | undefined, right: string | null | undefined) {
  const a = normalizeVolumeUnit(left);
  const b = normalizeVolumeUnit(right);
  return Boolean(a && b && a === b);
}

export function specimenVolumeUseError(input: {
  status: VolumeTrackedSpecimenStatus;
  remainingVolume: string | null;
  remainingVolumeUnit: string | null;
  requestedVolume: string;
  requestedVolumeUnit: string | null;
}) {
  if (!["COLLECTED","RECEIVED","IN_PROCESS"].includes(input.status)) return "specimen_status_not_usable";
  const remaining = volume3ToMinor(input.remainingVolume);
  if (remaining === null || !input.remainingVolumeUnit) return "available_volume_reconciliation_required";
  const requested = volume3ToMinor(input.requestedVolume);
  if (requested === null || requested <= BigInt(0)) return "invalid_usage_volume";
  if (!volumeUnitsMatch(input.remainingVolumeUnit, input.requestedVolumeUnit)) return "volume_unit_mismatch";
  if (requested > remaining) return "insufficient_available_volume";
  return null;
}

export function reconciledVolumeError(input: {
  status: VolumeTrackedSpecimenStatus;
  originalVolume: string | null;
  originalVolumeUnit: string | null;
  trackedVolumeUnit?: string | null;
  availableVolume: string;
  availableVolumeUnit: string | null;
}) {
  if (!["COLLECTED","RECEIVED","IN_PROCESS"].includes(input.status)) return "specimen_status_not_reconcilable";
  const available = volume3ToMinor(input.availableVolume);
  if (available === null) return "invalid_available_volume";
  if (!input.availableVolumeUnit?.trim()) return "volume_unit_required";
  if (input.trackedVolumeUnit && !volumeUnitsMatch(input.trackedVolumeUnit, input.availableVolumeUnit)) {
    return "volume_unit_mismatch";
  }
  const original = volume3ToMinor(input.originalVolume);
  if (original !== null) {
    if (!volumeUnitsMatch(input.originalVolumeUnit, input.availableVolumeUnit)) return "volume_unit_mismatch";
    if (available > original) return "available_volume_exceeds_original";
  }
  return null;
}

export function remainingAfterUse(remainingVolume: string, requestedVolume: string) {
  const remaining = volume3ToMinor(remainingVolume);
  const requested = volume3ToMinor(requestedVolume);
  if (remaining === null || requested === null || requested > remaining) return null;
  return minorToVolume3(remaining - requested);
}

export function aliquotPurposeRequiresTests(purpose: string) {
  return purpose === "TESTING" || purpose === "SEND_OUT";
}


export function specimenRejectionLineageError(children: Array<{
  parentRelationType: string | null;
  status: string;
}>) {
  return children.some(child =>
    child.parentRelationType === "ALIQUOT" && !["REJECTED","DISPOSED"].includes(child.status))
    ? "active_child_aliquots_require_resolution"
    : null;
}
