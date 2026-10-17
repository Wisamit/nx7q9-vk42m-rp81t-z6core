import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = (name: string) => readFileSync("src/app/api/catalog/imports/[id]/" + name + "/route.ts", "utf8");

test("safe-master batch claim changes VALIDATED to IMPORTED inside the data transaction", () => {
  const source = route("commit");
  assert.match(source, /safeRows\.length === 0/);
  assert.match(source, /where: \{ id: batch\.id, organizationId: session\.user\.organizationId, status: "VALIDATED" \}/);
  assert.match(source, /status: "IMPORTED", importedAt: new Date\(\)/);
  assert.match(source, /claim\.count !== 1/);
  assert.match(source, /batch_already_committed/);
  assert.ok(source.indexOf("const claim = await tx.catalogImportBatch.updateMany") < source.indexOf("const units = new Map"));
  assert.ok(source.includes('["UNIT", "CONTAINER", "TEST", "PANEL"]'));
});
test("revalidation cannot erase released import provenance, even during concurrent commits", () => {
  const source = route("revalidate");
  assert.match(source, /batch\.status === "IMPORTED"/);
  assert.match(source, /row\.status === "IMPORTED"/);
  assert.match(source, /row\.status === "SKIPPED"/);
  assert.match(source, /row\.importedEntityId !== null/);
  assert.match(source, /status: \{ in: \["DRAFT", "VALIDATED"\] \}/);
  assert.match(source, /updatedAt: batch\.updatedAt/);
  assert.match(source, /status: \{ notIn: \["IMPORTED", "SKIPPED"\] \}, importedEntityId: null/);
  assert.match(source, /claimed\.count !== 1/);
  assert.match(source, /processed_import_batch_immutable/);
  assert.ok(source.indexOf("const claim = await tx.catalogImportBatch.updateMany") <
    source.indexOf("const claimed = await tx.catalogImportRow.updateMany"));
  assert.match(source,/updatedAt: item\.row\.updatedAt/);
});
test("reference range claims staged row before touching clinical definition and remains inactive/draft", () => {
  const source = route("reference-ranges");
  const post = source.slice(source.indexOf("export async function POST"));
  assert.match(post, /batch\.sourceType === "CSV_REVIEW"/);
  assert.match(post, /tx\.catalogImportRow\.updateMany/);
  assert.match(post, /batchId: batch\.id/);
  assert.match(post, /status: \{ in: \["VALID", "WARNING"\] \}, importedEntityId: null/);
  assert.match(post, /if \(claim\.count !== 1\) continue/);
  assert.ok(post.indexOf("const claim = await tx.catalogImportRow.updateMany") <
    post.indexOf("tx.testComponent.create"));
  assert.ok(post.indexOf("const claim = await tx.catalogImportRow.updateMany") <
    post.indexOf("tx.referenceInterval.create"));
  assert.match(post, /status: "INACTIVE"/);
  assert.match(post, /approvalStatus: "DRAFT"/);
  assert.match(post, /importedEntityId: interval\.id/);
});

test("CSV_REVIEW source cannot reach older clinical mutation routes or page actions", () => {
  for (const name of ["reference-ranges", "mappings", "prepare-units"]) {
    const source = route(name);
    assert.match(source,/batch\.sourceType === "CSV_REVIEW"/);
    assert.match(source,/csv_review_is_not_clinical_import/);
  }
  const page = readFileSync("src/app/catalog/imports/[id]/page.tsx","utf8");
  assert.match(page,/batch\.sourceType !== "CSV_REVIEW" && !isBundleReview && <section className="detail-card range-import-card"/);
});
