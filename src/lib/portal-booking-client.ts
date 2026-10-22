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
};

export type PortalBookingOutcome=
  | {kind:"requested"; appointmentId:string}
  | {kind:"rejected"; error:string}
  | {kind:"uncertain"};

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requestPortalBooking(
  payload:PortalBookingPayload,
  send:(url:string,init:RequestInit)=>Promise<Response>=fetch,
):Promise<PortalBookingOutcome> {
  try {
    const response=await send("/api/portal/appointments",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload),
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
    if(response.status===201 && response.ok && body?.status==="ok" &&
       typeof appointment?.id==="string" && uuid.test(appointment.id) &&
       appointment.status==="REQUESTED" &&
       appointment.branchId===payload.branchId &&
       appointment.patientId===payload.patientId) {
      return {kind:"requested",appointmentId:appointment.id};
    }
  } catch {
    // HTTP 5xx, lost connection or unreadable confirmation is indeterminate.
    // Never issue an automatic duplicate booking mutation.
  }
  return {kind:"uncertain"};
}
