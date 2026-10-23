/**
 * A session alone cannot authorize creating a booking for an arbitrary
 * patient. Resolve the linked, live, same-organization principal first.
 * Corporate booking grants are evaluated separately for each patient.
 */
type ActivePrincipal={id:string;organizationId:string;status:string};
type BookingAccount={
  type:string;
  organizationId:string;
  patientId:string|null;
  clientId:string|null;
  patient:ActivePrincipal|null;
  client:ActivePrincipal|null;
};

export type PortalBookingActor=
  | {kind:"PATIENT";patientId:string}
  | {kind:"CORPORATE";clientId:string}
  | {kind:"DENIED"};

export function resolvePortalBookingActor(account:BookingAccount):PortalBookingActor {
  if(account.type==="PATIENT") {
    if(!account.patientId || !account.patient ||
       account.patient.id!==account.patientId ||
       account.patient.organizationId!==account.organizationId ||
       account.patient.status!=="ACTIVE")return {kind:"DENIED"};
    return {kind:"PATIENT",patientId:account.patientId};
  }
  if(account.type==="CORPORATE") {
    if(!account.clientId || !account.client ||
       account.client.id!==account.clientId ||
       account.client.organizationId!==account.organizationId ||
       account.client.status!=="ACTIVE")return {kind:"DENIED"};
    return {kind:"CORPORATE",clientId:account.clientId};
  }
  return {kind:"DENIED"};
}
