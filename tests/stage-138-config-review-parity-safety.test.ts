import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
