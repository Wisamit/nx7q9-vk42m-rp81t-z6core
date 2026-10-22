/**
 * Patient/corporate portal booking mutation boundary.
 * A missing or malformed HTTP 201 acknowledgement cannot be treated as
 * confirmation: the server may have committed an appointment already.
 */
export type PortalBookingPayload={
  branchId:string;
  patientId:string;
  mode:string;
  serviceCode:string;
  serviceNameSnapshot:string;
  scheduledStartLocal:string;
  address:string;
  notes:string;
  /** New portal UI always provides a per-booking UUID; legacy callers may omit it. */
  submissionKey?:string;
};

export type PortalBookingOutcome=
  | {kind:"requested"; appointmentId:string; replayed?:boolean}
  | {kind:"rejected"; error:string}
  | {kind:"uncertain"};

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only these origin-validated 4xx code/status pairs are known to fail
// BEFORE an appointment can commit. Proxy timeouts, throttling, malformed
// errors and unknown response bodies may follow a successful DB commit.
const definiteRejections: Readonly<Record<number, ReadonlySet<string>>> = {
  400: new Set(["invalid_portal_appointment_key","patient_required",
    "invalid_booking_request","home_collection_address_required",
    "invalid_branch_local_schedule"]),
  401: new Set(["portal_unauthorized"]),
  403: new Set(["doctor_booking_not_enabled","corporate_patient_not_authorized_for_booking"]),
  404: new Set(["branch_or_patient_not_found"]),
  409: new Set(["portal_appointment_key_conflict"]),
};

export async function requestPortalBooking(
  payload:PortalBookingPayload,
  send:(url:string,init:RequestInit)=>Promise<Response>=fetch,
):Promise<PortalBookingOutcome> {
  try {
    const {submissionKey,...booking}=payload;
    const headers:Record<string,string>={"Content-Type":"application/json"};
    if(submissionKey)headers["x-family-lab-portal-appointment-key"]=submissionKey;
    const response=await send("/api/portal/appointments",{
      method:"POST",headers,
      body:JSON.stringify(booking),
    });
    const raw:unknown=await response.json().catch(()=>null);
    const body=raw && typeof raw==="object" && !Array.isArray(raw)
      ? raw as Record<string,unknown> : null;
    if(response.status>=400 && response.status<500){
      const error=typeof body?.error==="string"?body.error:null;
      // HTTP 408/425/429/499, proxy-generated 4xx and malformed JSON are
      // indeterminate; an earlier POST may already have committed.
      if(error && definiteRejections[response.status]?.has(error)){
        return {kind:"rejected",error};
      }
      return {kind:"uncertain"};
    }
    const record=body?.appointment;
    const appointment=record && typeof record==="object" && !Array.isArray(record)
      ? record as Record<string,unknown> : null;
    const isNew=response.status===201 && body?.replayed!==true &&
      appointment?.status==="REQUESTED";
    const isReplay=response.status===200 && body?.replayed===true &&
      ["REQUESTED","CONFIRMED","CHECKED_IN","COMPLETED","CANCELLED","NO_SHOW"]
        .includes(String(appointment?.status));
    if((isNew || isReplay) && response.ok && body?.status==="ok" &&
       typeof appointment?.id==="string" && uuid.test(appointment.id) &&
       appointment.branchId===payload.branchId &&
       appointment.patientId===payload.patientId) {
      return isReplay ? {kind:"requested",appointmentId:appointment.id,replayed:true} :
        {kind:"requested",appointmentId:appointment.id};
    }
  } catch {
    // HTTP 5xx, lost connection or unreadable confirmation is indeterminate.
    // Never issue an automatic duplicate booking mutation.
  }
  return {kind:"uncertain"};
}
