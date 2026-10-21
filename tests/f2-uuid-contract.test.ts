import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";

test("F2: every master, signing, mapping and effective-version UUID parser accepts exactly five groups",()=>{
  const files=readdirSync("src/lib").filter(name=>
    name.startsWith("catalog-f2-")&&name.endsWith(".ts"));
  const valid="f0c96d9e-d0f9-4fb2-899a-1c4919ff1b20";
  const missing="f0c96d9e-d0f9-4fb2-1c4919ff1b20";
  const extra="f0c96d9e-d0f9-4fb2-899a-9999-1c4919ff1b20";
  let checked=0;
  for(const file of files){
    const content=readFileSync("src/lib/"+file,"utf8");
    const declaration=content.match(/const UUID=\/([^\n]+)\/i;/);
    if(!declaration)continue;
    const pattern=new RegExp(declaration[1],"i");
    assert.equal(pattern.test(valid),true,file+": normal 36-character UUID");
    assert.equal(pattern.test(missing),false,file+": missing 4-digit segment");
    assert.equal(pattern.test(extra),false,file+": unapproved sixth segment");
    assert.equal(pattern.test("invalid"),false,file+": invalid string");
    checked++;
  }
  assert.ok(checked>=9,"new F2 modules must preserve the standard UUID contract");
});
