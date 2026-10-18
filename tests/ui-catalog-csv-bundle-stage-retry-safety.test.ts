import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateReviewStageReceipt } from "../src/lib/catalog-review-stage-receipt.ts";

const read = (file:string) => readFileSync(file,"utf8");
const id = "8e3c7ea1-2aac-467c-b9b0-f5ce783c56ae";

test("CSV/XLSX staging receipt requires a private DRAFT review with coherent category totals",()=>{
  assert.deepEqual(validateReviewStageReceipt({
    id,status:"DRAFT",reviewOnly:true,
    summary:{total:4,VALID:1,WARNING:2,ERROR:1},
  },"CSV"),{id,total:4,valid:1,warning:2,error:1});
  assert.deepEqual(validateReviewStageReceipt({
    id,status:"DRAFT",reviewOnly:true,summary:{total:1,WARNING:1},
  },"CSV"),{id,total:1,valid:0,warning:1,error:0});
  assert.deepEqual(validateReviewStageReceipt({
    id,status:"DRAFT",reviewOnly:true,summary:{total:20000,VALID:20000},
  },"CSV"),{id,total:20000,valid:20000,warning:0,error:0});
});

test("signed JSON bundle receipt is always DRAFT, review-only, warning-only",()=>{
  assert.deepEqual(validateReviewStageReceipt({
    id,status:"DRAFT",reviewOnly:true,
    summary:{total:3,WARNING:3,counts:{TEST:3}},
  },"BUNDLE"),{id,total:3,valid:0,warning:3,error:0});
  assert.equal(validateReviewStageReceipt({
    id,status:"DRAFT",reviewOnly:true,summary:{total:2,VALID:1,WARNING:1},
  },"BUNDLE"),null);
  assert.equal(validateReviewStageReceipt({
    id,status:"DRAFT",reviewOnly:true,summary:{total:5001,WARNING:5001},
  },"BUNDLE"),null);
});

test("malformed, ambiguous, unsafe approval or inconsistent return never passes as success",()=>{
  const invalid:unknown[] = [
    null,{},[],"ok",
    {id,status:"DRAFT",reviewOnly:true,summary:null},
    {id:"invalid",status:"DRAFT",reviewOnly:true,summary:{total:1,VALID:1}},
    {id,status:"VALIDATED",reviewOnly:true,summary:{total:1,VALID:1}},
    {id,status:"IMPORTED",reviewOnly:true,summary:{total:1,VALID:1}},
    {id,status:"DRAFT",reviewOnly:false,summary:{total:1,VALID:1}},
    {id,status:"DRAFT",summary:{total:1,VALID:1}},
    {id,status:"DRAFT",reviewOnly:true,summary:{total:0}},
    {id,status:"DRAFT",reviewOnly:true,summary:{total:2,VALID:1}},
    {id,status:"DRAFT",reviewOnly:true,summary:{total:1,VALID:2}},
    {id,status:"DRAFT",reviewOnly:true,summary:{total:1,VALID:-1,WARNING:2}},
    {id,status:"DRAFT",reviewOnly:true,summary:{total:1,VALID:1.1}},
    {id,status:"DRAFT",reviewOnly:true,summary:{total:1,VALID:"1"}},
    {id,status:"DRAFT",reviewOnly:true,summary:{total:1,VALID:1,WARNING:null}},
    {id,status:"DRAFT",reviewOnly:true,summary:{total:Number.NaN,VALID:1}},
    {id,status:"DRAFT",reviewOnly:true,summary:{total:20001,VALID:20001}},
  ];
  for(const body of invalid)assert.equal(validateReviewStageReceipt(body,"CSV"),null,
    "Unexpected success for "+JSON.stringify(body)?.slice(0,140));
});

test("both clinical/financial spreadsheet and signed-bundle stage clients fence any attempted POST",()=>{
  for(const [path,kind,route] of [
    ["src/components/catalog-csv-review-staging.tsx","CSV","/api/catalog/imports/csv"],
    ["src/components/catalog-bundle-review-staging.tsx","BUNDLE","/api/catalog/imports/bundle"],
  ] as const){
    const ui=read(path);
    for(const evidence of [
      'const stageAttempted = useRef(false)',
      'const inFlight = useRef(false)',
      'const [retryBlocked, setRetryBlocked] = useState(false)',
      'stageAttempted.current || retryBlocked',
      'stageAttempted.current = true',
      'setRetryBlocked(true)',
      'credentials: "same-origin"',
      'body: file, cache: "no-store"',
      'retryBlocked={retryBlocked}',
      'router.push("/catalog/imports/" + encodeURIComponent(receipt.id))',
      'router.refresh()',
      'inFlight.current = false',
      'setBusy(false)',
      'role="alert"',
    ]) assert.ok(ui.includes(evidence),path+" missing "+evidence);
    assert.ok(ui.includes('validateReviewStageReceipt(body, "'+kind+'")'));
    assert.ok(ui.includes(route));
    assert.ok(ui.indexOf('stageAttempted.current = true')<ui.indexOf('fetch("'+route));
    assert.ok(!ui.includes('setRetryBlocked(false)'));
    assert.ok(ui.includes('return true'));
    assert.ok(ui.includes('return false'));
    assert.doesNotMatch(ui,/onClick=\{\(\) => void stage\(/);
    assert.doesNotMatch(ui,/\bwindow\.confirm\(/);
  }
  const modal=read("src/components/review-file-upload-dialog.tsx");
  assert.ok(modal.includes('disabled={busy || retryBlocked || !file}'));
  assert.ok(modal.includes('if (!file || busy || retryBlocked || submitting.current) return'));
});

test("original server review-only staging contracts remain permissioned, audited and private",()=>{
  const csv=read("src/app/api/catalog/imports/csv/route.ts");
  const bundle=read("src/app/api/catalog/imports/bundle/route.ts");
  for(const api of [csv,bundle]){
    for(const invariant of [
      'requirePermission("catalog.manage")',
      'catalogImportBatch.create',
      'catalogImportRow.createMany',
      'tx.auditEvent.create',
      'createdByUserId: session.user.id',
      'status: "DRAFT"',
      'reviewOnly: true',
    ])assert.ok(api.includes(invariant),invariant);
    for(const liveWrite of [
      "tx.referenceInterval.create(", "tx.priceListItem.create(",
      "tx.diagnosticReportVersion.update(",
    ])assert.ok(!api.includes(liveWrite),liveWrite);
  }
  assert.ok(csv.includes('liveCatalogReviewStagingAuthority'));
  assert.ok(csv.includes('CATALOG_CSV_REVIEW_STAGED'));
  assert.ok(bundle.includes('verifyCatalogBundleAttestation'));
  assert.ok(bundle.includes('CATALOG_CONFIG_BUNDLE_REVIEW_STAGED'));
  const doc=read("docs/UI_CSV_BUNDLE_STAGING_OUTCOME_SAFETY.md");
  for(const tag of ["Issue #265 OPEN","Issue #250 NO_GO","NOT_EXECUTED","Hostinger"])
    assert.ok(doc.includes(tag),tag);
});
