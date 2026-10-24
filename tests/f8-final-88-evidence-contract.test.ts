import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

type Case = {
  section:number;title:string;softwareSource:string;syntheticRegression:string;
  executionStatus:string;stage131Classification:string;
};
const uat=JSON.parse(readFileSync("docs/STAGE_132_UAT_CASES.json","utf8")) as {
  cases:Case[];gateRoles:Record<string,string>;stageStatus:string;
};
const selected=readFileSync("docs/STAGE_131_FINAL_SOFTWARE_AUDIT_88.md","utf8")
  .split("\n").filter(line=>/^\|\s*\d+\s*\|/.test(line));
const strip=(value:string)=>value.trim().replace(/^\`|\`$/g,"");

test("F8 final: every original 1-88 scope section maps to a real source file and preserves NOT_EXECUTED field UAT",()=>{
  assert.equal(selected.length,88,"88 original scope rows must remain present");
  assert.equal(uat.cases.length,88);
  assert.equal(uat.stageStatus,"NOT_EXECUTED");
  const ids=new Set<number>(),unanchored:number[]=[];
  for(const [index,line] of selected.entries()){
    const cols=line.split("|").map(x=>x.trim());
    const section=Number(cols[1]),source=strip(cols[3]),regression=strip(cols[4]);
    const field=uat.cases[index];
    assert.equal(section,index+1);
    assert.equal(field.section,section);
    assert.ok(!ids.has(section));
    ids.add(section);
    assert.equal(field.title,cols[2]);
    assert.equal(field.softwareSource,source);
    assert.equal(field.syntheticRegression,regression);
    assert.equal(field.executionStatus,"NOT_EXECUTED",
      "a synthetic regression does not prove field acceptance");
    assert.ok(existsSync(source),"Missing real source anchor: "+source);
    if(regression.startsWith("tests/")){
      assert.ok(existsSync(regression),"Missing selected regression: "+regression);
    }else{
      assert.equal(regression,"No direct section-specific suite selected");
      unanchored.push(section);
    }
    assert.notEqual(field.stage131Classification,"FIELD_UAT_PASS");
  }
  assert.deepEqual(unanchored,[9,18,29,72,81],
    "five scope sections have no direct selected regression; do not silently credit them");
  assert.equal(Object.keys(uat.gateRoles).length,7);
});

test("F8 final: existing true MariaDB cross-branch and F2 governance regressions remain in the CI gate",()=>{
  const yaml=readFileSync(".github/workflows/ci.yml","utf8");
  for(const file of [
    "tests/stage-130-cross-module-mariadb.integration.test.ts",
    "tests/f2-effective-versions-mariadb.integration.test.ts",
    "tests/f8-reference-interval-stale-context-mariadb.integration.test.ts",
    "tests/specimen-transfer-mariadb.integration.test.ts",
  ]){
    assert.ok(existsSync(file),"Missing real MariaDB integration suite: "+file);
    assert.ok(yaml.includes(file),"Real MariaDB regression missing from CI: "+file);
  }
  const cross=readFileSync("tests/stage-130-cross-module-mariadb.integration.test.ts","utf8");
  for(const required of [
    "mysql.createConnection","specimen_transfer_manifests",
    "diagnostic_report_versions","paymentPostingFingerprint",
    "laboratory_results","competing.beginTransaction()",
  ])assert.ok(cross.includes(required));
  assert.ok(readFileSync("src/lib/catalog-f2-effective-versions.ts","utf8")
    .includes("lockF2ActivePriceContext"));
});
