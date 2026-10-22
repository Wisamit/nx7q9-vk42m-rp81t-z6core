import { createHash } from "node:crypto";

export class UnsupportedAnalyzerFrame extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function reject(code) { throw new UnsupportedAnalyzerFrame(code); }
function nonempty(value, code, limit) {
  if (typeof value !== "string" || !value || value.length > limit) reject(code);
  return value;
}
function safeIdentifier(value, name, max) {
  const id=nonempty(value,name,max);
  if (!/^[A-Za-z0-9._/-]+$/.test(id)) reject(name);
  return id;
}

/**
 * Conservative HL7 v2 ORU^R01 subset.
 * Barcodes must come from an operator-approved source field. OBR-3 is not
 * automatically assumed to be a sample barcode in vendor protocols.
 * Decode only explicitly supported observation types: ST, TX and NM.
 */
export function parseHl7Oru(raw, { barcodeSource } = {}) {
  if (typeof raw !== "string" || raw.length === 0 || !raw.startsWith("MSH|")) reject("HL7_MSH_REQUIRED");
  if (!["OBR_3","SPM_2"].includes(barcodeSource)) reject("HL7_BARCODE_PROFILE_REQUIRED");
  const segments=raw.replace(/\r\n/g,"\r").replace(/\n/g,"\r").split("\r").filter(Boolean).map(row=>row.split("|"));
  if (segments.length > 1000 || segments.some(row=>row.length > 150)) reject("HL7_MESSAGE_TOO_COMPLEX");
  const msh=segments[0];
  if (msh[0] !== "MSH" || msh[1] !== "^~\\&") reject("HL7_ENCODING_NOT_SUPPORTED");
  if (msh[8]?.split("^")[0] !== "ORU" || msh[8]?.split("^")[1] !== "R01") reject("HL7_ORU_R01_REQUIRED");
  const messageId=safeIdentifier(msh[9],"HL7_MESSAGE_CONTROL_ID_INVALID",150);
  const observations=[];
  let obrCount=0;
  let specimen=null;
  let groupHasObx=false;
  const obxIds=new Set();
  for (const row of segments.slice(1)) {
    const type=row[0];
    if (type === "OBR") {
      obrCount++;
      groupHasObx=false;
      specimen=barcodeSource === "OBR_3" ? row[3] || null : null;
    } else if (type === "SPM" && barcodeSource === "SPM_2") {
      if (groupHasObx) reject("HL7_SPM_AFTER_OBX_UNSUPPORTED");
      if (!obrCount) reject("HL7_OBR_REQUIRED");
      specimen=row[2] || null;
    } else if (type === "OBX") {
      if (!obrCount) reject("HL7_OBR_REQUIRED");
      const obxIndex=safeIdentifier(row[1],"HL7_OBX_SET_ID_INVALID",20);
      const id=obrCount+":"+obxIndex;
      if (obxIds.has(id)) reject("HL7_DUPLICATE_OBX_SET_ID");
      obxIds.add(id);
      // OBX-8 may contain abnormal, interference or instrument warning flags.
      // Without an approved vendor/clinical mapping, silently dropping these
      // qualifiers could incorrectly promote an unsafe result to normal.
      if (row[8]) reject("HL7_OBSERVATION_FLAG_REQUIRES_APPROVED_POLICY");
      // Preliminary/corrected/suppressed statuses are NOT standard final
      // results. Corrected values need the governed amendment path.
      if (row[11] && row[11] !== "F")
        reject("HL7_OBSERVATION_STATUS_REQUIRES_APPROVED_POLICY");
      const valueType=row[2];
      if (!["NM","ST","TX"].includes(valueType)) reject("HL7_OBX_VALUE_TYPE_UNSUPPORTED");
      const code=safeIdentifier(row[3]?.split("^")[0],"HL7_TEST_CODE_INVALID",120);
      const barcode=safeIdentifier(specimen,"HL7_BARCODE_INVALID",80);
      const value=nonempty(row[5],"HL7_OBX_VALUE_REQUIRED",1000);
      // Reject repetitions/subcomponents/HL7 escapes rather than implicitly
      // interpreting vendor-specific value encodings.
      if (value.includes("~") || value.includes("^") || value.includes("\\")
        || value.includes("\n")) reject("HL7_COMPLEX_VALUE_REQUIRES_VENDOR_PROFILE");
      const rawUnit=row[6]?.split("^")[0] || null;
      if (rawUnit && rawUnit.length>80) reject("HL7_UNIT_TOO_LONG");
      observations.push({
        observationId:messageId+":"+id,
        barcode,
        analyzerTestCode:code,
        rawValue:value,
        rawUnit,
      });
      groupHasObx=true;
    } else if (type === "NTE" && row.slice(3).some(value=>value && value.trim())) {
      // Free-text analyzer notes can carry critical interpretive caveats.
      reject("HL7_OBSERVATION_COMMENT_REQUIRES_APPROVED_PROFILE");
    } else if (!["PID","PV1","SPM","NTE","ORC","MSA","DSC"].includes(type)) {
      // Allow empty/trailing segments, but reject unknown clinical segments:
      // the bridge must not silently drop related clinical information.
      reject("HL7_SEGMENT_UNSUPPORTED");
    }
  }
  if (!observations.length) reject("HL7_NO_OBSERVATIONS");
  if (observations.length>500) reject("HL7_TOO_MANY_OBSERVATIONS");
  return { protocol:"HL7_V2", bridgeMessageId:messageId, observations };
}

/**
 * ASTM E1394 record-level subset. The transport adapter must validate
 * E1381 framing/checksum BEFORE passing unframed records here.
 * It is not safe to auto-acknowledge checksum-less serial frames.
 * Vendor-specific O/R field positions are configured explicitly.
 */
export function parseAstmRecords(raw, profile={}) {
  if (typeof raw!=="string" || !raw.startsWith("H|")) reject("ASTM_HEADER_REQUIRED");
  if (raw.includes("\x02") || raw.includes("\x03") || raw.includes("\x17")) reject("ASTM_TRANSPORT_FRAME_UNVERIFIED");
  if (profile.approved !== true || profile.sampleIdField !== 2
      || profile.testCodeField !== 2 || profile.valueField !== 3
      || profile.unitField !== 4) reject("ASTM_APPROVED_PROFILE_REQUIRED");
  const rows=raw.replace(/\r\n/g,"\r").replace(/\n/g,"\r").split("\r").filter(Boolean).map(x=>x.split("|"));
  if (rows[0]?.[0]!=="H" || rows.at(-1)?.[0]!=="L" || rows.length>1000) reject("ASTM_RECORD_SEQUENCE_INVALID");
  const observations=[];
  let orderSequence=0,resultSequence=0,barcode=null;
  for(const row of rows.slice(1,-1)){
    if (row[0]==="P") continue;
    if (row[0]==="O") {
      orderSequence++;
      barcode=safeIdentifier(row[profile.sampleIdField]?.split("^")[0],"ASTM_BARCODE_INVALID",80);
      resultSequence=0;
    } else if (row[0]==="R") {
      if (!barcode) reject("ASTM_ORDER_REQUIRED");
      resultSequence++;
      const code=safeIdentifier(row[profile.testCodeField]?.split("^").filter(Boolean).at(-1),"ASTM_TEST_CODE_INVALID",120);
      const value=nonempty(row[profile.valueField],"ASTM_RESULT_REQUIRED",1000);
      // Later R fields can carry reference qualifiers, abnormal flags,
      // result status and clinical caveats. This subset has no approved
      // mapping for them and must not silently drop nonempty values.
      if (row.slice(5).some(value=>value && value.trim()))
        reject("ASTM_RESULT_QUALIFIER_REQUIRES_APPROVED_PROFILE");
      if (value.includes("^")||value.includes("\\")||value.includes("~")) reject("ASTM_COMPLEX_VALUE_UNSUPPORTED");
      const rawUnit=row[profile.unitField] || null;
      if(rawUnit && rawUnit.length>80) reject("ASTM_UNIT_TOO_LONG");
      observations.push({observationId:orderSequence+":"+resultSequence,barcode,analyzerTestCode:code,rawValue:value,rawUnit});
    } else reject("ASTM_RECORD_UNSUPPORTED");
  }
  if (!observations.length||observations.length>500) reject("ASTM_OBSERVATION_COUNT_INVALID");
  const digest=createHash("sha256").update(raw,"utf8").digest("hex");
  const bridgeMessageId="astm-"+digest.slice(0,64);
  return {protocol:"ASTM",bridgeMessageId,observations:observations.map(o=>({...o,observationId:bridgeMessageId+":"+o.observationId}))};
}

export function normalizeAnalyzerMessage(raw, protocol, profile) {
  if(protocol==="HL7_V2") return parseHl7Oru(raw,profile);
  if(protocol==="ASTM") return parseAstmRecords(raw,profile);
  reject("ANALYZER_PROTOCOL_REQUIRES_APPROVED_ADAPTER");
}
