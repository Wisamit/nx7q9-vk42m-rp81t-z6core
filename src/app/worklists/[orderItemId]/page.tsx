import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveReferenceInterval } from "@/lib/result-reference";
import { ResultEntryForm } from "@/components/result-entry-form";

export const dynamic = "force-dynamic";

function rangeDisplay(interval: {
  lowValue: { toString(): string } | null;
  highValue: { toString(): string } | null;
  normalTextEn: string | null;
  criticalLow: { toString(): string } | null;
  criticalHigh: { toString(): string } | null;
} | null) {
  if (!interval) return null;
  const normal = interval.normalTextEn
    || (interval.lowValue !== null || interval.highValue !== null
      ? `${interval.lowValue?.toString() || "—"} – ${interval.highValue?.toString() || "—"}`
      : null);
  const critical = interval.criticalLow !== null || interval.criticalHigh !== null
    ? `Critical: ${interval.criticalLow?.toString() || "—"} / ${interval.criticalHigh?.toString() || "—"}`
    : null;
  return [normal, critical].filter(Boolean).join(" · ") || null;
}

export default async function WorklistResultPage({ params }: { params: Promise<{ orderItemId: string }> }) {
  const session = await requirePermission("results.enter");
  const { orderItemId } = await params;
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const item = await prisma.orderItem.findFirst({
    where: {
      id: orderItemId,
      order: { organizationId: session.user.organizationId },
    },
    include: {
      order: { include: { patient: true, orderingBranch: true } },
      test: {
        include: {
          department: true,
          defaultUnit: true,
          method: true,
          components: {
            where: { status: "ACTIVE" },
            include: { unit: true },
            orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
          },
        },
      },
      specimenLinks: {
        include: { specimen: { include: { currentBranch: true, specimenType: true, container: true } } },
        orderBy: { createdAt: "desc" },
      },
      results: {
        orderBy: { version: "desc" },
        take: 1,
        include: {
          values: true,
          performingBranch: true,
          enteredBy: true,
          verifiedBy: true,
          specimen: true,
        },
      },
    },
  });

  if (!item) notFound();

  const latestResult = item.results[0] || null;
  const readySpecimen = latestResult?.specimen
    || item.specimenLinks.map(link => link.specimen).find(specimen =>
      ["RECEIVED","IN_PROCESS"].includes(specimen.status) &&
      specimen.currentBranchId &&
      branchIds.includes(specimen.currentBranchId)
    );

  if (!readySpecimen || !readySpecimen.currentBranchId || !branchIds.includes(readySpecimen.currentBranchId)) {
    return <main className="catalog-shell">
      <header className="page-header">
        <div><p className="eyebrow">Result Entry</p><h1>{item.testCodeSnapshot} — {item.testNameEnSnapshot}</h1></div>
        <Link className="secondary-link" href="/worklists">Back to Worklists</Link>
      </header>
      <section className="detail-card">
        <h2>Specimen not ready</h2>
        <p className="muted">A received specimen at one of your authorized branches is required before manual result entry.</p>
      </section>
    </main>;
  }

  const existingByCode = new Map((latestResult?.values || []).map(value => [value.componentCodeSnapshot, value]));
  const componentDefinitions = item.test.components.length > 0
    ? item.test.components.map(component => ({
        componentId: component.id,
        code: component.code,
        nameEn: component.nameEn,
        nameAr: component.nameAr,
        resultType: component.resultType,
        unit: component.unit?.symbol || null,
      }))
    : [{
        componentId: null,
        code: item.test.code,
        nameEn: item.test.nameEn,
        nameAr: item.test.nameAr,
        resultType: item.test.resultType,
        unit: item.test.defaultUnit?.symbol || null,
      }];

  const fields = await Promise.all(componentDefinitions.map(async component => {
    const existing = existingByCode.get(component.code);
    const interval = existing || !component.componentId ? null : await resolveReferenceInterval(prisma, {
      componentId: component.componentId,
      branchId: latestResult?.performingBranchId || readySpecimen.currentBranchId!,
      methodId: item.test.methodId,
      patientSex: item.order.patient.sexAtBirth,
      dateOfBirth: item.order.patient.dateOfBirth,
    });

    const referenceDisplay = existing
      ? [
          existing.referenceTextEnSnapshot
            || (existing.referenceLowSnapshot !== null || existing.referenceHighSnapshot !== null
              ? `${existing.referenceLowSnapshot?.toString() || "—"} – ${existing.referenceHighSnapshot?.toString() || "—"}`
              : null),
          existing.criticalLowSnapshot !== null || existing.criticalHighSnapshot !== null
            ? `Critical: ${existing.criticalLowSnapshot?.toString() || "—"} / ${existing.criticalHighSnapshot?.toString() || "—"}`
            : null,
        ].filter(Boolean).join(" · ") || null
      : rangeDisplay(interval);

    return {
      ...component,
      currentValue: existing?.displayValue || "",
      currentFlag: existing?.flag || null,
      referenceDisplay,
      critical: Boolean(existing?.isCritical),
    };
  }));

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Manual Result Entry</p>
        <h1>{item.testCodeSnapshot} — {item.testNameEnSnapshot}</h1>
        <p className="muted">{item.order.accessionNumber} · {item.order.patient.patientNumber} · {item.order.patient.fullNameEn}</p>
      </div>
      <Link className="secondary-link" href="/worklists">Back to Worklists</Link>
    </header>

    <section className="detail-grid">
      <article className="detail-card">
        <h2>Patient & Order</h2>
        <dl>
          <dt>Patient</dt><dd>{item.order.patient.fullNameEn}</dd>
          <dt>Date of birth</dt><dd>{item.order.patient.dateOfBirth?.toISOString().slice(0,10) || "—"}</dd>
          <dt>Sex at birth</dt><dd>{item.order.patient.sexAtBirth}</dd>
          <dt>Priority</dt><dd>{item.order.priority}</dd>
          <dt>Department</dt><dd>{item.test.department?.nameEn || "Unassigned"}</dd>
          <dt>Method</dt><dd>{item.test.method?.nameEn || "Not configured"}</dd>
        </dl>
      </article>
      <article className="detail-card">
        <h2>Specimen</h2>
        <dl>
          <dt>Barcode</dt><dd><strong>{readySpecimen.barcode}</strong></dd>
          <dt>Type</dt><dd>{readySpecimen.specimenType?.nameEn || "—"}</dd>
          <dt>Container</dt><dd>{readySpecimen.container?.nameEn || "—"}</dd>
          <dt>Status</dt><dd>{readySpecimen.status}</dd>
          <dt>Location</dt><dd>{readySpecimen.currentBranch?.nameEn || latestResult?.performingBranch.nameEn || "—"}</dd>
        </dl>
      </article>
    </section>

    <section className="detail-card detail-section">
      <h2>Result Values</h2>
      <p className="muted">Reference intervals are matched by effective date, branch, method, sex and patient age when configured. The matched values are snapshotted with the result.</p>
      <ResultEntryForm
        orderItemId={item.id}
        specimenId={readySpecimen.id}
        performingBranchId={latestResult?.performingBranchId || readySpecimen.currentBranchId}
        fields={fields}
        comments={latestResult?.comments || ""}
        resultId={latestResult?.id || null}
        resultStatus={latestResult?.status || null}
      />
    </section>

    {latestResult && <section className="detail-card detail-section">
      <h2>Result Audit Context</h2>
      <dl>
        <dt>Version</dt><dd>{latestResult.version}</dd>
        <dt>Source</dt><dd>{latestResult.source}</dd>
        <dt>Entered by</dt><dd>{latestResult.enteredBy.displayNameEn}</dd>
        <dt>Entered at</dt><dd>{latestResult.enteredAt.toISOString().replace("T"," ").slice(0,19)}</dd>
        <dt>Verified by</dt><dd>{latestResult.verifiedBy?.displayNameEn || "—"}</dd>
        <dt>Verified at</dt><dd>{latestResult.verifiedAt?.toISOString().replace("T"," ").slice(0,19) || "—"}</dd>
      </dl>
    </section>}
  </main>;
}
