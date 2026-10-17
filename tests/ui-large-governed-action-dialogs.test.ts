import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const read = (path: string) => readFileSync(path, "utf8");
const files = {
  patient: read("src/components/patient-edit-form.tsx"),
  handover: read("src/components/staff-report-handover.tsx"),
  repeat: read("src/components/result-repeat-panel.tsx"),
  roles: read("src/components/role-management.tsx"),
  modal: read("src/components/crud-modal.tsx"),
  css: read("src/app/globals.css"),
  audit: read("scripts/ui-full-surface-audit.mjs"),
};

test("Large UI release gate: four sensitive action editors are compact, guarded and explicit", () => {
  for (const name of ["patient", "handover", "repeat", "roles"] as const) {
    const source = files[name];
    assert.ok(source.includes('from "@/components/crud-modal"'), name);
    assert.ok(source.includes('size="compact"'), name);
    assert.ok(source.includes("<CrudModal"), name);
    assert.ok(source.includes("onClose="), name);
  }
  assert.doesNotMatch(files.roles, /size="(?:xl|lg|full)"/);
  assert.ok(files.patient.includes("open={editOpen}"));
  assert.ok(files.handover.includes("open={open}"));
  assert.ok(files.repeat.includes("open={open}"));
  assert.ok(files.modal.includes('className={"crud-modal crud-modal-" + size}'));
});

test("Patient edit preserves optimistic-concurrency and independent duplicate review audit", () => {
  const s = files.patient;
  assert.ok(s.includes('expectedUpdatedAt: patient.updatedAt'));
  assert.ok(s.includes('duplicateReviewOverride: Boolean(overrideReason)'));
  assert.ok(s.includes('duplicateReviewReason: overrideReason || undefined'));
  assert.ok(s.includes('body.error === "possible_duplicates"'));
  assert.ok(s.includes('setDuplicateReview({ payload, candidates: body.candidates })'));
  assert.ok(s.includes("setEditOpen(false)"));
  assert.ok(s.includes('confirmDuplicate'));
  assert.ok(s.includes("confirmReviewedDuplicate"));
  assert.ok(s.includes('role="alert"'), "dialog errors must be discoverable");
  assert.ok(s.includes('name="changeReason" required'));
  assert.ok(s.includes("updating.current"));
  assert.ok(s.includes("patient.dateOfBirth ||"));
  assert.doesNotMatch(s, /window\.confirm\s*\(/);
});

test("Physical report handover cannot be recorded without staff attestation and traceable idempotency", () => {
  const s = files.handover;
  assert.ok(s.includes("if(busy||recorded||!attested)return"));
  assert.ok(s.includes("verificationMethod:method,attestedInPerson:true"));
  assert.ok(s.includes("if(requestId.current?.payload!==payload)"));
  assert.ok(s.includes("handoverRequestId"));
  assert.ok(s.includes('patient_identifiers_do_not_match_report'));
  assert.ok(s.includes('report_not_current_and_final'));
  assert.ok(s.includes('setRecorded(true)'));
  assert.ok(s.includes('setOpen(false)'));
  assert.ok(s.includes("setAttested(false)"));
  assert.ok(s.includes('disabled={busy||recorded||!attested||!patientNumber.trim()}'));
  assert.ok(s.includes("not a patient signature"));
});

test("Rerun and repeat modal never rewrites result and handles ambiguous network failures safely", () => {
  const s = files.repeat;
  assert.ok(s.includes('type: "RERUN" | "REPEAT"'));
  assert.ok(s.includes('method: "POST"'));
  assert.ok(s.includes('body: JSON.stringify({ type, reason })'));
  assert.ok(s.includes('if (busy || !reason.trim()) return'));
  assert.ok(s.includes('disabled={busy || !reason.trim()}'));
  assert.ok(s.includes('setOpen(false)'));
  assert.ok(s.includes('setFailed(true)'));
  assert.ok(s.includes('Review the event register before retrying'));
  assert.ok(s.includes('<SystemDateText value={item.requestedAt} />'));
  assert.ok(s.includes('form-error form-span" role="alert"'));
});

test("Role permission search is visual only: checked grants and hidden privileged grants stay in DOM", () => {
  const s = files.roles;
  assert.ok(s.includes("const [permissionQuery, setPermissionQuery] = useState"));
  assert.ok(s.includes("const visiblePermission"));
  assert.ok(s.includes('type="search" data-modal-ui-only="true"'));
  assert.ok(s.includes('style={{display:visiblePermission(permission) ? undefined : "none"}}'));
  assert.ok(s.includes('style={{display:permissions.some(visiblePermission) ? undefined : "none"}}'));
  assert.ok(s.includes('protectedFinancialPermission && currentlyGranted && <input type="hidden"'));
  assert.ok(s.includes('disabled={protectedFinancialPermission}'));
  assert.ok(s.includes('form.getAll("permissionIds")'));
  assert.ok(s.includes('role.isSystem'));
  assert.ok(s.includes("inFlight.current"));
  assert.ok(files.modal.includes('.closest("[data-modal-ui-only]")'));
  assert.ok(files.css.includes(".crud-modal-compact .permission-groups{display:grid;grid-template-columns:minmax(0,1fr)"));
});

test("AST source inventory still covers all 81 routes and requires owner decision for clinical exceptions", () => {
  const result = JSON.parse(execFileSync(process.execPath,
    ["scripts/ui-full-surface-audit.mjs", "--json"],
    {encoding: "utf8", maxBuffer: 20 * 1024 * 1024})) as {
      routesInspected: number;
      violations: string[];
      ownerDecisionCandidates: Array<{file: string; reason: string}>;
      routes: Array<{workflows: {actualBrowserReview: string}}>;
    };
  assert.equal(result.routesInspected, 81);
  assert.deepEqual(result.violations, []);
  assert.ok(result.ownerDecisionCandidates.length > 0);
  for (const entry of result.ownerDecisionCandidates) {
    assert.match(entry.file, /^src\/components\//);
    assert.ok(entry.reason.length > 18);
  }
  assert.ok(result.routes.every(r => r.workflows.actualBrowserReview === "NOT_EXECUTED"));
  assert.ok(files.audit.includes('OWNER_DECISION_REQUIRED'));
  assert.ok(files.audit.includes('MANUAL_DOM_CONTAINMENT_REVIEW_REQUIRED'));
});
