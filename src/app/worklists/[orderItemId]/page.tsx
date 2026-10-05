import Link from "next/link";
import { notFound } from "next/navigation";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveReferenceInterval } from "@/lib/result-reference";
import { ResultEntryForm } from "@/components/result-entry-form";
import { ResultWorkflowActions } from "@/components/result-workflow-actions";
import { ReflexReviewPanel } from "@/components/reflex-review-panel";
import { ValidationHoldPanel } from "@/components/validation-hold-panel";

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
  const permissions = permissionSet(session);
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
          calculatedRules: {
            where: {
              status: "ACTIVE",
              effectiveFrom: { lte: new Date() },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
            },
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
          releasedBy: true,
          amendedFrom: true,
          criticalEvents: {
            include: {
              communications: {
                include: { communicatedBy: true },
                orderBy: { communicatedAt: "desc" },
              },
            },
          },
          reflexEvents: {
            include: {
              rule: { include: { targetTest: true } },
              reviewedBy: true,
            },
            orderBy: { createdAt: "asc" },
          },
          validationHoldEvents: {
            include: {
              rule: true,
              reviewedBy: true,
            },
            orderBy: { createdAt: "asc" },
          },
          specimen: { include: { currentBranch: true, specimenType: true, container: true } },
        },
      },
    },
  });

  if (!item) notFound();

  const latestResult = item.results[0] || null;
  const commentTemplates = await prisma.resultCommentTemplate.findMany({
    where: {
      organizationId: session.user.organizationId,
      status: "ACTIVE",
      OR: [
        { scope: "ORGANIZATION" },
        { scope: "TEST", testId: item.testId },
        { scope: "COMPONENT", testId: item.testId, componentId: { in: item.test.components.map(component => component.id) } },
      ],
    },
    select: { id: true, code: true, nameEn: true, textEn: true },
    orderBy: { nameEn: "asc" },
  });
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
  const calculatedTargetIds = new Set(item.test.calculatedRules.map(rule => rule.targetComponentId));
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
      deltaEvaluation: existing?.deltaEvaluation || null,
      calculated: Boolean(component.componentId && calculatedTargetIds.has(component.componentId)),
      deltaDisplay: existing ? [
        existing.previousValueSnapshot !== null ? "Prev " + existing.previousValueSnapshot.toString() : null,
        existing.deltaAbsoluteSnapshot !== null ? "Δ " + existing.deltaAbsoluteSnapshot.toString() : null,
        existing.deltaPercentSnapshot !== null ? existing.deltaPercentSnapshot.toString() + "%" : null,
        existing.deltaEvaluation,
      ].filter(Boolean).join(" · ") : null,
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
        canVerify={permissions.has("results.verify")}
        commentTemplates={commentTemplates}
      />

      {latestResult && <ReflexReviewPanel
        resultId={latestResult.id}
        canReview={permissions.has("reflex.review")}
        events={latestResult.reflexEvents.map(event => ({
          id: event.id,
          status: event.status,
          triggerValue: event.triggerValueSnapshot,
          targetTestCode: event.targetTestCodeSnapshot,
          targetTestName: event.targetTestNameEnSnapshot,
          noteEn: event.rule.noteEn,
          reviewedBy: event.reviewedBy?.displayNameEn || null,
          reviewedAt: event.reviewedAt?.toISOString() || null,
          reviewNote: event.reviewNote,
        }))}
      />}

      {latestResult && <ValidationHoldPanel
        resultId={latestResult.id}
        canReview={permissions.has("validation_holds.review")}
        events={latestResult.validationHoldEvents.map(event => ({
          id: event.id,
          status: event.status,
          severity: event.severitySnapshot,
          reasonEn: event.reasonEnSnapshot,
          reasonAr: event.reasonArSnapshot,
          reviewedBy: event.reviewedBy?.displayNameEn || null,
          reviewedAt: event.reviewedAt?.toISOString() || null,
          reviewNote: event.reviewNote,
        }))}
      />}
    </section>

    {latestResult && <section className="detail-card detail-section">
      <h2>Validation, Release & Amendment</h2>
      <ResultWorkflowActions
        resultId={latestResult.id}
        resultStatus={latestResult.status}
        criticalCount={latestResult.values.filter(value => value.isCritical).length}
        criticalEventStatus={latestResult.criticalEvents[0]?.status || null}
        communications={(latestResult.criticalEvents[0]?.communications || []).map(item => ({
          id: item.id,
          method: item.method,
          outcome: item.outcome,
          recipientName: item.recipientName,
          recipientRole: item.recipientRole,
          acknowledgementConfirmed: item.acknowledgementConfirmed,
          readBackConfirmed: item.readBackConfirmed,
          communicatedAt: item.communicatedAt.toISOString(),
          communicatedBy: item.communicatedBy.displayNameEn,
        }))}
        canCommunicate={permissions.has("critical.communicate")}
        canRelease={permissions.has("results.release")}
        canAmend={permissions.has("results.amend")}
      />
      {permissions.has("reports.view") && <p><Link className="secondary-link" href={`/reports/${item.orderId}`}>Open Diagnostic Report</Link></p>}
    </section>}

    {latestResult && <section className="detail-card detail-section">
      <h2>Result Audit Context</h2>
      <dl>
        <dt>Version</dt><dd>{latestResult.version}</dd>
        <dt>Source</dt><dd>{latestResult.source}</dd>
        <dt>Entered by</dt><dd>{latestResult.enteredBy.displayNameEn}</dd>
        <dt>Entered at</dt><dd>{latestResult.enteredAt.toISOString().replace("T"," ").slice(0,19)}</dd>
        <dt>Verification mode</dt><dd>{latestResult.autoVerified ? "AUTOVERIFICATION" : "MANUAL"}</dd>
        <dt>Verified by</dt><dd>{latestResult.autoVerified ? "System policy" : latestResult.verifiedBy?.displayNameEn || "—"}</dd>
        <dt>Verified at</dt><dd>{latestResult.verifiedAt?.toISOString().replace("T"," ").slice(0,19) || "—"}</dd>
        <dt>Released by</dt><dd>{latestResult.releasedBy?.displayNameEn || "—"}</dd>
        <dt>Released at</dt><dd>{latestResult.releasedAt?.toISOString().replace("T"," ").slice(0,19) || "—"}</dd>
        <dt>Version</dt><dd>{latestResult.version}{latestResult.amendedFromId ? " · amendment" : ""}</dd>
        <dt>Amendment reason</dt><dd>{latestResult.amendmentReason || "—"}</dd>
      </dl>
    </section>}
  </main>;
}
