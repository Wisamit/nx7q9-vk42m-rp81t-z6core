import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clinicalRuleLifecycleState,
  clinicalRuleWindowsOverlap,
  planClinicalRuleApproval,
  ruleIdentity,
} from "../src/lib/clinical-rule-governance.ts";

const base = {
  id: "RULE-1",
  identityKey: ruleIdentity(["TEST-1", "COMP-1", null]),
  effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  effectiveTo: null,
  status: "INACTIVE" as const,
  deactivatedAt: null,
};

test("clinical rule lifecycle distinguishes draft approved and retired without mutable rule details", () => {
  assert.equal(clinicalRuleLifecycleState(base), "DRAFT");
  assert.equal(clinicalRuleLifecycleState({ ...base, status: "ACTIVE" }), "APPROVED");
  assert.equal(clinicalRuleLifecycleState({ ...base, deactivatedAt: new Date("2026-06-01T00:00:00.000Z") }), "RETIRED");
});

test("clinical rule effective windows use closed overlap semantics", () => {
  assert.equal(clinicalRuleWindowsOverlap(
    { effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null },
    { effectiveFrom: new Date("2026-07-01T00:00:00.000Z"), effectiveTo: null },
  ), true);
  assert.equal(clinicalRuleWindowsOverlap(
    { effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: new Date("2026-03-01T00:00:00.000Z") },
    { effectiveFrom: new Date("2026-04-01T00:00:00.000Z"), effectiveTo: null },
  ), false);
});

test("later version closes an earlier overlapping approved rule with the same clinical identity", () => {
  const draft = { ...base, id: "NEW", effectiveFrom: new Date("2026-06-01T00:00:00.000Z") };
  const predecessor = {
    ...base,
    id: "OLD",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    status: "ACTIVE" as const,
  };
  assert.deepEqual(planClinicalRuleApproval(draft, [predecessor]), {
    predecessorsToClose: ["OLD"],
    conflicts: [],
  });
});

test("same or later overlapping approved version blocks approval", () => {
  const draft = { ...base, id: "NEW", effectiveFrom: new Date("2026-06-01T00:00:00.000Z") };
  const same = { ...base, id: "SAME", effectiveFrom: new Date("2026-06-01T00:00:00.000Z"), status: "ACTIVE" as const };
  const later = { ...base, id: "LATER", effectiveFrom: new Date("2026-07-01T00:00:00.000Z"), status: "ACTIVE" as const };
  assert.deepEqual(planClinicalRuleApproval(draft, [same, later]), {
    predecessorsToClose: [],
    conflicts: ["SAME", "LATER"],
  });
});

test("different clinical identities can coexist", () => {
  const other = {
    ...base,
    id: "OTHER",
    identityKey: ruleIdentity(["TEST-1", "COMP-2", null]),
    status: "ACTIVE" as const,
  };
  assert.deepEqual(planClinicalRuleApproval(base, [other]), {
    predecessorsToClose: [],
    conflicts: [],
  });
});

test("rule identity preserves null scope boundaries deterministically", () => {
  assert.equal(ruleIdentity(["TEST-1", null, "METHOD-1"]), ruleIdentity(["TEST-1", null, "METHOD-1"]));
  assert.notEqual(ruleIdentity(["TEST-1", null, "METHOD-1"]), ruleIdentity(["TEST-1", "BRANCH-1", "METHOD-1"]));
});

test("all governed clinical rule creation routes persist inactive drafts", () => {
  const routes = [
    "src/app/api/clinical-rules/calculated/route.ts",
    "src/app/api/clinical-rules/reflex/route.ts",
    "src/app/api/clinical-rules/delta/route.ts",
    "src/app/api/clinical-rules/autoverification/route.ts",
    "src/app/api/clinical-rules/validation-holds/route.ts",
    "src/app/api/clinical-rules/critical-escalation/route.ts",
    "src/app/api/clinical-rules/validation-policies/route.ts",
  ];

  for (const route of routes) {
    const source = readFileSync(route, "utf8");
    assert.match(source, /status:\s*"INACTIVE"/, `${route} must create an inactive draft`);
  }
});

test("clinical rule activation is permission-gated and validation policies cannot use the legacy status patch", () => {
  const governance = readFileSync("src/app/api/clinical-rules/governance/route.ts", "utf8");
  const validationPolicies = readFileSync("src/app/api/clinical-rules/validation-policies/route.ts", "utf8");

  assert.match(governance, /requirePermission\("clinical_rules\.approve"\)/);
  assert.match(governance, /CLINICAL_RULE_APPROVED/);
  assert.match(governance, /CLINICAL_RULE_RETIRED/);
  assert.match(validationPolicies, /use_clinical_rule_governance/);
});
