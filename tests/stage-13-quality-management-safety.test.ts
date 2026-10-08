import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("CAPA review checks current action completion under a parent row lock", () => {
  const review = source("../src/app/api/quality/capas/[id]/review/route.ts");
  const tx = review.indexOf("prisma.$transaction(async tx =>");
  const lock = review.indexOf("SELECT id FROM capas", tx);
  const actions = review.indexOf("tx.capaAction.count", lock);
  const claim = review.indexOf("tx.capa.updateMany", actions);
  assert.ok(tx >= 0 && lock > tx && actions > lock && claim > actions);
  assert.ok(review.includes('isolationLevel: "Serializable"'));
  assert.ok(review.includes("NO_COMPLETED_CAPA_ACTIONS"));
  assert.ok(review.includes("completed_capa_action_required"));
});

test("CAPA actions lock the same parent and reject stale writes after closure", () => {
  const actions = source("../src/app/api/quality/capas/[id]/actions/route.ts");
  assert.equal((actions.match(/SELECT id FROM capas/g) || []).length, 2);
  assert.ok(actions.includes('"CAPA_LOCKED"'));
  assert.ok(actions.includes("tx.capaAction.updateMany"));
  assert.ok(actions.includes("updatedAt: action.updatedAt"));
});

test("nonconformance closure serializes with linked CAPA creation and verifies branch", () => {
  const record = source("../src/app/api/quality/nonconformances/[id]/route.ts");
  const create = source("../src/app/api/quality/capas/route.ts");
  assert.ok(record.indexOf("SELECT id FROM nonconformances") < record.indexOf("tx.capa.count"));
  assert.ok(record.includes("tx.nonconformance.updateMany"));
  assert.ok(create.indexOf("SELECT id FROM nonconformances") < create.indexOf("tx.capa.create"));
  assert.ok(create.includes("capa_nonconformance_branch_mismatch"));
  assert.ok(create.includes("nonconformance_branch_forbidden"));
});

test("internal audit and findings serialize OPEN/CLOSED state", () => {
  const finish = source("../src/app/api/quality/audits/[id]/complete/route.ts");
  const findings = source("../src/app/api/quality/audits/[id]/findings/route.ts");
  assert.ok(finish.indexOf("SELECT id FROM internal_audits") < finish.indexOf("tx.internalAuditFinding.count"));
  assert.ok(finish.includes("tx.internalAudit.updateMany"));
  assert.equal((findings.match(/SELECT id FROM internal_audits/g) || []).length, 2);
  assert.ok(findings.includes('"LINKED_CAPA_NOT_CLOSED"'));
  assert.ok(findings.includes("tx.internalAuditFinding.updateMany"));
});

test("effective SOP versions are serialized through the document parent", () => {
  const workflow = source("../src/app/api/quality/document-versions/[id]/workflow/route.ts");
  const lock = workflow.indexOf("SELECT id FROM quality_documents");
  const claim = workflow.indexOf("tx.qualityDocumentVersion.updateMany", lock);
  const retire = workflow.indexOf("const currentlyEffective", claim);
  assert.ok(lock >= 0 && claim > lock && retire > claim);
  assert.ok(workflow.includes("OLDER_VERSION_CANNOT_REPLACE_EFFECTIVE"));
  assert.ok(workflow.includes("currentDocument.currentEffectiveVersion"));
});

test("QMS console provides bilingual operator feedback for conflicts and clinical closure holds", () => {
  const consoleSource = source("../src/components/quality-management-console.tsx");
  for (const reason of ["completed_capa_action_required", "open_capa_blocks_nonconformance_closure",
    "linked_capa_must_be_closed", "older_version_cannot_replace_effective",
    "document_workflow_state_conflict"]) {
    assert.ok(consoleSource.includes(reason));
  }
  assert.ok(consoleSource.includes("أغلق CAPA المرتبط"));
  assert.ok(consoleSource.includes("تغيّرت حالة"));
});
