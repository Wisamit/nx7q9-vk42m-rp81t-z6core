import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { verifyOriginalAnalyzerObservationBinding } from "../src/lib/analyzer-raw-observation-binding.ts";
import { analyzerRawClinicalQualifierDecision } from "../src/lib/analyzer-raw-clinical-qualifier-gate.ts";
// @ts-expect-error Bridge is intentionally portable .mjs without TypeScript declarations.
import { parseHl7Oru, parseAstmRecords } from "../bridge/protocols.mjs";

const digest=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const head="MSH|^~\\&|A|LAB|LIS|LAB|202610221200||ORU^R01|LAB-ONE|P|2.5\r";
const order="OBR|1||BAR-001|GLU^Example\r";
const glucose="OBX|1|NM|GLU^Glucose||5.2|mmol/L\r";
const sodium="OBX|2|NM|NA^Sodium||140|mmol/L\r";
const hl7=head+order+glucose+sodium;
const packHL7=(raw=hl7)=>({
  protocol:"HL7_V2",rawPayload:raw,storedPayloadHash:digest(raw),
  bridgeMessageId:"LAB-ONE",
  observations:parseHl7Oru(raw,{barcodeSource:"OBR_3"}).observations,
});
const astm="H|\\^&|||SYNTH\rP|1\rO|1|BAR-001\r"+
  "R|1|^^^GLU|5.2|mmol/L\rR|2|^^^NA|140|mmol/L\rL|1\r";
const packASTM=(raw=astm)=>({
  protocol:"ASTM",rawPayload:raw,storedPayloadHash:digest(raw),
  bridgeMessageId:"astm-"+digest(raw),
  observations:parseAstmRecords(raw,{
    approved:true,sampleIdField:2,testCodeField:2,valueField:3,unitField:4,
  }).observations,
});
const ok=(item:ReturnType<typeof packHL7>|ReturnType<typeof packASTM>)=>
  assert.deepEqual(verifyOriginalAnalyzerObservationBinding(item),{ok:true});
const denied=(item:Parameters<typeof verifyOriginalAnalyzerObservationBinding>[0],reason:string)=>{
  const actual=verifyOriginalAnalyzerObservationBinding(item);
  assert.deepEqual(actual,{ok:false,reason},reason);
};

test("F8 §75: exact HL7 and ASTM full message projections match stored SHA and entire observation set",()=>{
  const a=packHL7(),b=packASTM();
  assert.equal(analyzerRawClinicalQualifierDecision("HL7_V2",a.rawPayload).eligibleForStaging,true);
  assert.equal(analyzerRawClinicalQualifierDecision("ASTM",b.rawPayload).eligibleForStaging,true);
  ok(a);ok(b);
  // Two observations can be submitted in any order; identity is NOT position.
  ok({...a,observations:[...a.observations].reverse()});
  ok({...b,observations:[...b.observations].reverse()});
});

test("F8 §75: normalized values, units, barcodes, test codes and observation IDs cannot differ from instrument",()=>{
  for(const original of [packHL7(),packASTM()]){
    const ref=original.observations;
    const alter=(key:keyof typeof ref[number],value:string|null)=>{
      denied({...original,observations:ref.map((row:typeof ref[number],index:number)=>
        index===0?{...row,[key]:value}:row)},
      "ANALYZER_NORMALIZED_PAYLOAD_DIFFERS_FROM_ORIGINAL");
    };
    alter("rawValue","9999");
    alter("rawValue","5.20");
    alter("rawValue"," 5.2");
    alter("rawUnit","g/dL");
    alter("rawUnit",null);
    alter("barcode","BAR-002");
    alter("analyzerTestCode","OTHER");
    alter("observationId","OTHER:1:1");
  }
});

test("F8 §75: no partial, repeated or fabricated normalized observation set may be staged",()=>{
  for(const original of [packHL7(),packASTM()]){
    denied({...original,observations:original.observations.slice(0,1)},
      "ANALYZER_ORIGINAL_OBSERVATION_COUNT_MISMATCH");
    denied({...original,observations:[]},
      "ANALYZER_ORIGINAL_OBSERVATION_COUNT_MISMATCH");
    denied({...original,observations:[...original.observations,original.observations[0]]},
      "ANALYZER_ORIGINAL_OBSERVATION_COUNT_MISMATCH");
    denied({...original,observations:[original.observations[0],original.observations[0]]},
      "ANALYZER_NORMALIZED_PAYLOAD_DIFFERS_FROM_ORIGINAL");
  }
});

test("F8 §75: a stored message modified after receipt cannot be authenticated by its old payload digest",()=>{
  for(const original of [packHL7(),packASTM()]){
    denied({...original,storedPayloadHash:"0".repeat(64)},
      "ANALYZER_ORIGINAL_PAYLOAD_HASH_MISMATCH");
    denied({...original,storedPayloadHash:"BAD"},
      "ANALYZER_ORIGINAL_PAYLOAD_HASH_MISMATCH");
    denied({...original,rawPayload:original.rawPayload+"tampered"},
      "ANALYZER_ORIGINAL_PAYLOAD_HASH_MISMATCH");
    denied({...original,rawPayload:""},
      "ANALYZER_ORIGINAL_PAYLOAD_HASH_MISMATCH");
  }
});

test("F8 §75: HL7 control ID must be raw MSH identifier, not a newly supplied name",()=>{
  const original=packHL7();
  denied({...original,bridgeMessageId:"CHANGED-ONE"},
    "ANALYZER_ORIGINAL_MESSAGE_ID_MISMATCH");
  const raw=original.rawPayload.replace("LAB-ONE","LAB-TWO");
  denied({...original,rawPayload:raw,storedPayloadHash:digest(raw)},
    "ANALYZER_ORIGINAL_MESSAGE_ID_MISMATCH");
});

test("F8 §75: ASTM message ID must bind to SHA-256 of full original unmodified frame",()=>{
  const original=packASTM();
  denied({...original,bridgeMessageId:"astm-"+("0".repeat(64))},
    "ANALYZER_ORIGINAL_MESSAGE_ID_MISMATCH");
  const changed=original.rawPayload.replace("SYNTH","SYNTH-V2");
  denied({...original,rawPayload:changed,storedPayloadHash:digest(changed)},
    "ANALYZER_ORIGINAL_MESSAGE_ID_MISMATCH");
});

test("F8 §75: missing / ambiguous HL7 specimen source cannot be guessed",()=>{
  const raw=head+"OBR|1||ORDER-001\rSPM|1|BAR-001\r"+glucose;
  // The existing bridge supports an explicitly chosen SPM-2 source, but the
  // LIS does not own a trusted profile for choosing between differing fields.
  const candidate=parseHl7Oru(raw,{barcodeSource:"SPM_2"}).observations;
  denied({
    protocol:"HL7_V2",rawPayload:raw,storedPayloadHash:digest(raw),
    bridgeMessageId:"LAB-ONE",observations:candidate,
  },"ANALYZER_ORIGINAL_SPECIMEN_BINDING_UNVERIFIABLE");
  const onlySPM=head+"OBR|1||\rSPM|1|BAR-001\r"+glucose;
  ok({
    protocol:"HL7_V2",rawPayload:onlySPM,storedPayloadHash:digest(onlySPM),
    bridgeMessageId:"LAB-ONE",
    observations:parseHl7Oru(onlySPM,{barcodeSource:"SPM_2"}).observations,
  });
});

test("F8 §75: metadata flag gate stays independent and runs before raw/normalized binding",()=>{
  const raw=hl7.replace("5.2|mmol/L","5.2|mmol/L||H");
  assert.equal(analyzerRawClinicalQualifierDecision("HL7_V2",raw).eligibleForStaging,false);
  const route=readFileSync("src/app/api/integrations/analyzers/[id]/results/route.ts","utf8");
  const rawPos=route.indexOf("analyzerRawClinicalQualifierDecision(");
  const bindingPos=route.indexOf("verifyOriginalAnalyzerObservationBinding({",rawPos);
  const mappingPos=route.indexOf("prisma.analyzerTestMapping.findMany(",bindingPos);
  const stagedPos=route.indexOf("tx.analyzerResultImport.create(",mappingPos);
  assert.ok(rawPos>0&&bindingPos>rawPos&&mappingPos>bindingPos&&stagedPos>mappingPos);
  assert.ok(route.includes("storedPayloadHash: message.payloadHash"));
  assert.ok(route.includes("SELECT id,raw_payload,payload_hash,protocol,bridge_message_id"));
  assert.ok(route.includes("FOR UPDATE"));
  assert.ok(route.includes("lockedMessage.raw_payload !== message.rawPayload"));
  assert.ok(route.includes("BRIDGE_MESSAGE_SOURCE_CHANGED"));
  assert.ok(route.indexOf("const lockedMessage = messageLock[0]") <
    route.indexOf("tx.analyzerResultImport.findMany(",bindingPos));
  assert.ok(route.includes("observations: normalized"));
  assert.ok(route.includes('error: "analyzer_normalized_payload_requires_review"'));
  assert.ok(!route.slice(rawPos,bindingPos).includes("analyzerResultImport.create"));
});
