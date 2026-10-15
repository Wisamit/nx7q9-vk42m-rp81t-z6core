import { createHash } from "node:crypto";
export type OutboundAck = { code: "AA" | "AE" | "AR"; attempt: number; payload: string | null; error: string | null };
export class OutboundAckError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
export function parseOutboundAck(input: unknown, controlId: string | null): OutboundAck {
  const v = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown> : {};
  if (v.code !== "AA" && v.code !== "AE" && v.code !== "AR") throw new OutboundAckError("acknowledgement_code_invalid");
  if (!Number.isSafeInteger(v.attempt) || (v.attempt as number) < 1) throw new OutboundAckError("acknowledgement_attempt_invalid");
  if (v.payload !== undefined && v.payload !== null &&
      (typeof v.payload !== "string" || Buffer.byteLength(v.payload, "utf8") > 65535)) {
    throw new OutboundAckError("acknowledgement_payload_invalid");
  }
  if (v.error !== undefined && v.error !== null &&
      (typeof v.error !== "string" || v.error.length > 2000)) {
    throw new OutboundAckError("acknowledgement_error_invalid");
  }
  const payload = typeof v.payload === "string" ? v.payload : null;
  if (payload) {
    // Never accept a claimed AA when the instrument actually NAKed a different control ID.
    const segments = payload.split(/\r\n|\r|\n/);
    if (!segments[0].startsWith("MSH|")) throw new OutboundAckError("hl7_ack_header_invalid");
    const acknowledgements = segments.filter(s => s.startsWith("MSA|"));
    if (acknowledgements.length !== 1) throw new OutboundAckError("hl7_ack_msa_invalid");
    const msa = acknowledgements[0].split("|");
    if (msa[1] !== v.code || !controlId || msa[2] !== controlId) {
      throw new OutboundAckError("hl7_ack_control_id_or_code_mismatch");
    }
  }
  return { code: v.code, attempt: v.attempt as number, payload,
    error: typeof v.error === "string" ? v.error : null };
}
export function outboundAckFingerprint(input: OutboundAck) {
  return createHash("sha256").update(JSON.stringify([
    input.attempt, input.code, input.payload, input.error,
  ])).digest("hex");
}
