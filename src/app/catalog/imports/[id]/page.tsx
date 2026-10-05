import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SafeImportButton } from "@/components/safe-import-button";
import { RevalidateImportButton } from "@/components/revalidate-import-button";
import { ReferenceRangeImportButton } from "@/components/reference-range-import-button";

export const dynamic = "force-dynamic";

type RowStatus = "VALID" | "WARNING" | "ERROR" | "IMPORTED" | "SKIPPED";

function issueCodes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const code = (item as Record<string, unknown>).code;
    return typeof code === "string" ? [code] : [];
  });
}

export default async function ImportBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requirePermission("catalog.view");
  const { id } = await params;
  const query = await searchParams;
  const requested = query.status?.toUpperCase();
  const status = ["VALID", "WARNING", "ERROR", "IMPORTED", "SKIPPED"].includes(requested || "")
    ? requested as RowStatus
    : undefined;

  const batch = await prisma.catalogImportBatch.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!batch) notFound();

  const [groups, issueRows, rows, totalRows] = await Promise.all([
    prisma.catalogImportRow.groupBy({
      by: ["status", "entityType"],
      where: { batchId: batch.id },
      _count: { _all: true },
    }),
    prisma.catalogImportRow.findMany({
      where: { batchId: batch.id, status: { in: ["WARNING", "ERROR"] } },
      select: { entityType: true, status: true, validationIssues: true },
    }),
    prisma.catalogImportRow.findMany({
      where: { batchId: batch.id, ...(status ? { status } : {}) },
      orderBy: { rowNumber: "asc" },
      take: 1000,
    }),
    prisma.catalogImportRow.count({ where: { batchId: batch.id } }),
  ]);

  const counts = groups.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + row._count._all;
    return acc;
  }, {} as Record<string, number>);

  const entityCounts = groups.reduce((acc, row) => {
    acc[row.entityType] = (acc[row.entityType] || 0) + row._count._all;
    return acc;
  }, {} as Record<string, number>);

  const generatedTestRemaining = issueRows.filter((row) => row.entityType === "TEST" && row.status === "WARNING" && (() => {
    const codes = issueCodes(row.validationIssues);
    return codes.length === 1 && codes[0] === "GENERATED_TEST_CODE";
  })()).length;
  const safeMasterRemaining = groups.filter((row) => row.status === "VALID" && row.entityType !== "REFERENCE_INTERVAL").reduce((sum, row) => sum + row._count._all, 0) + generatedTestRemaining;

  const issueSummary = issueRows.flatMap((row) => issueCodes(row.validationIssues)).reduce((acc, code) => {
    acc[code] = (acc[code] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Legacy Migration Review</p>
        <h1>{batch.sourceName}</h1>
        <p className="muted">Source rows are preserved separately from normalized candidates. Resolve errors before live import.</p>
      </div>
      <Link className="secondary-link" href="/catalog">Back to Test Catalog</Link>
    </header>

    <section className="catalog-stats">
      <article><strong>{totalRows}</strong><span>Total staged</span></article>
      <article><strong>{counts.VALID || 0}</strong><span>Valid</span></article>
      <article><strong>{counts.WARNING || 0}</strong><span>Warnings</span></article>
      <article><strong>{counts.ERROR || 0}</strong><span>Errors</span></article>
    </section>

    <section className="validation-summary">
      <article className="detail-card">
        <h2>Entity Breakdown</h2>
        <div className="summary-list">
          {Object.entries(entityCounts).sort(([a],[b]) => a.localeCompare(b)).map(([key,value]) =>
            <div key={key}><span>{key}</span><strong>{value}</strong></div>
          )}
        </div>
      </article>
      <article className="detail-card">
        <h2>Issue Breakdown</h2>
        <div className="summary-list">
          {Object.keys(issueSummary).length === 0
            ? <p className="muted">No validation issues.</p>
            : Object.entries(issueSummary).sort((a,b) => b[1]-a[1]).map(([key,value]) =>
              <div key={key}><span>{key}</span><strong>{value}</strong></div>
            )}
        </div>
      </article>
    </section>

    <section className="detail-card range-import-card">
      <h2>Reference Range Migration</h2>
      <p className="muted">Only exact test matches with mapped units and unambiguous age/sex context are eligible for automatic import. Ambiguous rows remain staged for review.</p>
      <ReferenceRangeImportButton batchId={batch.id} />
    </section>

    <section className="table-card">
      <div className="table-toolbar">
        <div><h2>Validation Review</h2><span>Status: {batch.status} · showing {rows.length}{status ? ` ${status.toLowerCase()}` : ""} row(s)</span></div>
        <div className="review-actions">
          <Link className={!status ? "filter-chip active" : "filter-chip"} href={`/catalog/imports/${batch.id}`}>All</Link>
          <Link className={status === "ERROR" ? "filter-chip active" : "filter-chip"} href={`/catalog/imports/${batch.id}?status=ERROR`}>Errors ({counts.ERROR || 0})</Link>
          <Link className={status === "WARNING" ? "filter-chip active" : "filter-chip"} href={`/catalog/imports/${batch.id}?status=WARNING`}>Warnings ({counts.WARNING || 0})</Link>
          <Link className={status === "VALID" ? "filter-chip active" : "filter-chip"} href={`/catalog/imports/${batch.id}?status=VALID`}>Valid ({counts.VALID || 0})</Link>
          {batch.status === "DRAFT" && <RevalidateImportButton batchId={batch.id} />}
          {batch.status === "VALIDATED" && safeMasterRemaining > 0 && <SafeImportButton batchId={batch.id} />}
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Entity</th><th>Legacy key</th><th>Status</th><th>Normalized candidate</th><th>Issues</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}>
            <td>{r.rowNumber}</td><td>{r.entityType}</td><td>{r.legacyKey || "—"}</td><td><strong>{r.status}</strong></td>
            <td><code className="json-preview">{JSON.stringify(r.normalizedData)}</code></td>
            <td><code className="json-preview">{Array.isArray(r.validationIssues) && r.validationIssues.length ? JSON.stringify(r.validationIssues) : "—"}</code></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  </main>;
}
