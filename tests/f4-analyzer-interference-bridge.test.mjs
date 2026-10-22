import test from "node:test";
import assert from "node:assert/strict";
import {parseHl7Oru,parseAstmRecords} from "../bridge/protocols.mjs";

const head="MSH|^~\\&|SYNTH|LAB|LIS|LAB|202610221300||ORU^R01|F4-ONE|P|2.5\r";
const body="OBR|1||SYNTHETIC-BAR|ASSAY^Fixture\r";
const obs="OBX|1|NM|ASSAY^Fixture||5.2|mmol/L";
const input=rows=>head+body+rows.join("\r")+"\r";
const profile={barcodeSource:"OBR_3"};

test("F4 HL7: normal synthetic observations without raw instrument qualifiers retain existing stable behavior",()=>{
  const parsed=parseHl7Oru(input([obs]),profile);
  assert.equal(parsed.observations.length,1);
  assert.deepEqual(parsed.observations[0],{
    observationId:"F4-ONE:1:1",barcode:"SYNTHETIC-BAR",
    analyzerTestCode:"ASSAY",rawValue:"5.2",rawUnit:"mmol/L",
  });
  const final=parseHl7Oru(input([obs+"|||||F"]),profile);
  assert.deepEqual(final.observations,parsed.observations);
});

test("F4 HL7: unqualified abnormal/interference/normal qualifiers never disappear in normalization",()=>{
  for(const code of ["H","L","N","I","H~L"]) {
    assert.throws(()=>parseHl7Oru(input([obs+"||"+code]),profile),
      /HL7_OBSERVATION_FLAG_REQUIRES_APPROVED_POLICY/);
  }
});

test("F4 HL7: preliminary/corrected/cancelled observations cannot be treated as final released values",()=>{
  for(const status of ["P","C","D","X"]) {
    assert.throws(()=>parseHl7Oru(input([obs+"|||||"+status]),profile),
      /HL7_OBSERVATION_STATUS_REQUIRES_APPROVED_POLICY/);
  }
});

test("F4 HL7: clinical analyzer NTE caveats cannot be silently dropped",()=>{
  assert.throws(()=>parseHl7Oru(input([obs,"NTE|1||Potential interference"]),profile),
    /HL7_OBSERVATION_COMMENT_REQUIRES_APPROVED_PROFILE/);
  assert.equal(parseHl7Oru(input([obs,"NTE|1||"]),profile).observations.length,1);
});

const astm="H|\\^&|||SYNTH\rO|1|SYNTHETIC-BAR\r";
const R="R|1|^^^ASSAY|5.2|mmol/L";
const footer="\rL|1\r";
const astmProfile={approved:true,sampleIdField:2,testCodeField:2,
  valueField:3,unitField:4};
test("F4 ASTM: safe subset accepts ordinary result but requires policy for unparsed clinical qualifiers",()=>{
  const basic=parseAstmRecords(astm+R+footer,astmProfile);
  assert.equal(basic.observations.length,1);
  for(const extra of ["|4.0-6.0","||H","|||P","||||Possible interference"]) {
    assert.throws(()=>parseAstmRecords(astm+R+extra+footer,astmProfile),
      /ASTM_RESULT_QUALIFIER_REQUIRES_APPROVED_PROFILE/);
  }
});
