/**
 * The bridge's currently approved normalized observation contract is deliberately
 * small. Any unknown field (including vendor HIL, analyzer warning and quality
 * qualifiers) must be routed to quarantine/qualified review, never discarded
 * while staging a normal-looking numeric value.
 *
 * This parses metadata only. Original vendor bytes belong in AnalyzerMessage.
 * No vendor-specific interpretation or clinical clearance is implied.
 */
export type BridgeObservation = {
  observationId: string;
  barcode: string;
  analyzerTestCode: string;
  rawValue: string;
  rawUnit: string | null;
};

export type BridgeSubmission = {
  bridgeMessageId: string;
  observations: BridgeObservation[];
};

export type BridgeSubmissionOutcome =
  | {ok:true; submission:BridgeSubmission}
  | {ok:false; error:string; status:number};

const allowedTop=new Set(["bridgeMessageId","observations"]);
const allowedObservation=new Set([
  "observationId","barcode","analyzerTestCode","rawValue","rawUnit",
]);

const record=(value:unknown):value is Record<string,unknown> =>
  value!==null && typeof value==="object" && !Array.isArray(value) &&
  Object.getPrototypeOf(value)===Object.prototype;

function bounded(value:unknown,max:number):string|null {
  if(typeof value!=="string"||value.length===0||value.length>max)
    return null;
  const trimmed=value.trim();
  return trimmed.length>0?trimmed:null;
}

const deny=(error:string,status:number):BridgeSubmissionOutcome=>
  ({ok:false,error,status});

export function parseBridgeObservationSubmission(raw:unknown):BridgeSubmissionOutcome {
  if(!record(raw))return deny("invalid_request",400);
  if(Object.keys(raw).some(key=>!allowedTop.has(key)))
    return deny("analyzer_unapproved_message_metadata_requires_review",409);
  if(!Array.isArray(raw.observations))return deny("invalid_request",400);
  if(raw.observations.length===0||raw.observations.length>500)
    return deny("invalid_observation_count",400);
  const bridgeMessageId=bounded(raw.bridgeMessageId,150);
  if(!bridgeMessageId)return deny("bridge_message_id_required",400);
  const observations:BridgeObservation[]=[];
  const identifiers=new Set<string>();
  for(const value of raw.observations) {
    if(!record(value))return deny("observation_required_fields_missing",400);
    // Fail *before* normalization: dropping unrecognized analyzer metadata
    // would erase evidence of critical vendor warnings or interference.
    if(Object.keys(value).some(key=>!allowedObservation.has(key)))
      return deny("analyzer_unapproved_observation_metadata_requires_review",409);
    const observationId=bounded(value.observationId,150);
    const barcode=bounded(value.barcode,80);
    const analyzerTestCode=bounded(value.analyzerTestCode,120);
    const rawValue=bounded(value.rawValue,1000);
    const rawUnit=value.rawUnit===null||value.rawUnit===undefined?null:
      bounded(value.rawUnit,80);
    if(!observationId||!barcode||!analyzerTestCode||!rawValue||
       (value.rawUnit!==null&&value.rawUnit!==undefined&&!rawUnit))
      return deny("observation_required_fields_missing",400);
    if(identifiers.has(observationId))
      return deny("duplicate_observation_id_in_request",400);
    identifiers.add(observationId);
    observations.push({observationId,barcode,analyzerTestCode,rawValue,rawUnit});
  }
  return {ok:true,submission:{bridgeMessageId,observations}};
}
