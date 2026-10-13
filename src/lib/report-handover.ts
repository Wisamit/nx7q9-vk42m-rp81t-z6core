import {createHash} from "node:crypto";

export type HandoverVerificationMethod = "PHOTO_ID_AND_PATIENT_NUMBER" | "TWO_PATIENT_IDENTIFIERS";
export type StaffHandoverInput = {
  handoverRequestId:string;
  patientNumber:string;
  verificationMethod:HandoverVerificationMethod;
  attestedInPerson:true;
};

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const patientNumberPattern=/^[^\x00-\x1f\x7f]{1,50}$/;
export function parseStaffReportHandover(raw:unknown):
  {ok:true;value:StaffHandoverInput}|{ok:false;error:string}{
  if(!raw || typeof raw!=="object" || Array.isArray(raw))
    return {ok:false,error:"invalid_request"};
  const o=raw as Record<string,unknown>;
  const allowed=["handoverRequestId","patientNumber","verificationMethod","attestedInPerson"];
  if(Object.keys(o).some(key=>!allowed.includes(key)))return {ok:false,error:"unexpected_handover_fields"};
  if(typeof o.handoverRequestId!=="string" || !uuid.test(o.handoverRequestId))
    return {ok:false,error:"invalid_handover_request_id"};
  if(typeof o.patientNumber!=="string" ||
    !patientNumberPattern.test(o.patientNumber.trim()))
    return {ok:false,error:"invalid_patient_number"};
  if(o.verificationMethod!=="PHOTO_ID_AND_PATIENT_NUMBER" &&
    o.verificationMethod!=="TWO_PATIENT_IDENTIFIERS")
    return {ok:false,error:"invalid_identity_check"};
  if(o.attestedInPerson!==true)
    return {ok:false,error:"in_person_attestation_required"};
  return {ok:true,value:{
    handoverRequestId:o.handoverRequestId.toLowerCase(),
    patientNumber:o.patientNumber.trim(),
    verificationMethod:o.verificationMethod as HandoverVerificationMethod,
    attestedInPerson:true,
  }};
}
export function reportSnapshotPatientNumber(snapshot:unknown):string|null{
  if(!snapshot || typeof snapshot!=="object" || Array.isArray(snapshot))return null;
  const patient=(snapshot as Record<string,unknown>).patient;
  if(!patient || typeof patient!=="object" || Array.isArray(patient))return null;
  const value=(patient as Record<string,unknown>).patientNumber;
  return typeof value==="string" && value.trim().length>0 ? value.trim() : null;
}
/**
 * Fingerprint only, never persist patient identifiers or ID-document numbers
 * in the delivery event metadata. Fingerprint binds repeat requests exactly.
 */
export function reportHandoverFingerprint(
  versionId:string, input:StaffHandoverInput,
):string{
  return createHash("sha256").update(JSON.stringify([
    "STAFF_ATTESTED_IN_PERSON_HANDOVER_V1",versionId,
    input.patientNumber,input.verificationMethod,input.attestedInPerson,
  ])).digest("hex");
}
export function isStaffHandoverEvent(details:unknown):boolean{
  return Boolean(details && typeof details==="object" && !Array.isArray(details) &&
    (details as Record<string,unknown>).evidenceType==="STAFF_ATTESTED_IN_PERSON_HANDOVER_V1");
}
