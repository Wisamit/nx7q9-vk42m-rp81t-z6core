import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { catalogStageSubmissionKey, lookupCatalogStageReplay } from "../src/lib/catalog-stage-idempotency.ts";

const read=(p:string)=>readFileSync(p,"utf8");
const checksum="a".repeat(64),org=randomUUID(),actor=randomUUID(),key=randomUUID();

test("request idempotency key is UUID-only, case-stable, and backward compatible with older clients",()=>{
  assert.deepEqual(catalogStageSubmissionKey(null),{valid:true,key:null});
  assert.deepEqual(catalogStageSubmissionKey(key.toUpperCase()),{valid:true,key});
  for(const invalid of [""," ", "123",key+"-suffix",key+" ", "x".repeat(400)])
    assert.deepEqual(catalogStageSubmissionKey(invalid),{valid:false,key:null});
});

test("author/tenant/source lookups return prior identity only with matching immutable payload and unprocessed stage",async()=>{
  const source={sourceName:"hospital-lab.csv",sourceChecksum:checksum,status:"DRAFT",
    importedAt:null,id:randomUUID()};
  const fields={organizationId:org,authorId:actor,sourceType:"CSV_REVIEW",
    sourceName:source.sourceName,checksum,submissionKey:key,expectedStatus:"DRAFT" as const};
  let called:Record<string,unknown>|undefined;
  const tx={catalogImportBatch:{findFirst:async(args:Record<string,unknown>)=>{
    called=args;return source;
  }}} as unknown as Parameters<typeof lookupCatalogStageReplay>[0];
  assert.deepEqual(await lookupCatalogStageReplay(tx,fields),{kind:"replay",id:source.id});
  assert.deepEqual((called as {where:Record<string,unknown>}).where,{
    organizationId:org,createdByUserId:actor,sourceType:"CSV_REVIEW",submissionKey:key,
  });
  assert.deepEqual(await lookupCatalogStageReplay(tx,{...fields,checksum:"b".repeat(64)}),{kind:"conflict"});
  assert.deepEqual(await lookupCatalogStageReplay(tx,{...fields,sourceName:"different.csv"}),{kind:"conflict"});
  assert.deepEqual(await lookupCatalogStageReplay(tx,{...fields,expectedStatus:"VALIDATED"}),{kind:"conflict"});
  const mutated={catalogImportBatch:{findFirst:async()=>({...source,importedAt:new Date()})}} as unknown
    as Parameters<typeof lookupCatalogStageReplay>[0];
  assert.deepEqual(await lookupCatalogStageReplay(mutated,fields),{kind:"conflict"});
  const noPrior={catalogImportBatch:{findFirst:async()=>null}} as unknown
    as Parameters<typeof lookupCatalogStageReplay>[0];
  assert.deepEqual(await lookupCatalogStageReplay(noPrior,fields),{kind:"new"});
  assert.deepEqual(await lookupCatalogStageReplay(noPrior,{...fields,submissionKey:null}),{kind:"new"});
});

test("all three clients send a stable attempt key, not merely disable the UI",()=>{
  for(const path of [
    "src/components/legacy-import-batches.tsx",
    "src/components/catalog-csv-review-staging.tsx",
    "src/components/catalog-bundle-review-staging.tsx",
  ]){
    const s=read(path);
    assert.ok(s.includes("submissionKey.current ??= crypto.randomUUID()"),path);
    assert.ok(s.includes('"x-family-lab-staging-key"'),path);
    assert.ok(s.indexOf("submissionKey.current ??= crypto.randomUUID()")<
      s.indexOf("stageAttempted.current = true") ||
      s.indexOf("submissionKey.current ??= crypto.randomUUID()")<s.indexOf("stageAttempted.current=true"),path);
    assert.ok(!s.includes("submissionKey.current = null"),path);
    assert.ok(s.includes("setRetryBlocked(true)"),path);
  }
});

test("all three authenticated stage routes lock organization before actor-scope replay and never write live clinical/financial masters",()=>{
  const paths=[
    "src/app/api/catalog/imports/route.ts",
    "src/app/api/catalog/imports/csv/route.ts",
    "src/app/api/catalog/imports/bundle/route.ts",
  ];
  for(const path of paths){
    const s=read(path);
    assert.ok(s.includes('catalogStageSubmissionKey(request.headers.get("x-family-lab-staging-key"))'),path);
    assert.ok(s.includes('invalid_catalog_staging_key'),path);
    assert.ok(s.includes('lookupCatalogStageReplay(tx,'),path);
    assert.ok(s.includes('catalog_staging_key_reused'),path);
    assert.ok(s.includes('submissionKey:requestKey.key')||
      s.includes('submissionKey: requestKey.key'),path);
    assert.ok(s.includes('requirePermission("catalog.manage")'),path);
    assert.ok(s.includes('auditEvent.create'),path);
    assert.ok(s.indexOf('lookupCatalogStageReplay(tx,') > s.indexOf("FOR UPDATE"),path);
    for(const forbidden of ["tx.referenceInterval.create(", "tx.priceListItem.create(",
      "tx.diagnosticReportVersion.update("])
      assert.ok(!s.includes(forbidden),path+" disallowed live write "+forbidden);
  }
  const legacy=read(paths[0]),csv=read(paths[1]),bundle=read(paths[2]);
  for(const s of [legacy,csv])assert.ok(s.includes('liveCatalogReviewStagingAuthority'));
  assert.ok(bundle.includes('livePermissions'));
  assert.ok(bundle.includes('resolveClinicalImportScope'));
  assert.ok(bundle.includes('verifyCatalogBundleAttestation'));
  assert.ok(legacy.includes('sourceType:"LEGACY_MDB_EXPORT"'));
  assert.ok(csv.includes('sourceType: "CSV_REVIEW"'));
  assert.ok(bundle.includes('sourceType: BUNDLE_REVIEW_SOURCE'));
  const schema=read("prisma/schema.prisma");
  assert.ok(schema.includes('submissionKey  String?'));
  assert.ok(schema.includes('@@unique([organizationId, createdByUserId, sourceType, submissionKey], map: "catalog_staging_actor_request_uq")'));
  const migration=read("prisma/migrations/20261018191000_catalog_staging_submission_idempotency/migration.sql");
  assert.ok(migration.includes('ADD COLUMN \`submission_key\` CHAR(36) NULL'));
  assert.ok(migration.includes('CREATE UNIQUE INDEX \`catalog_staging_actor_request_uq\`'));
  const docs=read("docs/CATALOG_STAGING_IDEMPOTENT_REPLAY.md");
  assert.ok(docs.includes("Issue #265 OPEN"));
  assert.ok(docs.includes("Issue #250 NO_GO"));
  assert.ok(docs.includes("NOT_EXECUTED"));
});
