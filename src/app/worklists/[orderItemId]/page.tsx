import Link from "next/link";
import { notFound } from "next/navigation";
import { canAccessDepartment, permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { referencePatientSex, resolveReferenceInterval } from "@/lib/result-reference";
import { ResultEntryForm } from "@/components/result-entry-form";
import { ResultWorkflowActions } from "@/components/result-workflow-actions";
import { ReflexReviewPanel } from "@/components/reflex-review-panel";
import { ValidationHoldPanel } from "@/components/validation-hold-panel";
import { ResultRepeatPanel } from "@/components/result-repeat-panel";
import { getUiLocale, sexLabel, statusLabel, tr } from "@/lib/ui-i18n";

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
  const session = await requirePermission("worklists.view");
  const { orderItemId } = await params;
  const permissions = permissionSet(session);
  const locale = getUiLocale(session.user.preferredLocale);
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);
  const now = new Date();

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
          resultSections: {
            where: { status: "ACTIVE" },
            orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
          },
          components: {
            where: { status: "ACTIVE" },
            include: {
              unit: true,
              qualitativeResultOptions: {
                where: {
                  status: "ACTIVE",
                  approvalStatus: "APPROVED",
                  approvedAt: { not: null },
                  effectiveFrom: { lte: now },
                  OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
                },
                orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
              },
            },
            orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
          },
          qualitativeResultOptions: {
            where: {
              componentId: null,
              status: "ACTIVE",
              approvalStatus: "APPROVED",
              approvedAt: { not: null },
              effectiveFrom: { lte: now },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
            },
            orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
          },
          calculatedRules: {
            where: {
              status: "ACTIVE",
              effectiveFrom: { lte: now },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
            },
          },
        },
      },
      specimenLinks: {
        where: { status: "ACTIVE" },
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
          technicalReviewedBy: true,
          medicallyValidatedBy: true,
          validationReviews: {
            include: { reviewer: true },
            orderBy: { reviewedAt: "asc" },
          },
          releasedBy: true,
          amendedFrom: true,
          deltaReviewEvents: {
            include: {
              acknowledgedBy: true,
              deltaRule: true,
            },
            orderBy: { detectedAt: "asc" },
          },
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
          repeatEvents: {
            include: { requestedBy: true },
            orderBy: { requestedAt: "desc" },
          },
          specimen: { include: { currentBranch: true, specimenType: true, container: true } },
        },
      },
    },
  });

  if (!item || !canAccessDepartment(session, item.test.departmentId)) notFound();

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
    select: { id: true, code: true, nameEn: true, nameAr: true, textEn: true, textAr: true, scope: true, testId: true, componentId: true },
    orderBy: { nameEn: "asc" },
  });
  const readySpecimen = latestResult?.specimen
    || item.specimenLinks.map(link => link.specimen).find(specimen =>
      ["RECEIVED","IN_PROCESS"].includes(specimen.status) &&
      specimen.currentBranchId &&
      branchIds.includes(specimen.currentBranchId)
    );

  if (!readySpecimen || !readySpecimen.currentBranchId || !branchIds.includes(readySpecimen.currentBranchId)) {
    return <main className="catalog-shell result-workspace">
      <header className="page-header">
        <div><p className="eyebrow">{tr(locale, "Result Entry", "إدخال النتائج")}</p><h1>{item.testCodeSnapshot} — {item.testNameEnSnapshot}</h1></div>
        <Link className="secondary-link" href="/worklists">{tr(locale, "Back to Worklists", "العودة لقوائم العمل")}</Link>
      </header>
      <section className="detail-card">
        <h2>{tr(locale, "Specimen not ready", "العينة غير جاهزة")}</h2>
        <p className="muted">{tr(locale, "A received specimen at one of your authorized branches is required before manual result entry.", "يجب استلام العينة في أحد الفروع المصرح لك بها قبل إدخال النتيجة يدويًا.")}</p>
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
        resultSectionId: component.resultSectionId,
        entryWidth: component.entryWidth,
        entryHintEn: component.entryHintEn,
        entryHintAr: component.entryHintAr,
        qualitativeOptions: component.qualitativeResultOptions,
      }))
    : [{
        componentId: null,
        code: item.test.code,
        nameEn: item.test.nameEn,
        nameAr: item.test.nameAr,
        resultType: item.test.resultType,
        unit: item.test.defaultUnit?.symbol || null,
        resultSectionId: null,
        entryWidth: "AUTO" as const,
        entryHintEn: null,
        entryHintAr: null,
        qualitativeOptions: item.test.qualitativeResultOptions,
      }];

  const fields = await Promise.all(componentDefinitions.map(async component => {
    const existing = existingByCode.get(component.code);
    const interval = existing || !component.componentId ? null : await resolveReferenceInterval(prisma, {
      componentId: component.componentId,
      branchId: latestResult?.performingBranchId || readySpecimen.currentBranchId!,
      methodId: item.test.methodId,
      // Reference context is frozen at order registration. Later patient edits
      // must never silently change the clinical interpretation shown here.
      patientSex: referencePatientSex(item.order.patientSexSnapshot),
      dateOfBirth: item.order.patientDobSnapshot,
      recordedAgeValue: item.order.patientAgeValueSnapshot,
      recordedAgeUnit: item.order.patientAgeUnitSnapshot,
      recordedAgeAt: item.order.patientAgeRecordedAtSnapshot,
      ageAsOf: item.order.orderedAt,
      // Reference policy effective date must match result entry (today),
      // while patient sex and age remain frozen at the original order.
      at: now,
      pregnancyStatus: item.order.pregnancyStatus,
      gestationalAgeWeeks: item.order.gestationalAgeWeeks,
      analyzerId: latestResult?.analyzerId || null,
      specimenTypeId: readySpecimen.specimenTypeId,
      populationCode: item.order.referencePopulationCode,
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
      currentComment: existing?.comments || "",
      currentOptionId: existing?.qualitativeOptionId || null,
      qualitativeOptions: component.qualitativeOptions.map(option => ({
        id: option.id,
        code: option.code,
        valueEn: option.valueEn,
        valueAr: option.valueAr,
        flag: option.flag,
        isAbnormal: option.isAbnormal,
        isCritical: option.isCritical,
      })),
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
        <p className="eyebrow">{latestResult?.source === "ANALYZER" ? "Analyzer Result Review" : "Manual Result Entry"}</p>
        <h1>{item.testCodeSnapshot} — {item.testNameEnSnapshot}</h1>
        <p className="muted">{item.order.accessionNumber} · {item.order.patient.patientNumber} · {item.order.patient.fullNameEn}</p>
      </div>
      <Link className="secondary-link" href="/worklists">{tr(locale, "Back to Worklists", "العودة لقوائم العمل")}</Link>
    </header>

    <section className="result-context-strip">
      <div><span>{tr(locale, "Accession", "رقم الطلب")}</span><strong>{item.order.accessionNumber}</strong></div>
      <div><span>{tr(locale, "Patient", "المريض")}</span><strong>{item.order.patient.patientNumber}</strong><small>{locale === "ar" ? item.order.patient.fullNameAr || item.order.patient.fullNameEn : item.order.patient.fullNameEn}</small></div>
      <div><span>{tr(locale, "Specimen", "العينة")}</span><strong className="barcode-text">{readySpecimen.barcode}</strong><small>{statusLabel(locale, readySpecimen.status)}</small></div>
      <div><span>{tr(locale, "Priority", "الأولوية")}</span><strong className={"status-badge priority-" + item.order.priority.toLowerCase()}>{tr(locale, item.order.priority, item.order.priority === "STAT" ? "فوري" : item.order.priority === "URGENT" ? "عاجل" : "عادي")}</strong></div>
      <div><span>{tr(locale, "Result", "النتيجة")}</span><strong className={"status-badge status-" + (latestResult?.status || "DRAFT").toLowerCase().replaceAll("_","-")}>{latestResult?.status || "DRAFT"}</strong></div>
    </section>

    <section className="detail-grid result-context-cards">
      <article className="detail-card">
        <h2>{tr(locale, "Patient & Order", "المريض والطلب")}</h2>
        <dl>
          <dt>{tr(locale, "Patient", "المريض")}</dt><dd>{item.order.patient.fullNameEn}</dd>
          <dt>{tr(locale, "Date of birth", "تاريخ الميلاد")}</dt><dd>{item.order.patient.dateOfBirth?.toISOString().slice(0,10) || "—"}</dd>
          <dt>{tr(locale, "Sex at birth", "الجنس عند الولادة")}</dt><dd>{sexLabel(locale, item.order.patient.sexAtBirth)}</dd>
          <dt>{tr(locale, "Priority", "الأولوية")}</dt><dd>{tr(locale, item.order.priority, item.order.priority === "STAT" ? "فوري" : item.order.priority === "URGENT" ? "عاجل" : "عادي")}</dd>
          <dt>{tr(locale, "Department", "القسم")}</dt><dd>{locale === "ar" ? item.test.department?.nameAr || item.test.department?.nameEn || tr(locale, "Unassigned", "غير معين") : item.test.department?.nameEn || "Unassigned"}</dd>
          <dt>{tr(locale, "Method", "الطريقة")}</dt><dd>{item.test.method?.nameEn || "Not configured"}</dd>
        </dl>
      </article>
      <article className="detail-card">
        <h2>{tr(locale, "Specimen", "العينة")}</h2>
        <dl>
          <dt>{tr(locale, "Barcode", "الباركود")}</dt><dd><strong>{readySpecimen.barcode}</strong></dd>
          <dt>{tr(locale, "Type", "النوع")}</dt><dd>{readySpecimen.specimenType?.nameEn || "—"}</dd>
          <dt>{tr(locale, "Container", "الحاوية")}</dt><dd>{readySpecimen.container?.nameEn || "—"}</dd>
          <dt>{tr(locale, "Status", "الحالة")}</dt><dd>{statusLabel(locale, readySpecimen.status)}</dd>
          <dt>{tr(locale, "Location", "الموقع")}</dt><dd>{readySpecimen.currentBranch?.nameEn || latestResult?.performingBranch.nameEn || "—"}</dd>
        </dl>
      </article>
    </section>

    <section className="detail-card detail-section result-entry-surface">
      <div className="section-title-row"><div><p className="eyebrow">{tr(locale, "Analytical workflow", "المسار التحليلي")}</p><h2>{tr(locale, "Result Values", "قيم النتائج")}</h2></div><span className="keyboard-hint">{tr(locale, "Enter values → review flags → verify", "أدخل القيم ← راجع العلامات ← تحقق")}</span></div>
      <p className="muted">{tr(locale, "Reference intervals are matched by effective date and configured clinical context, including branch, method, analyzer, specimen, sex, age, pregnancy and population. The matched values are snapshotted with the result.", "تُطابق المجالات المرجعية حسب تاريخ السريان والسياق السريري المهيأ، بما يشمل الفرع والطريقة والجهاز والعينة والجنس والعمر والحمل والمجموعة المرجعية، وتُحفظ القيم المستخدمة تاريخيًا مع النتيجة.")}</p>
      <ResultEntryForm
        orderItemId={item.id}
        testId={item.testId}
        specimenId={readySpecimen.id}
        performingBranchId={latestResult?.performingBranchId || readySpecimen.currentBranchId}
        fields={fields}
        resultEntryLayout={item.test.resultEntryLayout}
        resultSections={item.test.resultSections.map(section => ({
          id: section.id,
          code: section.code,
          nameEn: section.nameEn,
          nameAr: section.nameAr,
          columnCount: section.columnCount,
          hintEn: section.hintEn,
          hintAr: section.hintAr,
        }))}
        comments={latestResult?.comments || ""}
        resultId={latestResult?.id || null}
        resultStatus={latestResult?.status || null}
        resultSource={latestResult?.source || "MANUAL"}
        analyzerLabel={latestResult?.analyzerCodeSnapshot
          ? latestResult.analyzerCodeSnapshot + (latestResult.analyzerNameSnapshot ? " — " + latestResult.analyzerNameSnapshot : "")
          : null}
        validationStage={latestResult?.validationStage || "ENTRY"}
        canEnter={permissions.has("results.enter")}
        canTechnicalReview={permissions.has("results.technical_review")}
        commentTemplates={commentTemplates}
        locale={locale}
      />

      {latestResult && <ResultRepeatPanel
        resultId={latestResult.id}
        locale={locale}
        events={latestResult.repeatEvents.map(event => ({
          id: event.id,
          type: event.type,
          reason: event.reason,
          requestedAt: event.requestedAt.toISOString(),
          requestedBy: event.requestedBy.displayNameEn,
        }))}
      />}

      {latestResult && <ReflexReviewPanel
        resultId={latestResult.id}
        canReview={permissions.has("reflex.review")}
        locale={locale}
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
        locale={locale}
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

    {latestResult && latestResult.deltaReviewEvents.length > 0 && <section className="detail-card detail-section">
      <div className="table-toolbar">
        <div>
          <h2>{tr(locale, "Delta Review Evidence", "سجل مراجعة Delta")}</h2>
          <p className="muted">{tr(
            locale,
            "Delta alerts preserve the exact prior value, configured limits and reviewer acknowledgement used for this result.",
            "تحفظ تنبيهات Delta القيمة السابقة والحدود المهيأة وإقرار المراجع المستخدمة لهذه النتيجة بشكل تاريخي."
          )}</p>
        </div>
        <span>{latestResult.deltaReviewEvents.length} {tr(locale, "event(s)", "حدث")}</span>
      </div>
      <div className="table-wrap"><table>
        <thead><tr>
          <th>{tr(locale, "Component", "المكوّن")}</th>
          <th>{tr(locale, "Current", "الحالية")}</th>
          <th>{tr(locale, "Previous", "السابقة")}</th>
          <th>{tr(locale, "Delta", "الفرق")}</th>
          <th>{tr(locale, "Configured limit", "الحد المهيأ")}</th>
          <th>{tr(locale, "Status", "الحالة")}</th>
          <th>{tr(locale, "Reviewer", "المراجع")}</th>
        </tr></thead>
        <tbody>{latestResult.deltaReviewEvents.map(event => <tr key={event.id}>
          <td><strong>{event.componentCodeSnapshot}</strong><br/><small>{locale === "ar" ? event.componentNameArSnapshot || event.componentNameEnSnapshot : event.componentNameEnSnapshot}</small></td>
          <td>{event.currentValueSnapshot.toString()}</td>
          <td>{event.previousValueSnapshot?.toString() || "—"}{event.previousResultAtSnapshot ? <><br/><small>{event.previousResultAtSnapshot.toISOString().slice(0,10)}</small></> : null}</td>
          <td>{[
            event.deltaAbsoluteSnapshot !== null ? "Δ " + event.deltaAbsoluteSnapshot.toString() : null,
            event.deltaPercentSnapshot !== null ? event.deltaPercentSnapshot.toString() + "%" : null,
          ].filter(Boolean).join(" · ") || "—"}</td>
          <td>{[
            event.absoluteLimitSnapshot !== null ? tr(locale, "Abs", "مطلق") + " " + event.absoluteLimitSnapshot.toString() : null,
            event.percentLimitSnapshot !== null ? event.percentLimitSnapshot.toString() + "%" : null,
            event.lookbackDaysSnapshot !== null ? event.lookbackDaysSnapshot + " " + tr(locale, "days", "يوم") : null,
          ].filter(Boolean).join(" · ") || tr(locale, "Legacy snapshot", "لقطة تاريخية قديمة")}</td>
          <td>{statusLabel(locale, event.status)}</td>
          <td>{event.acknowledgedBy
            ? (locale === "ar" ? event.acknowledgedBy.displayNameAr || event.acknowledgedBy.displayNameEn : event.acknowledgedBy.displayNameEn)
              + (event.acknowledgedAt ? " · " + event.acknowledgedAt.toISOString().replace("T"," ").slice(0,19) : "")
            : "—"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    {latestResult && <section className="detail-card detail-section">
      <h2>{tr(locale, "Validation, Release & Amendment", "التحقق والإصدار والتعديل")}</h2>
      <ResultWorkflowActions
        resultId={latestResult.id}
        resultStatus={latestResult.status}
        validationStage={latestResult.validationStage}
        validationPolicySnapshot={latestResult.validationPolicySnapshot}
        technicalReviewer={latestResult.technicalReviewedBy ? {
          id: latestResult.technicalReviewedBy.id,
          nameEn: latestResult.technicalReviewedBy.displayNameEn,
          nameAr: latestResult.technicalReviewedBy.displayNameAr,
          reviewedAt: latestResult.technicalReviewedAt?.toISOString() || null,
        } : null}
        medicalValidator={latestResult.medicallyValidatedBy ? {
          id: latestResult.medicallyValidatedBy.id,
          nameEn: latestResult.medicallyValidatedBy.displayNameEn,
          nameAr: latestResult.medicallyValidatedBy.displayNameAr,
          reviewedAt: latestResult.medicallyValidatedAt?.toISOString() || null,
        } : null}
        validationReviews={latestResult.validationReviews.map(review => ({
          id: review.id,
          stage: review.stage,
          outcome: review.outcome,
          automated: review.automated,
          reviewerNameEn: review.reviewer?.displayNameEn || null,
          reviewerNameAr: review.reviewer?.displayNameAr || null,
          reviewedAt: review.reviewedAt.toISOString(),
          notes: review.notes,
        }))}
        criticalCount={latestResult.values.filter(value => value.isCritical).length}
        criticalEventStatus={latestResult.criticalEvents[0]?.status || null}
        criticalAcknowledgementDueAt={latestResult.criticalEvents[0]?.acknowledgementDueAt?.toISOString() || null}
        criticalEscalationLevel={latestResult.criticalEvents[0]?.escalationLevel || 0}
        criticalMaxEscalationLevel={latestResult.criticalEvents[0]?.maxEscalationLevelSnapshot ?? null}
        criticalNextEscalationDueAt={latestResult.criticalEvents[0]?.nextEscalationDueAt?.toISOString() || null}
        criticalRequireReadBack={latestResult.criticalEvents[0]?.requireReadBackSnapshot || false}
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
        canMedicalValidate={permissions.has("results.medical_validate")}
        canRelease={permissions.has("results.release")}
        canAmend={permissions.has("results.amend")}
        locale={locale}
      />
      {permissions.has("reports.view") && <p><Link className="secondary-link" href={`/reports/${item.orderId}`}>{tr(locale, "Open Diagnostic Report", "فتح التقرير التشخيصي")}</Link></p>}
    </section>}

    {latestResult && <section className="detail-card detail-section">
      <h2>{tr(locale, "Result Audit Context", "سياق تدقيق النتيجة")}</h2>
      <dl>
        <dt>{tr(locale, "Version", "الإصدار")}</dt><dd>{latestResult.version}</dd>
        <dt>{tr(locale, "Source", "المصدر")}</dt><dd>{latestResult.source}{latestResult.analyzerCodeSnapshot ? " · " + latestResult.analyzerCodeSnapshot + (latestResult.analyzerNameSnapshot ? " — " + latestResult.analyzerNameSnapshot : "") : ""}</dd>
        <dt>{tr(locale, "Entered by", "أُدخل بواسطة")}</dt><dd>{latestResult.enteredBy.displayNameEn}</dd>
        <dt>{tr(locale, "Entered at", "وقت الإدخال")}</dt><dd>{latestResult.enteredAt.toISOString().replace("T"," ").slice(0,19)}</dd>
        <dt>{tr(locale, "Verification mode", "طريقة التحقق")}</dt><dd>{latestResult.autoVerified ? "AUTOVERIFICATION" : "MANUAL"}</dd>
        <dt>{tr(locale, "Verified by", "تم التحقق بواسطة")}</dt><dd>{latestResult.autoVerified ? tr(locale, "System policy", "سياسة النظام") : latestResult.verifiedBy?.displayNameEn || "—"}</dd>
        <dt>{tr(locale, "Verified at", "وقت التحقق")}</dt><dd>{latestResult.verifiedAt?.toISOString().replace("T"," ").slice(0,19) || "—"}</dd>
        <dt>{tr(locale, "Released by", "تم الإصدار بواسطة")}</dt><dd>{latestResult.releasedBy?.displayNameEn || "—"}</dd>
        <dt>{tr(locale, "Released at", "وقت الإصدار")}</dt><dd>{latestResult.releasedAt?.toISOString().replace("T"," ").slice(0,19) || "—"}</dd>
        <dt>{tr(locale, "Version", "الإصدار")}</dt><dd>{latestResult.version}{latestResult.amendedFromId ? " · " + tr(locale, "amendment", "تعديل") : ""}</dd>
        <dt>{tr(locale, "Amendment reason", "سبب التعديل")}</dt><dd>{latestResult.amendmentReason || "—"}</dd>
      </dl>
    </section>}
  </main>;
}
