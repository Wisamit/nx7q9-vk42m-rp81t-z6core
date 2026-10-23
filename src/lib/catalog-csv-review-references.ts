import type { Prisma } from "../../generated/prisma/client.ts";
import { clinicalImportTestWhere } from "./catalog-clinical-import-scope.ts";
import { genericCatalogPriceScope } from "./catalog-generic-price-scope.ts";

export type SpreadsheetReferenceCandidate = {
  entityType: string;
  normalized: Record<string, unknown>;
  status: "VALID" | "WARNING" | "ERROR";
};
export type SpreadsheetReferenceIssue = {
  severity: "ERROR" | "WARNING";
  code: string;
  message: string;
};

export type SpreadsheetReferenceSnapshot = {
  tests: ReadonlySet<string>;
  units: ReadonlySet<string>;
  packages: ReadonlySet<string>;
  priceLists: ReadonlySet<string>;
};
export type SpreadsheetReferenceScope = {
  organizationId: string;
  branchId: string;
  departmentIds: readonly string[];
  authorizedBranchIds: readonly string[];
};

const MAX_CODES_PER_QUERY = 400;
const code = (row: Record<string, unknown>, field: string): string =>
  typeof row[field] === "string" ? row[field].trim().toUpperCase() : "";

function addCode(set: Set<string>, value: string): void {
  if (value) set.add(value);
}

function members(candidate: SpreadsheetReferenceCandidate): string[] {
  const values = candidate.normalized.memberTestCodes;
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === "string")
    .map(value => value.trim().toUpperCase()).filter(Boolean);
}

/** Determine referential requirements without guessing clinical identities. */
export function spreadsheetReferenceCodes(candidates: readonly SpreadsheetReferenceCandidate[]) {
  const needs = {
    tests: new Set<string>(), units: new Set<string>(),
    packages: new Set<string>(), priceLists: new Set<string>(),
  };
  for (const row of candidates) {
    const d = row.normalized;
    if (row.entityType === "COMPONENT") {
      addCode(needs.tests, code(d, "testCode"));
      addCode(needs.units, code(d, "unitCode"));
    } else if (row.entityType === "PANEL" || row.entityType === "PACKAGE") {
      members(row).forEach(value => addCode(needs.tests, value));
    } else if (row.entityType === "PRICE_LIST_ITEM") {
      addCode(needs.tests, code(d, "testCode"));
      addCode(needs.priceLists, code(d, "priceListCode"));
    } else if (row.entityType === "PRICE_LIST_PACKAGE_ITEM") {
      addCode(needs.packages, code(d, "packageCode"));
      addCode(needs.priceLists, code(d, "priceListCode"));
    }
  }
  return needs;
}

const ISSUE = {
  missing: {
    severity: "ERROR",
    code: "CSV_REVIEW_REFERENCE_MISSING_OR_OUT_OF_SCOPE",
    message: "Referenced master identity is unavailable within the currently authorized active tenant/branch scope.",
  },
  pending: {
    severity: "WARNING",
    code: "CSV_REVIEW_REFERENCE_STAGED_ONLY",
    message: "Referenced master exists only in this unapproved review batch; no live relationship or approval is implied.",
  },
} as const;

function stagedCodes(candidates: readonly SpreadsheetReferenceCandidate[], entityType: string): Set<string> {
  const codes = new Set<string>();
  for (const candidate of candidates) {
    // An invalid or ambiguous staged source must never satisfy a dependency.
    if (candidate.entityType === entityType && candidate.status !== "ERROR") {
      addCode(codes, code(candidate.normalized, "code"));
    }
  }
  return codes;
}

/**
 * Review finding only. The source filename, legacyKey and free-text labels do
 * NOT grant reference authority. A staged master is not equivalent to a live
 * master. This does not validate medical equivalence or publish configuration.
 */
export function spreadsheetReferenceFindings(
  candidates: readonly SpreadsheetReferenceCandidate[],
  snapshot: SpreadsheetReferenceSnapshot,
): SpreadsheetReferenceIssue[][] {
  const staged = {
    tests: stagedCodes(candidates, "TEST"),
    units: stagedCodes(candidates, "UNIT"),
    packages: stagedCodes(candidates, "PACKAGE"),
    priceLists: stagedCodes(candidates, "PRICE_LIST"),
  };
  const results: SpreadsheetReferenceIssue[][] = candidates.map(() => []);
  for (const [index, candidate] of candidates.entries()) {
    const refs: Array<[keyof SpreadsheetReferenceSnapshot, string]> = [];
    const d = candidate.normalized;
    if (candidate.entityType === "COMPONENT") {
      refs.push(["tests", code(d, "testCode")]);
      if (code(d, "unitCode")) refs.push(["units", code(d, "unitCode")]);
    } else if (candidate.entityType === "PANEL" || candidate.entityType === "PACKAGE") {
      members(candidate).forEach(value => refs.push(["tests", value]));
    } else if (candidate.entityType === "PRICE_LIST_ITEM") {
      refs.push(["tests", code(d, "testCode")],
        ["priceLists", code(d, "priceListCode")]);
    } else if (candidate.entityType === "PRICE_LIST_PACKAGE_ITEM") {
      refs.push(["packages", code(d, "packageCode")],
        ["priceLists", code(d, "priceListCode")]);
    }
    // Multiple references can point at the same code; persist a bounded,
    // non-identifying finding rather than exposing foreign-tenant metadata.
    let missing = false, pending = false;
    for (const [kind, identity] of refs) {
      if (!identity) continue; // Existing syntax validation owns required fields.
      if (snapshot[kind].has(identity)) continue;
      if (staged[kind].has(identity)) pending = true;
      else missing = true;
    }
    if (missing) results[index].push({ ...ISSUE.missing });
    if (pending) results[index].push({ ...ISSUE.pending });
  }
  return results;
}

async function collectScopedCodes(
  values: ReadonlySet<string>,
  loader: (codes: string[]) => Promise<Array<{code: string}>>,
): Promise<ReadonlySet<string>> {
  const found = new Set<string>();
  const names = [...values];
  // Bounded IN lists avoid a giant driver packet for a 20,000-row review.
  for (let start = 0; start < names.length; start += MAX_CODES_PER_QUERY) {
    for (const row of await loader(names.slice(start, start + MAX_CODES_PER_QUERY))) {
      found.add(row.code.toUpperCase());
    }
  }
  return found;
}

/**
 * Run only INSIDE the existing active-organization FOR UPDATE transaction,
 * AFTER current role/branch/department grants have been rechecked. These
 * are read-only, tenant-scoped lookups of ACTIVE master identities.
 */
export async function liveSpreadsheetReferenceFindings(
  tx: Prisma.TransactionClient,
  scope: SpreadsheetReferenceScope,
  candidates: readonly SpreadsheetReferenceCandidate[],
): Promise<SpreadsheetReferenceIssue[][]> {
  const needs = spreadsheetReferenceCodes(candidates);
  const clinicalScope = {
    organizationId: scope.organizationId,
    branchId: scope.branchId,
    departmentIds: [...scope.departmentIds],
  };
  const [tests, units, packages, priceLists] = await Promise.all([
    collectScopedCodes(needs.tests, codes =>
      tx.labTest.findMany({where: {
        ...clinicalImportTestWhere(clinicalScope), code: { in: codes },
      }, select: { code: true }})),
    collectScopedCodes(needs.units, codes =>
      tx.unit.findMany({where: {
        organizationId: scope.organizationId, status: "ACTIVE", code: { in: codes },
      }, select: { code: true }})),
    collectScopedCodes(needs.packages, codes =>
      tx.commercialPackage.findMany({where: {
        organizationId: scope.organizationId, status: "ACTIVE", code: { in: codes },
      }, select: { code: true }})),
    collectScopedCodes(needs.priceLists, codes =>
      tx.priceList.findMany({where: {
        organizationId: scope.organizationId, status: "ACTIVE",
        ...genericCatalogPriceScope(scope.authorizedBranchIds),
        code: { in: codes },
      }, select: { code: true }})),
  ]);
  return spreadsheetReferenceFindings(candidates, {tests, units, packages, priceLists});
}
