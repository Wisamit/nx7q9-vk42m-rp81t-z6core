import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("UI #265: catalog and clinical catalog use shared compact modal, no dismiss on in-flight writes", () => {
  const cases = [
    ["src/components/catalog-manager.tsx",
      ["/api/catalog/tests", "/api/catalog/master-data"], 2],
    ["src/components/clinical-catalog-manager.tsx",
      ["/api/catalog/components", "/api/catalog/panels",
        "/api/catalog/tat-policies", "/api/catalog/reference-intervals"], 4],
  ] as const;
  for (const [file, urls, count] of cases) {
    const source = read(file);
    assert.ok(source.includes('import { CrudModal } from "@/components/crud-modal"'));
    assert.ok(source.includes("size=\"compact\""));
    assert.ok(source.includes('onClose={() => { if (!saving) setMode(null); }}'));
    assert.ok(source.includes('if (saving) return;'));
    assert.ok(source.includes('role="alert"'));
    assert.ok(source.includes("finally {"));
    assert.ok(source.includes("catch {"));
    assert.ok(source.includes("router.refresh()"));
    assert.ok(!source.includes("modal-backdrop"));
    assert.equal((source.match(/<form\b/g) || []).length, count);
    for (const url of urls) assert.ok(source.includes(url));
  }
});

test("UI #265: clinical effective dates require explicit input, no UTC day silently applied", () => {
  const source = read("src/components/clinical-catalog-manager.tsx");
  const dateFields = [...source.matchAll(/<input name="effectiveFrom" type="date" required\s*\/>/g)];
  assert.equal(dateFields.length, 2, "TAT and reference range effective date both require clinician entry");
  assert.ok(!source.includes('new Date().toISOString().slice(0, 10)'));
  assert.ok(source.includes("New reference intervals are saved as inactive drafts"));
  assert.ok(source.includes("New policies are saved as inactive drafts"));
  assert.ok(source.includes("pregnancyStatus"));
  assert.ok(source.includes('name="criticalLow"') && source.includes('name="criticalHigh"'));
  assert.ok(source.includes('name="analyzerId"') && source.includes('name="methodId"'));
  const rangeApi = read("src/app/api/catalog/reference-intervals/route.ts");
  const tatApi = read("src/app/api/catalog/tat-policies/route.ts");
  assert.ok(rangeApi.includes('INACTIVE'));
  assert.ok(tatApi.includes('INACTIVE'));
});

test("UI #265: patient identifier create and reason-required deactivation retain scoped API/audit", () => {
  const source = read("src/components/patient-identifier-manager.tsx");
  const api = read("src/app/api/patients/[id]/identifiers/route.ts");
  assert.equal((source.match(/<CrudModal\b/g) || []).length, 2);
  assert.ok(source.includes('open={createOpen}'));
  assert.ok(source.includes('open={deactivation !== null}'));
  assert.ok(source.includes('onSubmit={deactivate}'));
  assert.ok(source.includes('onSubmit={add}'));
  assert.ok(source.includes('JSON.stringify({ identifierId: deactivation.id, reason })'));
  assert.ok(source.includes('if (!deactivation || busy) return;'));
  assert.ok(source.includes('disabled={Boolean(busy) || !deactivationReason.trim()}'));
  assert.ok(source.includes('role="alert"'));
  assert.ok(source.includes('if (!busy) setDeactivation(null)'));
  assert.doesNotMatch(source, /(?:window\.)?(?:confirm|prompt)\s*\(/);
  assert.ok(api.includes('auditEvent'));
  assert.ok(api.includes('organizationId'));
});

test("UI #265: package form retains exact membership and source fields on failed requests", () => {
  const source = read("src/components/commercial-package-manager.tsx");
  assert.equal((source.match(/<CrudModal\b/g) || []).length, 1);
  assert.ok(source.includes('size="compact"'));
  assert.ok(source.includes('if (!busy) setOpen(false)'));
  assert.ok(source.includes('testIds: selectedIds'));
  assert.ok(source.includes('if (selectedIds.length === 0)'));
  assert.ok(source.includes('setSelectedIds([])'));
  assert.ok(source.includes('setOpen(false)'));
  assert.ok(source.includes('if (!response.ok)'));
  assert.ok(source.includes("catch {"));
  assert.ok(!source.includes("event.currentTarget.reset()"));
  assert.ok(!source.includes('modal-backdrop'));
  assert.ok(source.includes("Specimen") || source.includes("specimen"));
  const api = read("src/app/api/catalog/packages/route.ts");
  assert.ok(api.includes("organizationId"));
});
