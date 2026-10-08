export function normalizePatientName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}

export function normalizePatientPhone(value: string) {
  return value.replace(/[^0-9+]/g, "");
}

export function normalizePatientIdentifier(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}
