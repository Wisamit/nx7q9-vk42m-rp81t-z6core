import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {analyzerRawClinicalQualifierDecision}
  from "../src/lib/analyzer-raw-clinical-qualifier-gate.ts";
import {parseHl7Oru,parseAstmRecords} from "../bridge/protocols.mjs";

const hl7="MSH|^~\\&|A|LAB|LIS|LAB|202610221200||ORU^R01|SYN-RAW|P|2.5\r"
  +"OBR|1||SYN-BARCODE|GLU^Test\rOBX|1|NM|GLU^Glucose||5.2|mmol/L\r";
const astm="H|\\^&|||ANALYZER\rP|1\rO|1|SYN-BARCODE\r"
  +"R|1|^^^GLU|5.2|mmol/L\rL|1\r";
const judge=(protocol:unknown,payload:unknown)=>
  analyzerRawClinicalQualifierDecision(protocol,payload);
const reason=(protocol:unknown,payload:unknown):string|null=>{
  const result=judge(protocol,payload);
  assert.equal(result.eligibleForStaging,false);
  return result.reason;
};

test("F4: clean conservative bridge parser output passes independent raw scanner",()=>{
  assert.equal(parseHl7Oru(hl7,{barcodeSource:"OBR_3"}).observations.length,1);
  assert.deepEqual(judge("HL7_V2",hl7),{
    eligibleForStaging:true,reason:null,
  });
  assert.equal(parseAstmRecords(astm,{
    approved:true,sampleIdField:2,testCodeField:2,
    valueField:3,unitField:4,
  }).observations.length,1);
  assert.deepEqual(judge("ASTM",astm),{
    eligibleForStaging:true,reason:null,
  });
});

test("F4: HL7 abnormal/interference flags, ranges, result comments and preliminary status are never dropped",()=>{
  for(const payload of [
    hl7.replace("5.2|mmol/L","5.2|mmol/L||H"),
    hl7.replace("5.2|mmol/L","5.2|mmol/L||HIL"),
    hl7.replace("5.2|mmol/L","5.2|mmol/L|4.0-6.0"),
    hl7.replace("5.2|mmol/L","5.2|mmol/L|||||P"),
    hl7.replace("5.2|mmol/L","5.2|mmol/L|||||C"),
    hl7.replace("5.2|mmol/L","5.2|mmol/L||||F|operator-comment"),
  ]){
    assert.equal(reason("HL7_V2",payload),"ANALYZER_RAW_UNREVIEWED_CLINICAL_QUALIFIER");
  }
  assert.equal(reason("HL7_V2",hl7+"NTE|1||hemolysis suspected\r"),
    "ANALYZER_RAW_UNREVIEWED_CLINICAL_COMMENT");
  assert.equal(reason("HL7_V2",hl7+"ZIS|1|warning\r"),
    "ANALYZER_RAW_UNKNOWN_CLINICAL_RECORD");
});

test("F4: ASTM abnormal qualifiers, notes and malformed raw result values never become a routine result",()=>{
  assert.equal(reason("ASTM",astm.replace("5.2|mmol/L","5.2|mmol/L|H")),
    "ANALYZER_RAW_UNREVIEWED_CLINICAL_QUALIFIER");
  assert.equal(reason("ASTM",astm.replace("5.2|mmol/L","5.2|mmol/L||H")),
    "ANALYZER_RAW_UNREVIEWED_CLINICAL_QUALIFIER");
  assert.equal(reason("ASTM",astm.replace("5.2|mmol/L","5.2^8.2|mmol/L")),
    "ANALYZER_RAW_UNSUPPORTED_RESULT_ENCODING");
  assert.equal(reason("ASTM",astm.replace("R|1","C|1")),
    "ANALYZER_RAW_UNKNOWN_CLINICAL_RECORD");
});

test("F4: unsupported protocol and uninterpretable raw input never bypass the policy",()=>{
  for(const [p,s] of [
    ["UNSUPPORTED","raw"],["HL7_V2","garbage"],
    ["ASTM","H|x\rR|1|^GLU|3.2|mmol/L\r"],
    ["HL7_V2",""],["HL7_V2",{}],
  ] as const)assert.ok(reason(p,s));
});

test("F4: authenticated LIS staging rechecks stored raw message before any mapped results are created",()=>{
  const route=readFileSync(
    "src/app/api/integrations/analyzers/[id]/results/route.ts","utf8");
  const source=route.indexOf("prisma.analyzerMessage.findUnique");
  const guard=route.indexOf("analyzerRawClinicalQualifierDecision(");
  const mappings=route.indexOf("prisma.analyzerTestMapping.findMany");
  const created=route.indexOf("tx.analyzerResultImport.create");
  assert.ok(source>=0&&guard>source&&mappings>guard&&created>mappings);
  assert.match(route,/message\.protocol, message\.rawPayload/);
  assert.match(route,/analyzer_raw_clinical_qualifier_requires_review/);
});
