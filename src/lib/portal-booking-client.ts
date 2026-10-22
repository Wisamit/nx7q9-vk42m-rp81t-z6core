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
      return {kind:"rejected",error:typeof body?.error==="string"?body.error:"unknown"};
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
