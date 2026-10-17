import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { liveSafeMasterCommitActorWhere } from "../src/lib/catalog-import-commit-actor.ts";
import {
  LEGACY_CATALOG_JSON_MAX_BYTES, LegacyCatalogJsonIntakeError,
  legacyCatalogSourceNameValid, readLegacyCatalogJson,
} from "../src/lib/legacy-catalog-json-intake.ts";

test("live catalog commit actor requires active user, tenant role and granted active branch", () => {
  const where = liveSafeMasterCommitActorWhere("user", "org", "branch");
  assert.deepEqual(where, {
    id: "user", organizationId: "org", status: "ACTIVE",
    roles: { some: { role: {
      organizationId: "org", status: "ACTIVE",
      permissions: { some: { permission: { code: "catalog.manage" } } },
    } } },
    branchScopes: { some: {
      branchId: "branch", branch: { organizationId: "org", status: "ACTIVE" },
    } },
  });
});

test("transaction-time reauthorization precedes the first batch claim / master write", () => {
  const route = readFileSync("src/app/api/catalog/imports/[id]/commit/route.ts","utf8");
  const lock = route.indexOf("const ownerLock = await tx.$queryRaw");
  const live = route.indexOf("const liveActor = session.activeBranchId");
  const depts = route.indexOf("const liveDepartments = await tx.userDepartmentScope.findMany");
  const claim = route.indexOf("const claim = await tx.catalogImportBatch.updateMany");
  const write = route.indexOf("const units = new Map");
  assert.ok(lock >= 0 && live > lock && depts > live && claim > depts && write > claim);
  assert.match(route, /status = 'ACTIVE' FOR UPDATE/);
  assert.match(route, /catalog_import_branch_scope_changed/);
  assert.match(route, /catalog_import_department_scope_changed/);
  assert.match(route, /originalDepartments\.has\(grant\.departmentId\)/);
  assert.match(route, /asObject\(latestBatch\.summary\)/);
  assert.match(route, /deferredKinds\.has\(row\.entityType\)/);
  for (const kind of ["REFERENCE_INTERVAL","COMPONENT","PRICE_LIST_ITEM",
    "PRICE_LIST_PACKAGE_ITEM","PACKAGE"]) assert.ok(route.includes('"' + kind + '"'));
  assert.match(route, /latestBatch\.sourceType === "CSV_REVIEW"/);
  assert.match(route, /latestBatch\.sourceType === "CONFIG_BUNDLE_REVIEW"/);
});

function upload(body: string, type = "application/json", claimed?: number) {
  return new Request("https://test.invalid/api/catalog/imports",{
    method:"POST", headers:{"Content-Type":type,
      ...(claimed === undefined ? {} : {"Content-Length":String(claimed)})},
    body,
  });
}

test("legacy configuration JSON intake remains strict, byte-limited and source-name safe", async () => {
  const sample = {sourceName:"cleaned-config.json",rows:[
    {entityType:"TEST",data:{Testname:"Synthetic Chemistry"}},
  ]};
  assert.deepEqual(await readLegacyCatalogJson(upload(JSON.stringify(sample))),sample);
  assert.equal(legacyCatalogSourceNameValid("cleaned-config.json"),true);
  for(const bad of ["", "a".repeat(256), "bad\nname","bad\u0000name"])
    assert.equal(legacyCatalogSourceNameValid(bad),false);
  await assert.rejects(readLegacyCatalogJson(upload("{}", "text/plain")),
    {code:"legacy_catalog_json_required",status:415});
  await assert.rejects(readLegacyCatalogJson(upload("{","application/json")),
    {code:"legacy_catalog_invalid_json_or_utf8",status:400});
  await assert.rejects(readLegacyCatalogJson(upload("{}","application/json",
    LEGACY_CATALOG_JSON_MAX_BYTES+1)),
    {code:"legacy_catalog_payload_too_large",status:413});
  assert.equal(LEGACY_CATALOG_JSON_MAX_BYTES,32*1024*1024);
});

test("actual incoming chunks are bounded independently from declared Content-Length", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller){
      controller.enqueue(new TextEncoder().encode('{"sourceName":"legacy","rows":[]}'));
      controller.enqueue(new Uint8Array(LEGACY_CATALOG_JSON_MAX_BYTES));
    },
    cancel(){ cancelled = true; },
  });
  const request = new Request("https://test.invalid/api/catalog/imports",{
    method:"POST",headers:{"Content-Type":"application/json","Content-Length":"1"},
    body,duplex:"half",
  } as RequestInit & {duplex:"half"});
  await assert.rejects(readLegacyCatalogJson(request),(error:unknown)=>
    error instanceof LegacyCatalogJsonIntakeError &&
    error.code==="legacy_catalog_payload_too_large" && error.status===413);
  assert.equal(cancelled,true);
  const route=readFileSync("src/app/api/catalog/imports/route.ts","utf8");
  assert.match(route,/await readLegacyCatalogJson\(request\)/);
  assert.doesNotMatch(route,/await request\.json\(/);
  assert.match(route,/legacyCatalogSourceNameValid/);
});
