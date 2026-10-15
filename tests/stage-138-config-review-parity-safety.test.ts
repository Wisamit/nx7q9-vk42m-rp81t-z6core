import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parseCsvReviewFile } from "../src/lib/catalog-review-csv-import.ts";
import { catalogReviewXlsx } from "../src/lib/catalog-review-xlsx.ts";
import { xlsxReviewToCsv } from "../src/lib/catalog-review-xlsx-import.ts";
import { normalizeImportRow, validateImportRow, rowValidationStatus, allowedImportEntities } from "../src/lib/catalog-import.ts";
import { catalogExportTypes } from "../src/lib/catalog-configuration-export.ts";
import { parseCatalogBundleForReview, CatalogBundleReviewError } from "../src/lib/catalog-bundle-review.ts";

test("Stage 138: container source exports are organization-scoped, include tube metadata, and are review-only",()=>{
  assert.equal(catalogExportTypes.has("CONTAINER"),true);
  for(const path of ["src/app/api/catalog/configuration-export/route.ts","src/app/api/catalog/configuration-export/bundle/route.ts"]){
    const s=readFileSync(path,"utf8");
    assert.match(s,/type === "CONTAINER"/);
    assert.match(s,/container.findMany/);
    assert.match(s,/where: \{ organizationId, \.\.\.cursorScope \}/);
    assert.match(s,/tubeColor: true, additive: true, status: true/);
    assert.doesNotMatch(s,/export async function POST/);
  }
  const id=randomUUID(),org=randomUUID();
  const envelope={format:"family-lab-catalog-bundle",schemaVersion:1,
    organizationId:org,exportedAt:"2026-10-15T08:00:00.000Z",
    consistency:"transactional-consistent-read",groups:[{entityType:"CONTAINER",records:[{
      id,code:"EDTA",nameEn:"EDTA tube",nameAr:"أنبوب",tubeColor:"Purple",additive:"EDTA",status:"ACTIVE"
    }]}]};
  const batch=parseCatalogBundleForReview(envelope,org,{pricing:false,ranges:false});
  assert.deepEqual(batch.ids.containers,[id]);
  assert.equal(batch.rows[0].normalized.nameAr,"أنبوب");
  assert.equal(batch.rows[0].normalized.additive,"EDTA");
  assert.throws(()=>parseCatalogBundleForReview(envelope,randomUUID(),{pricing:false,ranges:false}),
    (e:unknown)=>e instanceof CatalogBundleReviewError&&e.code==="bundle_foreign_organization");
  const verify=readFileSync("src/app/api/catalog/imports/bundle/route.ts","utf8");
  assert.match(verify,/tx.container.findMany/);
  assert.match(verify,/containers.length !== parsed.ids.containers.length/);
  assert.match(verify,/existing.additive === n.additive/);
  assert.match(verify,/organizationId: scope.organizationId/);
});

// Financial master rows are never writable through safe-master import.
test("Stage 138: price-list CSV/XLSX financial metadata requires review and exact dates",()=>{
  const header="entityType,code,nameEn,nameAr,scopeType,branchId,currency,priority,effectiveFrom,effectiveTo";
  const branch=randomUUID();
  const line="PRICE_LIST,LAB_AED,Private lab,مختبر,BRANCH,"+branch+",AED,12,2026-10-15,2027-10-14";
  const csv=header+"\r\n"+line+"\r\n";

  for(const raw of [csv,xlsxReviewToCsv(catalogReviewXlsx(csv))]){
    const row=parseCsvReviewFile(raw)[0];
    const normalized=normalizeImportRow(row);
    assert.equal(normalized.branchId,branch);
    assert.equal(normalized.currency,"AED");
    assert.equal(rowValidationStatus(validateImportRow(row.entityType,normalized)),"WARNING");
  }
  for(const invalid of [
    "PRICE_LIST,L,Test,عربي,CLIENT,,AED,12,2026-10-15,2027-10-14",
    "PRICE_LIST,L,Test,عربي,BRANCH,,AED,12,2026-10-15,2027-10-14",
    "PRICE_LIST,L,Test,عربي,ORGANIZATION,,AED,12,2026-02-30,",
    "PRICE_LIST,L,Test,عربي,ORGANIZATION,,AED,12,2027-10-14,2026-10-15",
  ]) {
    const row=parseCsvReviewFile(header+"\n"+invalid+"\n")[0];
    assert.equal(rowValidationStatus(validateImportRow(row.entityType,normalizeImportRow(row))),"ERROR");
  }
  assert.equal(allowedImportEntities.has("PRICE_LIST" as never),false);
  const stage=readFileSync("src/app/api/catalog/imports/csv/route.ts","utf8");
  const review=readFileSync("src/app/catalog/imports/[id]/page.tsx","utf8");
  assert.match(stage,/row.entityType.startsWith\("PRICE_"\)/);
  assert.match(stage,/price_list_branch_scope_forbidden/);
  assert.match(stage,/status: "DRAFT", validatedAt: null/);
  assert.match(review,/stagedPriceLists/);
  assert.match(review,/pricing.manage/);
  for(const path of ["src/app/api/catalog/imports/[id]/commit/route.ts","src/app/api/catalog/imports/[id]/revalidate/route.ts"])
    assert.match(readFileSync(path,"utf8"),/batch.sourceType === "CSV_REVIEW"/);
});
