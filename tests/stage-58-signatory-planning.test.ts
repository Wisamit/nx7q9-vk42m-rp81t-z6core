import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { summarizeSignatoryPlanning, type ReviewCandidate } from "../src/lib/catalog-signatory-planning.ts";

const make = (id: string, extras: Partial<ReviewCandidate> = {}): ReviewCandidate => ({
  id, status: "ACTIVE", mfaEnabled: false, activeBranchIds: ["branch-a"],
  hasRestrictedDepartments: false, hasActiveApplicableDepartment: false,
  permissions: new Set(["catalog.manage"]), ...extras,
});
const clinical = new Set(["catalog.manage", "catalog.reference_ranges.manage"]);
const finance = new Set(["catalog.manage", "pricing.manage"]);
const combined = new Set(["catalog.manage", "pricing.manage", "catalog.reference_ranges.manage"]);

test("Stage 58: independent and domain-specific reviewer capacity is never signatory authorization", () => {
  const r = summarizeSignatoryPlanning({
    branchId: "branch-a", authorId: "author",
    candidates: [
      make("author", { permissions: combined, mfaEnabled: true }),
      make("med", { permissions: clinical, mfaEnabled: true }),
      make("fin", { permissions: finance }),
      make("dual", { permissions: combined, mfaEnabled: true }),
      make("otherBranch", { permissions: combined, activeBranchIds: ["branch-b"] }),
      make("inactive", { permissions: combined, status: "DISABLED" }),
      make("departmentRevoked", { permissions: combined, hasRestrictedDepartments: true }),
      make("notCatalogAdmin", { permissions: new Set(["pricing.manage"]) }),
    ],
  });
  assert.equal(r.clinicalReviewerCandidates, 2);
  assert.equal(r.financialReviewerCandidates, 2);
  assert.equal(r.crossQualifiedReviewers, 1);
  assert.equal(r.distinctPairAvailable, true);
  assert.equal(r.mfaEnabledPotentialReviewers, 2);
  assert.deepEqual(r.gaps, [
    "FORMAL_SIGNATORY_ROLES_NOT_ESTABLISHED",
    "SIGNATURE_AUTHENTICATION_POLICY_UNDEFINED",
    "SIGNATURE_EVIDENCE_AND_VERSIONED_APPLICATION_NOT_IMPLEMENTED",
  ]);
  assert.equal(r.qualificationToSign, false);
  assert.equal(r.signaturePolicyApproved, false);
  assert.equal(r.signingEnabled, false);
  assert.equal(r.clinicalApprovalAllowed, false);
  assert.equal(r.financialApprovalAllowed, false);
  assert.equal(r.liveWrites, false);
  assert.doesNotMatch(JSON.stringify(r), /author|med|fin|dual|otherBranch|password/i);
});

test("Stage 58: one dual-domain manager is not two independent reviewers", () => {
  const one = summarizeSignatoryPlanning({
    branchId: "branch-a", authorId: "author",
    candidates: [make("both", { permissions: combined })],
  });
  assert.equal(one.clinicalReviewerCandidates, 1);
  assert.equal(one.financialReviewerCandidates, 1);
  assert.equal(one.crossQualifiedReviewers, 1);
  assert.equal(one.distinctPairAvailable, false);
  assert.ok(one.gaps.includes("NO_TWO_DISTINCT_CROSS_DOMAIN_REVIEWERS"));
  const noRoles = summarizeSignatoryPlanning({
    branchId: "branch-a", authorId: "author", candidates: [
      make("m", { permissions: clinical, activeBranchIds: [] }),
      make("f", { permissions: finance, hasRestrictedDepartments: true,
        hasActiveApplicableDepartment: false }),
    ],
  });
  assert.equal(noRoles.clinicalReviewerCandidates, 0);
  assert.equal(noRoles.financialReviewerCandidates, 0);
  assert.ok(noRoles.gaps.includes("NO_INDEPENDENT_CLINICAL_REVIEW_CANDIDATE"));
  assert.ok(noRoles.gaps.includes("NO_INDEPENDENT_FINANCIAL_REVIEW_CANDIDATE"));
  const oneRestricted = summarizeSignatoryPlanning({
    branchId: "branch-a", authorId: "author", candidates: [
      make("med", { permissions: clinical, hasRestrictedDepartments: true,
        hasActiveApplicableDepartment: true }),
    ],
  });
  assert.equal(oneRestricted.clinicalReviewerCandidates, 1);
  assert.equal(oneRestricted.financialReviewerCandidates, 0);
  assert.throws(() => summarizeSignatoryPlanning({
    branchId: "branch-a", authorId: "author",
    candidates: [make("repeat"), make("repeat")],
  }), /duplicate_user/);
});

test("Stage 58: governance uses live tenant/branch/department roles and count-only response", () => {
  const route = readFileSync("src/app/api/catalog/imports/[id]/bundle-drift/route.ts", "utf8");
  const ui = readFileSync("src/components/catalog-governance-readiness.tsx", "utf8");
  assert.match(route, /summarizeSignatoryPlanning\(/);
  assert.match(route, /potentialReviewers\.length > 1000/);
  assert.match(route, /where: \{ organizationId, status: "ACTIVE" \}/);
  assert.match(route, /candidate\.roles\.filter\(grant/);
  assert.match(route, /grant\.role\.status === "ACTIVE"/);
  assert.match(route, /scope\.department\.organizationId === organizationId/);
  assert.match(route, /scope\.branch\.organizationId === organizationId/);
  assert.match(route, /authorId: batch\.createdByUserId/);
  assert.match(route, /planningReviewerCounts/);
  assert.match(route, /qualificationToSign: false|summarizeSignatoryPlanning/);
  assert.match(route, /isolationLevel: "RepeatableRead"/);
  assert.doesNotMatch(route,
    /tx\.(?:user|userRole|role|rolePermission|userBranchScope|userDepartmentScope|labTest|priceList|referenceInterval)\.(?:update|create|upsert|delete)/);
  assert.match(ui, /signatoryPlanning\.qualificationToSign !== false/);
  assert.match(ui, /Potential independent reviewer capacity/);
  assert.match(ui, /القدرة المحتملة للمراجعين المستقلين/);
  assert.match(ui, /clinicalApprovalAllowed !== false/);
  assert.match(ui, /financialApprovalAllowed !== false/);
});
