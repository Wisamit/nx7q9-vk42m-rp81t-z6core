import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { genericCatalogPriceScope } from "../src/lib/catalog-generic-price-scope.ts";

test("Stage 145: public tariff scope explicitly excludes private business identities", () => {
  const branchIds = ["authorized-branch"];
  const scope = genericCatalogPriceScope(branchIds);
  assert.deepEqual(scope, {
    sourceId: null,
    referrerId: null,
    clientId: null,
    contractId: null,
    OR: [
      { scopeType: "ORGANIZATION", branchId: null },
      { scopeType: "BRANCH", branchId: { in: ["authorized-branch"] } },
    ],
  });
  branchIds.push("revoked-after-scope-construction");
  assert.deepEqual(scope.OR[1].branchId, { in: ["authorized-branch"] },
    "the captured scope must not expand when its input is later mutated");
  assert.deepEqual(genericCatalogPriceScope([]).OR[1].branchId, { in: [] },
    "an empty active grant list cannot expose branch prices");
});

test("Stage 145: BOTH export APIs use the same exclusion for masters and test/package items", () => {
  const paths = [
    "src/app/api/catalog/configuration-export/route.ts",
    "src/app/api/catalog/configuration-export/bundle/route.ts",
  ];
  for (const path of paths) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /import \{ genericCatalogPriceScope \} from "@\/lib\/catalog-generic-price-scope"/);
    assert.match(source, /const genericPriceScope = genericCatalogPriceScope\(branchIds\)/);
    assert.match(source, /priceList\.findMany\(/);
    assert.match(source, /priceListItem\.findMany\(/);
    assert.match(source, /priceListPackageItem\.findMany\(/);
    assert.match(source, /where: \{ organizationId, \.\.\.genericPriceScope, \.\.\.cursorScope \}/);
    assert.match(source, /priceList: \{ organizationId, \.\.\.genericPriceScope \}/);
    assert.match(source, /priceList: \{[\s\S]*?\.\.\.genericPriceScope,/,
      "package items must also use the shared generic tariff predicate");
    assert.match(source, /permissions\.has\("pricing\.manage"\)/);
    assert.match(source, /CATALOG_CONFIGURATION_(?:ATOMIC_BUNDLE_)?EXPORTED/);
  }
});
