import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string) {return readFileSync(path,"utf8");}

test("UI #265: payment method create/status review use compact dialogs and reasoned auditable API", () => {
  const component=source("src/components/payment-method-manager.tsx");
  const api=source("src/app/api/billing/payment-methods/[id]/route.ts");
  assert.equal((component.match(/<CrudModal\b/g)||[]).length,2);
  assert.equal((component.match(/size="compact"/g)||[]).length,2);
  assert.ok(component.includes('open={statusTarget !== null}'));
  assert.ok(component.includes('onSubmit={changeStatus}'));
  assert.ok(component.includes('reason,'));
  assert.ok(component.includes('status: statusTarget.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"'));
  assert.ok(component.includes('if (!statusTarget || busy || !statusTarget.isSettlement) return;'));
  assert.ok(component.includes('setFormError('));
  assert.ok(component.includes('finally {'));
  assert.ok(component.includes('role="alert"'));
  assert.ok(component.includes('if (!busy) setStatusTarget(null)'));
  assert.doesNotMatch(component, /(?:window\.)?(?:prompt|confirm)\s*\(/);
  assert.ok(api.includes("auditEvent"));
  assert.ok(api.includes("organizationId"));
  assert.ok(api.includes("reason"));
});

test("UI #265: immutable report templates use compact creation, independent approval and activation review", () => {
  const component=source("src/components/report-template-manager.tsx");
  assert.equal((component.match(/<CrudModal\b/g)||[]).length,3);
  assert.equal((component.match(/size="compact"/g)||[]).length,3);
  assert.ok(component.includes('open={decision!==null}'));
  assert.ok(component.includes('onSubmit={confirmVersionDecision}'));
  assert.ok(component.includes('reason: decisionReason.trim(), confirmation: "APPROVE_EXACT_REPORT_LAYOUT_VERSION"'));
  assert.ok(component.includes('row.latestSubmittedByUserId === currentUserId'));
  assert.ok(component.includes('decisionReason.trim().length < 12'));
  assert.ok(component.includes('onClose={()=>{if(!busy)setDecision(null);}}'));
  assert.ok(component.includes('if(!response.ok)'));
  assert.ok(component.includes('setFormError('));
  assert.ok(component.includes('router.refresh()'));
  assert.ok(component.includes('role="alert"'));
  assert.doesNotMatch(component, /(?:window\.)?(?:prompt|confirm)\s*\(/);
  for(const endpoint of [
    "src/app/api/report-templates/[id]/versions/[versionId]/approve/route.ts",
    "src/app/api/report-templates/[id]/versions/[versionId]/activate/route.ts",
  ]) {
    const body=source(endpoint);
    assert.ok(body.includes("organizationId"));
    assert.ok(body.includes("auditEvent"));
  }
});
