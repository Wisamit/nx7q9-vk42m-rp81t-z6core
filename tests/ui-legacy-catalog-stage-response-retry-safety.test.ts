import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateLegacyStageReceipt } from "../src/lib/legacy-stage-receipt.ts";

const read = (name: string) => readFileSync(name,"utf8");
const id = "8a89cb7d-f0eb-4ccf-977a-d22617b8ca66";

test("source stage receipt identifies an exact validated or draft batch",()=>{
  assert.deepEqual(validateLegacyStageReceipt({id,status:"VALIDATED",
    summary:{total:5,VALID:2,WARNING:3}},5),
    {id,status:"VALIDATED",total:5,valid:2,warning:3,error:0});
  assert.deepEqual(validateLegacyStageReceipt({id,status:"DRAFT",
    summary:{total:5,VALID:2,WARNING:1,ERROR:2}},5),
    {id,status:"DRAFT",total:5,valid:2,warning:1,error:2});
});

test("unknown, inconsistent, stale or invalid stage receipts fail closed",()=>{
  for(const body of [
    null,[],{},"ok",
    {id,status:"VALIDATED"},
    {id,status:"VALIDATED",summary:[]},
    {id:"no",status:"VALIDATED",summary:{total:1,VALID:1}},
    {id,status:"IMPORTED",summary:{total:1,VALID:1}},
    {id,status:"DRAFT",summary:{total:1,VALID:1}},
    {id,status:"VALIDATED",summary:{total:1,ERROR:1}},
    {id,status:"VALIDATED",summary:{total:2,VALID:1}},
    {id,status:"VALIDATED",summary:{total:1,VALID:-1,WARNING:2}},
    {id,status:"VALIDATED",summary:{total:1,VALID:0.5,WARNING:0.5}},
    {id,status:"VALIDATED",summary:{total:1,VALID:Number.NaN}},
    {id,status:"VALIDATED",summary:{total:1,VALID:"1"}},
    {id,status:"VALIDATED",summary:{total:1,VALID:1,WARNING:1}},
    {id,status:"VALIDATED",summary:{total:1,VALID:1,ERROR:null}},
  ]) assert.equal(validateLegacyStageReceipt(body,1),null);
  assert.equal(validateLegacyStageReceipt({id,status:"VALIDATED",
    summary:{total:1,VALID:1}},0),null);
  assert.equal(validateLegacyStageReceipt({id,status:"VALIDATED",
    summary:{total:1,VALID:1}},20001),null);
});

test("legacy staging prevents duplicate POST after ambiguous response and honors organization date",()=>{
  const ui=read("src/components/legacy-import-batches.tsx");
  const dlg=read("src/components/review-file-upload-dialog.tsx");
  for(const evidence of [
    'const stageAttempted=useRef(false)',
    'const processing=useRef(false)',
    'stageAttempted.current || retryBlocked',
    'JSON.parse(await file.text())',
    'payload.rows.length===0 || payload.rows.length>20000',
    'stageAttempted.current=true',
    'setRetryBlocked(true)',
    'credentials:"same-origin"',
    'validateLegacyStageReceipt(body,expectedRows)',
    'setStageId(receipt.id)',
    'router.refresh()',
    'stageAttempted.current ? tr(',
    'processing.current=false',
    'setBusy(false)',
    'retryBlocked={retryBlocked}',
    'stageId&&<p><Link',
    'role={stageId?"status":"alert"}',
    '<SystemDateText value={b.createdAt} kind="instant-date" />',
  ]) assert.ok(ui.includes(evidence),evidence);
  assert.ok(ui.indexOf('stageAttempted.current=true')>ui.indexOf('JSON.stringify(payload)'));
  assert.ok(ui.indexOf('stageAttempted.current=true')<ui.indexOf('fetch("/api/catalog/imports"'));
  assert.ok(!ui.includes('setRetryBlocked(false)'));
  assert.doesNotMatch(ui,/b\.createdAt\.slice\(0,10\)/);
  for(const evidence of [
    'retryBlocked?: boolean',
    'retryBlocked = false',
    'if (!file || busy || retryBlocked || submitting.current) return',
    'disabled={busy || retryBlocked || !file}',
    'disabled={busy || retryBlocked}',
    'Re-upload blocked: a batch may already exist.',
    'protectUnsavedChanges',
    'size="compact"',
  ]) assert.ok(dlg.includes(evidence),evidence);
});

test("original staging API remains audit- and branch-scoped and never writes a live test",()=>{
  const api=read("src/app/api/catalog/imports/route.ts");
  for(const invariant of [
    'requirePermission("catalog.manage")',
    'pricing_manage_required',
    'reference_ranges_manage_required',
    'liveCatalogReviewStagingAuthority',
    'catalog_import_organization_inactive',
    'sourceType:"LEGACY_MDB_EXPORT"',
    'sourceChecksum:checksum',
    'catalogImportBatch.create',
    'catalogImportRow.createMany',
    'CATALOG_IMPORT_STAGED',
    'return NextResponse.json({id:result.batch.id,status:result.batch.status',
    '{status:result.replayed?200:201}',
    'catalog_staging_key_reused',
  ]) assert.ok(api.includes(invariant),invariant);
  for(const absent of [
    'tx.labTest.create(', 'tx.priceListItem.create(',
    'tx.referenceInterval.create(', 'tx.diagnosticReportVersion.update(',
  ]) assert.ok(!api.includes(absent),absent);
  const doc=read("docs/UI_LEGACY_CATALOG_STAGING_RETRY_SAFETY.md");
  for(const word of ["Issue #265 OPEN","Issue #250 NO_GO","NOT_EXECUTED","Hostinger"])
    assert.ok(doc.includes(word),word);
});
