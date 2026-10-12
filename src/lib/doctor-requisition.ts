import { createHash } from "node:crypto";

export class DoctorRequisitionError extends Error {
  constructor(readonly code: string, readonly statusCode = 409) { super(code); }
}
export const isUuid = (x: unknown): x is string =>
  typeof x === "string" && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(x);

export type RequisitionInput = {
  patientId: string; branchId: string; clientRequestId: string;
  priority: "ROUTINE" | "URGENT" | "STAT";
  testIds: string[]; diagnosis: string | null; clinicalNotes: string | null;
};
function optionalText(value: unknown, max: number) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
    throw new DoctorRequisitionError("invalid_clinical_text", 400);
  return value.trim() || null;
}
export function parseDoctorRequisition(raw: unknown): RequisitionInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new DoctorRequisitionError("invalid_request", 400);
  const v = raw as Record<string, unknown>;
  if (!isUuid(v.patientId) || !isUuid(v.branchId) || !isUuid(v.clientRequestId))
    throw new DoctorRequisitionError("invalid_requisition_identity", 400);
  if (!["ROUTINE","URGENT","STAT"].includes(String(v.priority)))
    throw new DoctorRequisitionError("invalid_priority", 400);
  if (!Array.isArray(v.testIds) || v.testIds.length < 1 || v.testIds.length > 25 ||
      v.testIds.some(id => !isUuid(id)) || new Set(v.testIds).size !== v.testIds.length)
    throw new DoctorRequisitionError("invalid_test_selection", 400);
  return {
    patientId: v.patientId, branchId: v.branchId, clientRequestId: v.clientRequestId,
    priority: v.priority as RequisitionInput["priority"], testIds: [...v.testIds].sort(),
    diagnosis: optionalText(v.diagnosis, 500), clinicalNotes: optionalText(v.clinicalNotes, 5000),
  };
}
export function doctorRequisitionFingerprint(v: RequisitionInput, referrerId: string, portalAccountId: string) {
  return createHash("sha256").update(JSON.stringify({
    patientId:v.patientId,branchId:v.branchId,referrerId,portalAccountId,
    priority:v.priority,testIds:[...v.testIds].sort(),
    diagnosis:v.diagnosis,clinicalNotes:v.clinicalNotes,
  })).digest("hex");
}
export function matchingRequisitionOrder(v: {
  patientId:string;branchId:string;referrerId:string;priority:string;
  testIds:string[];diagnosis:string|null;clinicalNotes:string|null;
},r: {
  patientId:string;branchId:string;referrerId:string;priority:string;
  testIds:string[];diagnosis:string|null;clinicalNotes:string|null;
}) {
  return v.patientId===r.patientId && v.branchId===r.branchId &&
    v.referrerId===r.referrerId && v.priority===r.priority &&
    (v.diagnosis||null)===(r.diagnosis||null) &&
    (v.clinicalNotes||null)===(r.clinicalNotes||null) &&
    v.testIds.length===r.testIds.length &&
    [...v.testIds].sort().every((id,i)=>id===[...r.testIds].sort()[i]);
}
export function validRequisitionDecisionReason(v: unknown): v is string {
  return typeof v==="string" && v.trim().length>=10 && v.trim().length<=1000 &&
    !/[\u0000-\u001f\u007f]/.test(v);
}
