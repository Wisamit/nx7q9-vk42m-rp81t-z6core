import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseBridgeObservationSubmission}
  from "../src/lib/analyzer-bridge-observation-boundary.ts";
// @ts-expect-error Bridge is deployed as pure .mjs without TypeScript declarations.
import {parseHl7Oru,parseAstmRecords} from "../bridge/protocols.mjs";

const example=()=>({
  bridgeMessageId:"synthetic-001",
  observations:[{
    observationId:"synthetic-001:1:1",barcode:"SYN-BARCODE",
    analyzerTestCode:"GLU",rawValue:"5.2",rawUnit:"mmol/L",
  }],
});
const parse=(v:unknown)=>parseBridgeObservationSubmission(v);
const rejected=(v:unknown,error:string)=>{
  const out=parse(v);
  assert.equal(out.ok,false);
  if(!out.ok) {
    assert.equal(out.error,error);
    assert.equal(out.status,error.includes("requires_review")?409:400);
  }
};

test("F4: only the bounded approved analyzer observation fields can reach LIS staging",()=>{
  const out=parse(example());
  assert.equal(out.ok,true);
  if(out.ok) assert.deepEqual(out.submission,example());

  for(const extension of [
    {rawFlag:"H"},{interference:"HIL"},{hemolysisIndex:20},
    {lipemia:"H"},{icterus:"warning"},{vendorWarning:false},
    {referenceQualifier:null},{suppressionStatus:"F"},
    {vendorPayload:{isSafe:true}},
  ])rejected({
    ...example(),observations:[{...example().observations[0],...extension}],
  },"analyzer_unapproved_observation_metadata_requires_review");
  rejected({...example(),interferenceAbsent:true},
    "analyzer_unapproved_message_metadata_requires_review");
});

test("F4: no truncation or coercion may alter a bridge result/barcode/source identifier",()=>{
  const e=example();
  for(const [field,value] of [
    ["rawValue","X".repeat(1001)],["barcode","A".repeat(81)],
    ["analyzerTestCode","T".repeat(121)],["observationId","I".repeat(151)],
    ["rawUnit","U".repeat(81)],["rawValue",5.2],
    ["rawUnit",5],["observationId",false],["barcode",null],
  ] as const)rejected({...e,observations:[{...e.observations[0],[field]:value}]},
    "observation_required_fields_missing");
  rejected({...e,bridgeMessageId:"M".repeat(151)},
    "bridge_message_id_required");
  rejected({...e,observations:[e.observations[0],{...e.observations[0]}]},
    "duplicate_observation_id_in_request");
});

test("F4: HL7 and approved ASTM normalizer output remains supported without interpreting vendor flags",()=>{
  const hl7="MSH|^~\\&|A|LAB|LIS|LAB|202610221200||ORU^R01|HIL-F4|P|2.5\r"
    +"OBR|1||SYN-BARCODE|GLU^Test\rOBX|1|NM|GLU^Glucose||5.2|mmol/L\r";
  const h=parseHl7Oru(hl7,{barcodeSource:"OBR_3"});
  assert.equal(parse({bridgeMessageId:h.bridgeMessageId,
    observations:h.observations}).ok,true);
  const astm="H|\\^&|||ANALYZER\rP|1\rO|1|SYN-BARCODE\rR|1|^^^GLU|5.2|mmol/L\rL|1\r";
  const a=parseAstmRecords(astm,{
    approved:true,sampleIdField:2,testCodeField:2,valueField:3,unitField:4,
  });
  assert.equal(parse({bridgeMessageId:a.bridgeMessageId,
    observations:a.observations}).ok,true);
  // The existing conservative protocol adapter deliberately refuses
  // uncategorized OBX-8 interference/abnormal qualifiers.
  assert.throws(()=>parseHl7Oru(hl7.replace("5.2|mmol/L","5.2|mmol/L||H"),
    {barcodeSource:"OBR_3"}),/FLAG_REQUIRES_APPROVED_POLICY/);
});

test("F4: authenticated staging endpoint enforces the boundary before any database lookup",()=>{
  const route=readFileSync(
    "src/app/api/integrations/analyzers/[id]/results/route.ts","utf8");
  const auth=route.indexOf("authenticateAnalyzerBridge(request, id)");
  const parsePos=route.indexOf("parseBridgeObservationSubmission(");
  const lookup=route.indexOf("prisma.analyzerMessage.findUnique");
  const mutation=route.indexOf("tx.analyzerResultImport.create");
  assert.ok(auth>=0&&parsePos>auth&&lookup>parsePos&&mutation>lookup);
  assert.match(route,/analyzer-bridge-observation-boundary/);
  assert.doesNotMatch(route,/text\(item\.rawValue,\s*1000\)/);
});
