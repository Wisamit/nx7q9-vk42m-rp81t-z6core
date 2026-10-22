/**
 * Second, independent ingestion guard over the ORIGINAL stored instrument
 * message. The Bridge may have normalized a supported observation but cannot
 * prove that it retained every manufacturer-specific diagnostic qualifier.
 *
 * Until an explicitly reviewed vendor profile is implemented, deny raw
 * messages with nonempty unhandled flags, caveats, preliminary/corrected
 * statuses, result-level notes, or unrecognized clinical segments.
 * The raw message stays in AnalyzerMessage for qualified investigation.
 *
 * This is deliberately NOT a vendor interference decoder or HIL threshold.
 */
export type AnalyzerRawProtocol = "HL7_V2" | "ASTM";

export function analyzerRawClinicalQualifierDecision(
  protocol:unknown,rawPayload:unknown,
):{eligibleForStaging:boolean;reason:string|null}{
  const deny=(reason:string)=>({eligibleForStaging:false,reason});
  if(typeof rawPayload!=="string"||!rawPayload||
     Buffer.byteLength(rawPayload,"utf8")>1_000_000)
    return deny("ANALYZER_ORIGINAL_MESSAGE_UNVERIFIABLE");
  if(protocol!=="HL7_V2"&&protocol!=="ASTM")
    return deny("ANALYZER_UNAPPROVED_RAW_PROTOCOL");
  const lines=rawPayload.replace(/\r\n/g,"\r").replace(/\n/g,"\r")
    .split("\r").filter(Boolean);
  if(lines.length<3||lines.length>1000)
    return deny("ANALYZER_RAW_RECORD_SEQUENCE_UNVERIFIABLE");
  const rows=lines.map(line=>line.split("|"));
  if(rows.some(row=>row.length>150))
    return deny("ANALYZER_RAW_RECORD_SEQUENCE_UNVERIFIABLE");

  if(protocol==="HL7_V2"){
    if(rows[0][0]!=="MSH" || rows[0][1]!=="^~\\&")
      return deny("ANALYZER_RAW_HL7_HEADER_UNVERIFIABLE");
    let obxCount=0;
    for(const row of rows.slice(1)){
      const type=row[0];
      if(type==="OBX"){
        obxCount++;
        if(!["NM","ST","TX"].includes(row[2]||"")||
           !row[3]||!row[5]||
           row[5].includes("~")||row[5].includes("^")||
           row[5].includes("\\"))
          return deny("ANALYZER_RAW_UNSUPPORTED_RESULT_ENCODING");
        // OBX-7 (reference), OBX-8 (abnormal/interference), OBX-9/10,
        // OBX-12+ may contain vendor caveats, provenance or method details.
        // None has an approved clinical field-level policy in this subset.
        if(row.slice(7).some((item,index)=>index!==4&&
             typeof item==="string"&&item.trim()) ||
           (row[11] && row[11]!=="F"))
          return deny("ANALYZER_RAW_UNREVIEWED_CLINICAL_QUALIFIER");
      } else if(type==="NTE" && row.slice(3).some(item=>item.trim())) {
        return deny("ANALYZER_RAW_UNREVIEWED_CLINICAL_COMMENT");
      } else if(!["PID","PV1","OBR","ORC","SPM","NTE","MSA","DSC"].includes(type)){
        return deny("ANALYZER_RAW_UNKNOWN_CLINICAL_RECORD");
      }
    }
    if(!obxCount||obxCount>500)
      return deny("ANALYZER_RAW_NO_SUPPORTED_OBSERVATIONS");
  }else{
    if(rows[0][0]!=="H"||rows.at(-1)?.[0]!=="L")
      return deny("ANALYZER_RAW_ASTM_FRAME_UNVERIFIABLE");
    let results=0;
    for(const row of rows.slice(1,-1)){
      if(row[0]==="R"){
        results++;
        if(row.slice(5).some(item=>item.trim()))
          return deny("ANALYZER_RAW_UNREVIEWED_CLINICAL_QUALIFIER");
        if(!row[3]||row[3].includes("^")||
           row[3].includes("~")||row[3].includes("\\"))
          return deny("ANALYZER_RAW_UNSUPPORTED_RESULT_ENCODING");
      } else if(!["O","P"].includes(row[0])){
        return deny("ANALYZER_RAW_UNKNOWN_CLINICAL_RECORD");
      }
    }
    if(!results||results>500)
      return deny("ANALYZER_RAW_NO_SUPPORTED_OBSERVATIONS");
  }
  return {eligibleForStaging:true,reason:null};
}
