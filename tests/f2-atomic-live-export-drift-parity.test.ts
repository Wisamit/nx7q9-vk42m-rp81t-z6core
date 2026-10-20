import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { catalogBundleAllowedSourceFields, catalogBundleNestedSourceProjections, type BundleNestedProjection } from "../src/lib/catalog-bundle-source-boundary.ts";
import type { CatalogExportType } from "../src/lib/catalog-configuration-export.ts";

const sourceBundle=readFileSync("src/app/api/catalog/configuration-export/bundle/route.ts","utf8");
const sourceDrift=readFileSync("src/lib/catalog-live-observation.ts","utf8");
const driftRoute=readFileSync("src/app/api/catalog/imports/[id]/bundle-drift/route.ts","utf8");
const models: Record<CatalogExportType,string> = {
  TEST:"labTest",COMPONENT:"testComponent",UNIT:"unit",CONTAINER:"container",
  PANEL:"testPanel",PACKAGE:"commercialPackage",REFERENCE_INTERVAL:"referenceInterval",
  PRICE_LIST:"priceList",PRICE_LIST_ITEM:"priceListItem",PRICE_LIST_PACKAGE_ITEM:"priceListPackageItem",
};
function propertyName(name: ts.PropertyName) {
  if (ts.isIdentifier(name)||ts.isStringLiteral(name)||ts.isNumericLiteral(name))return name.text;
  throw new Error("F2: unexpected computed Prisma projection property");
}
function selectValue(node: ts.ObjectLiteralExpression,field:string):ts.Expression {
  const choices=node.properties.filter(ts.isPropertyAssignment).filter(p=>propertyName(p.name)===field);
  if(choices.length!==1)throw new Error("F2: missing or duplicate projection "+field);
  return choices[0].initializer;
}
function flattenSelect(node:ts.ObjectLiteralExpression,prefix=""):string[] {
  const fields:string[]=[];
  for(const prop of node.properties){
    if(!ts.isPropertyAssignment(prop))throw new Error("F2: dynamic field projection is not auditable");
    const name=propertyName(prop.name),p=prefix?prefix+"."+name:name;
    if(prop.initializer.kind===ts.SyntaxKind.TrueKeyword)fields.push(p);
    else if(ts.isObjectLiteralExpression(prop.initializer)) {
      const nested=selectValue(prop.initializer,"select");
      if(!ts.isObjectLiteralExpression(nested))throw new Error("F2: nested selection is not explicit");
      fields.push(...flattenSelect(nested,p));
    }else throw new Error("F2: non-static selected field "+p);
  }
  if(new Set(fields).size!==fields.length)throw new Error("F2: duplicate projected field");
  return fields.sort();
}
function projections(code:string){
  const src=ts.createSourceFile("src.ts",code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const paths=new Map<string,string[]>();
  const visit=(node:ts.Node)=>{
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&
      node.expression.name.text==="findMany"&&
      ts.isPropertyAccessExpression(node.expression.expression)&&
      ts.isIdentifier(node.expression.expression.expression)&&
      node.expression.expression.expression.text==="tx"){
      const model=node.expression.expression.name.text;
      if(!Object.values(models).includes(model)){ts.forEachChild(node,visit);return;}
      const input=node.arguments[0];
      if(!input||!ts.isObjectLiteralExpression(input))throw Error("F2: query input is dynamic "+model);
      const select=selectValue(input,"select");
      if(!ts.isObjectLiteralExpression(select))throw Error("F2: SELECT is dynamic "+model);
      if(paths.has(model))throw Error("F2: ambiguous repeat query "+model);
      paths.set(model,flattenSelect(select));
    }
    ts.forEachChild(node,visit);
  };
  visit(src);
  return paths;
}
test("F2: all ten atomic export model projections equal live drift projections at EVERY nested field",()=>{
  assert.match(driftRoute,/readCatalogLiveObservations\(tx,liveScope,branchIds,idsByType\)/);
  const exported=projections(sourceBundle),drift=projections(sourceDrift);
  assert.equal(exported.size,10);
  assert.equal(drift.size,10);
  for(const [kind,model] of Object.entries(models) as [CatalogExportType,string][]){
    assert.deepEqual(exported.get(model),drift.get(model),
      kind+" export and drift must inspect identical values and related test/price identities");
  }
});
test("F2: source-field allowlist exactly equals actual Prisma atomic exported top-level fields",()=>{
  const exported=projections(sourceBundle);
  for(const [kind,model] of Object.entries(models) as [CatalogExportType,string][]){
    const paths=exported.get(model);
    assert.ok(paths,"missing export model "+kind);
    const direct=paths!.map(x=>x.split(".")[0]).filter((x,i,a)=>a.indexOf(x)===i).sort();
    const allow=[...catalogBundleAllowedSourceFields[kind]].sort();
    assert.deepEqual(direct,allow,
      kind+" requires all fields exported, allowlisted and eligible for live drift");
  }
});
function nestedPaths(schema: BundleNestedProjection, prefix=""): string[] {
  return Object.entries(schema).flatMap(([name, value])=>{
    const path=prefix?prefix+"."+name:name;
    if(value===true)return [path];
    if(Array.isArray(value))return nestedPaths(value[0],path);
    return nestedPaths(value as BundleNestedProjection,path);
  }).sort();
}
test("F2: every nested source projection agrees with actual Prisma fields, including membership and tariff relationships",()=>{
  const exported=projections(sourceBundle);
  for(const [kind,model] of Object.entries(models) as [CatalogExportType,string][]){
    const actual=exported.get(model)!.filter(path=>path.includes(".")).sort();
    assert.deepEqual(actual,nestedPaths(catalogBundleNestedSourceProjections[kind]),
      kind+" nested HMAC completeness must match Prisma export projection exactly");
  }
});
test("F2: export and drift both include nested linked identities and all critical financial fields",()=>{
  const exported=projections(sourceBundle);
  for(const kind of ["PRICE_LIST_ITEM","PRICE_LIST_PACKAGE_ITEM"] as const){
    const paths=exported.get(models[kind])!;
    for(const field of ["unitPrice","effectiveFrom","effectiveTo","status","priceList.currency",
      "priceList.scopeType","priceList.branchId","priceList.sourceId","priceList.clientId",
      "priceList.contractId","priceList.referrerId"]){
      assert.ok(paths.includes(field),kind+" missing "+field);
    }
  }
  const interval=exported.get(models.REFERENCE_INTERVAL)!;
  for(const field of ["lowValue","highValue","criticalLow","criticalHigh",
      "approvalStatus","effectiveFrom","effectiveTo","component.test.code"]){
    assert.ok(interval.includes(field),"reference interval missing "+field);
  }
});
