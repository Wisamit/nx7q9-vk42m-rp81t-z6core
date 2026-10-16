import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ui = readFileSync("src/components/quality-management-console.tsx", "utf8");
const safetyCode = (file: string) => readFileSync(file, "utf8");

test("UI #265: all eleven QMS decisions are explicit review dialogs without native prompts", () => {
  assert.ok(ui.includes('import { CrudModal } from "@/components/crud-modal";'));
  assert.ok(ui.includes("confirmQualityReview"));
  assert.ok(ui.includes('open={pendingReview!==null}'));
  assert.ok(ui.includes('if(!busy)setPendingReview(null)'));
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes('role="alert"'));
  assert.doesNotMatch(ui, /(?:window\.)?(?:prompt|confirm)\s*\(/);
  for (const name of [
    "NC_STATUS", "CAPA_ACTION_CREATE", "CAPA_ACTION_COMPLETE", "CAPA_EFFECTIVENESS",
    "DOCUMENT_VERSION_CREATE", "DOCUMENT_WORKFLOW", "ANALYZER_REVOKE",
    "INDICATOR_MEASUREMENT", "AUDIT_FINDING_CREATE", "AUDIT_FINDING_CLOSE",
    "AUDIT_COMPLETE",
  ]) {
    assert.ok(ui.includes('kind: "' + name + '"') ||
      ui.includes('action === "' + name + '"'), "QMS review kind is unreachable: " + name);
    assert.ok(ui.includes('pendingReview.kind==="' + name + '"') ||
      (name === "AUDIT_FINDING_CLOSE" && ui.includes('pendingReview.kind==="AUDIT_FINDING_CLOSE"')),
      "No bilingual fields for review kind " + name);
  }
});

test("UI #265: CAPA and critical findings keep independent safety and data snapshots", () => {
  const required = [
    'effectiveness === "EFFECTIVE" && fields.get("close") === "on"',
    'payload = {effectiveness, effectivenessReview, close}',
    'payload = {actionId: review.subId, status: "COMPLETED"}',
    'const capaId = field("capaId")',
    'severity === "CRITICAL" && !capaId',
    'openCapas.some(item => item.id === capaId)',
    'required={reviewSeverity==="CRITICAL"}',
    'rootCause = review.close ? field("rootCause")',
    'const closureSummary = review.close ? field("closureSummary")',
    'payload = {severity, description: field("description"), requirementRef: field("requirementRef"), capaId}',
  ];
  for (const part of required) assert.ok(ui.includes(part), "Missing clinical QMS safety rule: " + part);
  assert.ok(safetyCode("src/app/api/quality/capas/[id]/review/route.ts")
    .includes("permission"), "CAPA review still has server permission enforcement");
  assert.ok(ui.includes("router.refresh()"));
  assert.ok(ui.includes('Connection interrupted.'));
  assert.ok(ui.includes("finally {"));
});

test("UI #265: document activation and analyzer revocation still use original server authorization", () => {
  for (const fragment of [
    '/api/quality/document-versions/',
    '"SUBMIT_REVIEW", "COMPLETE_REVIEW", "APPROVE", "MAKE_EFFECTIVE"',
    'payload = {action: review.operation}',
    '/api/quality/analyzer-authorizations',
    'status: "REVOKED", revocationReason: reason',
    'const content = field("content")',
    'const externalUrl = field("externalUrl")',
    '!changeSummary || (!content && !externalUrl) || (content && externalUrl)',
    'contentSnapshot: content ? {text: content} : null',
  ]) assert.ok(ui.includes(fragment), "Lost governed document/device rule: " + fragment);
  assert.ok(safetyCode("src/app/api/quality/document-versions/[versionId]/workflow/route.ts")
    .includes("auditEvent"));
});
