import { resolvePortalBookingActor } from "./portal-booking-actor.ts";
import { hasLiveDoctorPortalReferrer } from "./doctor-portal-access.ts";

/**
 * Contact OTP can be issued or recorded only for a currently linked,
 * active identity in the same organization as its portal account.
 * A valid cookie alone does not revive a disabled or merged subject.
 */
export function hasLivePortalContactPrincipal(account:{
  type:string;
  organizationId:string;
  patientId:string|null;
  clientId:string|null;
  referrerId:string|null;
  patient:{id:string;organizationId:string;status:string}|null;
  client:{id:string;organizationId:string;status:string}|null;
  referrer:{id:string;organizationId:string;status:string;type:string}|null;
}):boolean {
  if(account.type==="DOCTOR") return hasLiveDoctorPortalReferrer(account);
  if(account.type==="PATIENT" || account.type==="CORPORATE"){
    return resolvePortalBookingActor(account).kind!=="DENIED";
  }
  return false;
}
