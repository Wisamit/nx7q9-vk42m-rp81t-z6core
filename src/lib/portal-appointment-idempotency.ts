import {createHash} from "node:crypto";

/** Keys are optional only to preserve preexisting portal API clients. */
export function portalBookingSubmissionKey(raw:string|null):
  {valid:true;key:string|null}|{valid:false;key:null} {
  if(raw===null)return {valid:true,key:null};
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(raw))
    return {valid:false,key:null};
  return {valid:true,key:raw.toLowerCase()};
}

/** Store a digest of the booking intent, never actual patient or address text. */
export function portalBookingIntentHash(intent:Record<string,string|null>):string {
  const canonical=Object.keys(intent).sort().map(k=>[k,intent[k]]);
  return createHash("sha256").update(JSON.stringify(canonical),"utf8").digest("hex");
}

type Previous={
  portalSubmissionHash:string|null;
  id:string;
  branchId:string;
  patientId:string;
  status:string;
};

export function evaluatePortalBookingReplay(
  previous:Previous|null, fingerprint:string,
):{kind:"new"}|{kind:"conflict"}|{kind:"replay";appointment:Previous} {
  if(!previous)return {kind:"new"};
  if(!previous.portalSubmissionHash || previous.portalSubmissionHash!==fingerprint)
    return {kind:"conflict"};
  return {kind:"replay",appointment:previous};
}
