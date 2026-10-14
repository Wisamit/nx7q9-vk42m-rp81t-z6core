export type ImportCount = { entityType: string; status: string; _count: { _all: number } };
export type ImportLedgerBatch = {
  id: string; sourceType: string; sourceName: string; sourceChecksum: string | null;
  status: string; createdAt: string; validatedAt: string | null; importedAt: string | null;
  counts: ImportCount[];
};
export type ImportLedgerFinding = { code: string; count: number; severity: "BLOCK" | "REVIEW" | "INFO" };
const finished = new Set(["IMPORTED", "SKIPPED"]);
const sourceOnly = new Set(["CONFIG_BUNDLE_REVIEW", "CSV_REVIEW"]);
const targetTypes = new Set(["TEST","PANEL","UNIT","CONTAINER","COMPONENT","REFERENCE_INTERVAL","PRICE_LIST_ITEM","PRICE_LIST_PACKAGE_ITEM","PACKAGE"]);
export function summarizeImportLedger(batch: ImportLedgerBatch) {
  let total = 0, imported = 0, deferred = 0, unresolved = 0, skipped = 0, errors = 0;
  const countsByType = new Map<string, { total: number; imported: number; unresolved: number; skipped: number }>();
  const byStatus: Record<string, number> = {};
  for (const entry of batch.counts) {
    if (!Number.isSafeInteger(entry._count._all) || entry._count._all < 0) throw Error("invalid_import_group_count");
    const amount = entry._count._all;
    total += amount;
    byStatus[entry.status] = (byStatus[entry.status] || 0) + amount;
    const type = countsByType.get(entry.entityType) || { total: 0, imported: 0, unresolved: 0, skipped: 0 };
    type.total += amount;
    if (entry.status === "IMPORTED") { imported += amount; type.imported += amount; }
    else if (entry.status === "SKIPPED") { skipped += amount; type.skipped += amount; }
    else {
      unresolved += amount; type.unresolved += amount;
      if (targetTypes.has(entry.entityType)) deferred += amount;
    }
    if (entry.status === "ERROR") errors += amount;
    countsByType.set(entry.entityType, type);
  }
  const findings: ImportLedgerFinding[] = [];
  if (!batch.sourceChecksum) findings.push({code:"SOURCE_CHECKSUM_MISSING",count:1,severity:"REVIEW"});
  if (total === 0) findings.push({code:"NO_SOURCE_ROWS_RECORDED",count:1,severity:"REVIEW"});
  if (sourceOnly.has(batch.sourceType)) {
    findings.push({code:"REVIEW_ONLY_SOURCE_NOT_COMMITTED",count:total,severity:"INFO"});
  } else {
    if (batch.status !== "IMPORTED") findings.push({code:"BATCH_NOT_IMPORTED",count:1,severity:"BLOCK"});
    if (unresolved) findings.push({code:"UNRESOLVED_STAGED_ROWS",count:unresolved,severity:"BLOCK"});
    if (errors) findings.push({code:"ROWS_WITH_VALIDATION_ERRORS",count:errors,severity:"BLOCK"});
    if (skipped) findings.push({code:"SKIPPED_ROWS_REQUIRE_RECONCILIATION",count:skipped,severity:"REVIEW"});
    if (batch.status === "IMPORTED" && imported === 0 && total > 0)
      findings.push({code:"IMPORTED_BATCH_WITHOUT_IMPORTED_ROWS",count:1,severity:"REVIEW"});
  }
  if (!batch.validatedAt) findings.push({code:"VALIDATION_TIMESTAMP_MISSING",count:1,severity:"REVIEW"});
  return {
    total,imported,skipped,unresolved,deferred,errors,byStatus,
    byType:[...countsByType.entries()].map(([entityType,values])=>({entityType,...values}))
      .sort((a,b)=>a.entityType.localeCompare(b.entityType)),
    findings,
    // A source coverage inventory is not proof of signed clinical or financial reconciliation.
    state:findings.some(f=>f.severity==="BLOCK")?"BLOCKED":findings.some(f=>f.severity==="REVIEW")?"REVIEW_REQUIRED":"RECORDED_ONLY",
  } as const;
}
export function summarizeLedgerCollection(items: ReturnType<typeof summarizeImportLedger>[]) {
  const tally = { batches:items.length,imported:0,skipped:0,unresolved:0,deferred:0,errors:0,blocked:0,reviewRequired:0 };
  for(const x of items) {
    tally.imported+=x.imported;tally.skipped+=x.skipped;tally.unresolved+=x.unresolved;
    tally.deferred+=x.deferred;tally.errors+=x.errors;
    if(x.state==="BLOCKED")tally.blocked++;
    if(x.state==="REVIEW_REQUIRED")tally.reviewRequired++;
  }
  return tally;
}
