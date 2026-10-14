import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compositeUuid, intersectCompositeDepartments } from "../src/lib/catalog-composite-scope.ts";

test("Stage 126 canonical UUID: old malformed 8-4-4-4-4-4 and truncated 8-4-4-12 rejected", () => {
  const valid = "12345678-1234-1234-1234-123456789abc";
  assert.equal(compositeUuid.test(valid), true);
  assert.equal(compositeUuid.test("12345678-1234-1234-123456789abc"), false);
  assert.equal(compositeUuid.test("12345678-1234-1234-1234-1234-1234"), false);
  const route = readFileSync("src/app/api/catalog/imports/[id]/package-price-drafts/route.ts", "utf8");
  const literal = route.match(/^const UUID = \/(.*?)\/i;$/m)?.[1];
  assert.ok(literal, "package-tariff admission must have canonical UUID guard");
  const packageId = new RegExp(literal!, "i");
  assert.equal(packageId.test(valid), true);
  assert.equal(packageId.test("12345678-1234-1234-1234-1234-1234"), false);
});

test("Stage 126 clinical permissions: no-grants global only when both session and live scope unrestricted", () => {
  const A = { departmentId: "dept-a" }, B = { departmentId: "dept-b" };
  assert.deepEqual(intersectCompositeDepartments([], []), []);
  assert.equal(intersectCompositeDepartments([], [A]), null,
    "newly added department access cannot change scope without session renewal");
  assert.equal(intersectCompositeDepartments(["dept-a"], []), null,
    "revocation cannot grant unrestricted department access");
  assert.equal(intersectCompositeDepartments(["dept-a"], [B]), null,
    "replacement department grant must not be interpreted as organization-wide access");
  assert.deepEqual(intersectCompositeDepartments(["dept-a", "dept-b"], [B]), [B]);
  assert.deepEqual(intersectCompositeDepartments(["dept-a"], [A, B]), [A],
    "newly granted departments must never be added during the current transaction");
  const helper = readFileSync("src/lib/catalog-composite-write.ts", "utf8");
  assert.match(helper, /if \(departmentScopes === null\)/);
  assert.match(helper, /composite_department_scope_revoked/);
  assert.match(helper, /clinicalImportTestWhere\(scope\)/);
});
