import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  parseClinicalRuleDecimal,ClinicalDecimalError,
} from "../src/lib/clinical-rule-decimal.ts";

const reflex={precision:24,scale:8} as const;
const absolute={precision:24,scale:8,nonNegative:true} as const;
const percent={precision:18,scale:6,nonNegative:true} as const;

test("Stage 121: preserve decimal values exactly within schema constraints",()=>{
  for(const [input,format,expected] of [
    ["0.00000001",reflex,"0.00000001"],
    ["-0.00000001",reflex,"-0.00000001"],
    ["1234567890123456.12345678",reflex,"1234567890123456.12345678"],
    ["-1234567890123456.12345678",reflex,"-1234567890123456.12345678"],
    ["0",reflex,"0.00000000"],
    ["-0.0",reflex,"0.00000000"],
    ["1.23",absolute,"1.23000000"],
    ["999999999999.123456",percent,"999999999999.123456"],
    ["0.000001",percent,"0.000001"],
  ] as const){
    assert.equal(parseClinicalRuleDecimal(input,format),expected);
  }
  assert.equal(parseClinicalRuleDecimal(null,reflex),null);
  assert.equal(parseClinicalRuleDecimal("",reflex),null);
  assert.equal(parseClinicalRuleDecimal(undefined,reflex),null);
});
test("Stage 121: no rounding, overflow, non-finite, scientific or numeric-JSON coercion",()=>{
  const unsafe:unknown[]=[
    0.1,1e-8,Number.MAX_SAFE_INTEGER,Infinity,NaN,
    "0.000000001","-0.000000001","1.000000000",
    "12345678901234567","99999999999999999.00000000",
    "1e-8","-3E+10","NaN","Infinity","-Infinity",
    "1,234.5"," 1 .1 ","+1","01","1.","1..0","--1",
    "0x10",true,{},[],"", // missing is handled separately
  ];
  for(const value of unsafe.filter(x=>x!=="")){
    assert.throws(()=>parseClinicalRuleDecimal(value,reflex),
      (error:unknown)=>error instanceof ClinicalDecimalError,
      "Must reject "+String(value));
  }
  for(const value of ["-1","-0","-0.000001","0.0000001","1000000000000"]){
    assert.throws(()=>parseClinicalRuleDecimal(value,percent),
      (error:unknown)=>error instanceof ClinicalDecimalError, String(value));
  }
  assert.throws(()=>parseClinicalRuleDecimal("0.000000001",absolute));
  assert.throws(()=>parseClinicalRuleDecimal("1".repeat(101),reflex));
});
test("Stage 121: Reflex and Delta routes never pass rule limits through JS Number",()=>{
  const reflexSource=readFileSync("src/app/api/clinical-rules/reflex/route.ts","utf8");
  const deltaSource=readFileSync("src/app/api/clinical-rules/delta/route.ts","utf8");
  const schema=readFileSync("prisma/schema.prisma","utf8");
  for(const source of [reflexSource,deltaSource]){
    assert.match(source,/parseClinicalRuleDecimal/);
    assert.match(source,/ClinicalDecimalError/);
    assert.match(source,/error:error\.code/);
    assert.doesNotMatch(source,/Number\(body\.(?:numericThreshold|absoluteLimit|percentLimit)\)/);
    assert.doesNotMatch(source,/(?:numericThreshold|absoluteLimit|percentLimit)\.toFixed\(/);
    assert.match(source,/status: "INACTIVE"/);
    assert.match(source,/tx\.auditEvent\.create/);
  }
  assert.match(reflexSource,/precision:24,scale:8/);
  assert.match(deltaSource,/precision:24,scale:8,nonNegative:true/);
  assert.match(deltaSource,/precision:18,scale:6,nonNegative:true/);
  assert.match(schema,/numericThreshold\s+Decimal\?\s+@map\("numeric_threshold"\) @db.Decimal\(24, 8\)/);
  assert.match(schema,/absoluteLimit\s+Decimal\?\s+@map\("absolute_limit"\) @db.Decimal\(24, 8\)/);
  assert.match(schema,/percentLimit\s+Decimal\?\s+@map\("percent_limit"\) @db.Decimal\(18, 6\)/);
  assert.match(reflexSource,/numericThreshold: numericOperator \? numericThreshold : null/);
  assert.match(deltaSource,/absoluteLimit,\s*percentLimit,/);
});
