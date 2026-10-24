import { createHash, timingSafeEqual } from "node:crypto";
import type { BridgeObservation } from "./analyzer-bridge-observation-boundary";

type RawProtocol = "HL7_V2" | "ASTM";
type RawObservation = Pick<BridgeObservation,
  "observationId" | "barcode" | "analyzerTestCode" | "rawValue" | "rawUnit">;

export type RawObservationIntegrityOutcome =
  | { ok: true }
  | { ok: false; reason: string };

const denied = (reason: string): RawObservationIntegrityOutcome =>
  ({ ok: false, reason });
const safeId = /^[A-Za-z0-9._/-]+$/;
const exactId = (v: unknown, max: number) =>
  typeof v === "string" && v.length > 0 && v.length <= max &&
  safeId.test(v);
const fields = (text: string) =>
  text.replace(/\r\n/g, "\r").replace(/\n/g, "\r")
    .split("\r").filter(Boolean).map(row => row.split("|"));
const hashHex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");
const hashMatches = (raw: string, stored: unknown): boolean => {
  if (typeof stored !== "string" || !/^[a-f0-9]{64}$/.test(stored)) return false;
  return timingSafeEqual(Buffer.from(hashHex(raw), "hex"), Buffer.from(stored, "hex"));
};

/**
 * Independent, lossless binding of normalized staging input to the already
 * persisted ORIGINAL analyzer message. The clinical qualifier guard MUST run
 * independently and first; this function is NOT a vendor status/flag decoder.
 *
 * It permits ONLY the exact syntactic subset already understood by the Bridge.
 * When two potential HL7 specimen-identifier sources disagree, there is no
 * server-approved source mapping to choose between them: deny the observation.
 * Require a one-to-one match across the ENTIRE original set, not a plausible
 * substring/value occurrence (which could belong to another specimen).
 *
 * No vendor interference limits, unit conversion, result correction, clinical
 * clearance or result release is implied by a successful byte-level match.
 */
export function verifyOriginalAnalyzerObservationBinding(input: {
  protocol: RawProtocol | string;
  rawPayload: unknown;
  storedPayloadHash: unknown;
  bridgeMessageId: string;
  observations: readonly BridgeObservation[];
}): RawObservationIntegrityOutcome {
  if (typeof input.rawPayload !== "string" || !input.rawPayload ||
      Buffer.byteLength(input.rawPayload, "utf8") > 1_000_000 ||
      !hashMatches(input.rawPayload, input.storedPayloadHash))
    return denied("ANALYZER_ORIGINAL_PAYLOAD_HASH_MISMATCH");
  if (!Array.isArray(input.observations) ||
      input.observations.length === 0 || input.observations.length > 500)
    return denied("ANALYZER_ORIGINAL_OBSERVATION_COUNT_MISMATCH");
  if (!exactId(input.bridgeMessageId, 150))
    return denied("ANALYZER_ORIGINAL_MESSAGE_ID_MISMATCH");
  const rows = fields(input.rawPayload);
  if (rows.length < 3 || rows.length > 1000 || rows.some(row => row.length > 150))
    return denied("ANALYZER_ORIGINAL_RECORD_SET_INVALID");

  const observed: RawObservation[] = [];
  if (input.protocol === "HL7_V2") {
    if (rows[0][0] !== "MSH" || rows[0][1] !== "^~\\&" ||
        rows[0][9] !== input.bridgeMessageId ||
        rows[0][8]?.split("^")[0] !== "ORU" ||
        rows[0][8]?.split("^")[1] !== "R01")
      return denied("ANALYZER_ORIGINAL_MESSAGE_ID_MISMATCH");
    let orderIndex = 0;
    let groupHasObx = false;
    let obrBarcode: string | null = null;
    let spmBarcode: string | null = null;
    for (const row of rows.slice(1)) {
      if (row[0] === "OBR") {
        orderIndex++;
        groupHasObx = false;
        obrBarcode = row[3] || null;
        spmBarcode = null;
      } else if (row[0] === "SPM") {
        if (!orderIndex || groupHasObx)
          return denied("ANALYZER_ORIGINAL_SPECIMEN_BINDING_UNVERIFIABLE");
        spmBarcode = row[2] || null;
      } else if (row[0] === "OBX") {
        if (!orderIndex || !exactId(row[1], 20))
          return denied("ANALYZER_ORIGINAL_OBSERVATION_ID_UNVERIFIABLE");
        const code = row[3]?.split("^")[0] || "";
        const barcode = obrBarcode || spmBarcode || "";
        if (!exactId(code, 120) || !exactId(barcode, 80) ||
            (spmBarcode && obrBarcode && spmBarcode !== obrBarcode))
          return denied("ANALYZER_ORIGINAL_SPECIMEN_BINDING_UNVERIFIABLE");
        if (typeof row[5] !== "string" || !row[5] || row[5].length > 1000)
          return denied("ANALYZER_ORIGINAL_RESULT_UNVERIFIABLE");
        const unit = row[6]?.split("^")[0] || null;
        if (unit && unit.length > 80)
          return denied("ANALYZER_ORIGINAL_RESULT_UNVERIFIABLE");
        observed.push({
          observationId: input.bridgeMessageId + ":" + orderIndex + ":" + row[1],
          barcode, analyzerTestCode: code, rawValue: row[5], rawUnit: unit,
        });
        groupHasObx = true;
      }
    }
  } else if (input.protocol === "ASTM") {
    if (rows[0][0] !== "H" || rows.at(-1)?.[0] !== "L" ||
        input.bridgeMessageId !== "astm-" + hashHex(input.rawPayload))
      return denied("ANALYZER_ORIGINAL_MESSAGE_ID_MISMATCH");
    let orderIndex = 0, resultIndex = 0, barcode = "";
    for (const row of rows.slice(1, -1)) {
      if (row[0] === "O") {
        orderIndex++;
        resultIndex = 0;
        barcode = row[2]?.split("^")[0] || "";
      } else if (row[0] === "R") {
        if (!orderIndex || !exactId(barcode, 80))
          return denied("ANALYZER_ORIGINAL_SPECIMEN_BINDING_UNVERIFIABLE");
        resultIndex++;
        const code = row[2]?.split("^").filter(Boolean).at(-1) || "";
        const value = row[3], unit = row[4] || null;
        if (!exactId(code, 120) || typeof value !== "string" ||
            !value || value.length > 1000 || (unit && unit.length > 80))
          return denied("ANALYZER_ORIGINAL_RESULT_UNVERIFIABLE");
        observed.push({
          observationId: input.bridgeMessageId + ":" + orderIndex + ":" + resultIndex,
          barcode, analyzerTestCode: code, rawValue: value, rawUnit: unit,
        });
      }
    }
  } else return denied("ANALYZER_ORIGINAL_PROTOCOL_UNSUPPORTED");

  if (observed.length !== input.observations.length || !observed.length ||
      observed.length > 500)
    return denied("ANALYZER_ORIGINAL_OBSERVATION_COUNT_MISMATCH");

  const rawById = new Map<string, RawObservation>();
  for (const row of observed) {
    if (rawById.has(row.observationId))
      return denied("ANALYZER_ORIGINAL_OBSERVATION_ID_UNVERIFIABLE");
    rawById.set(row.observationId, row);
  }
  const matched = new Set<string>();
  for (const row of input.observations) {
    const raw = rawById.get(row.observationId);
    if (!raw || matched.has(row.observationId) ||
        raw.barcode !== row.barcode ||
        raw.analyzerTestCode !== row.analyzerTestCode ||
        raw.rawValue !== row.rawValue ||
        raw.rawUnit !== row.rawUnit)
      return denied("ANALYZER_NORMALIZED_PAYLOAD_DIFFERS_FROM_ORIGINAL");
    matched.add(row.observationId);
  }
  return { ok: true };
}
