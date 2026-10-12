import type { Prisma } from "../../generated/prisma/client";
import { compareReportPresentation, reportValueVisible } from "@/lib/report-presentation";

export async function buildDiagnosticReportSnapshot(db: Prisma.TransactionClient, orderId: string) {
  const order = await db.labOrder.findUnique({
    where: { id: orderId },
    include: {
      organization: true,
      orderingBranch: true,
      patient: true,
      referrer: true,
      client: true,
      interpretiveComments: {
        where: { status: "APPROVED" },
        orderBy: { revisionNumber: "desc" },
        take: 1,
        select: { id: true, revisionNumber: true, textEn: true, textAr: true,
          approvedAt: true, approvedByUserId: true },
      },
      items: {
        where: { status: { not: "CANCELLED" } },
        orderBy: { createdAt: "asc" },
        include: {
          test: true,
          specimenLinks: {
            include: { specimen: true },
            orderBy: { createdAt: "asc" },
          },
          results: {
            where: { status: "RELEASED" },
            orderBy: { version: "desc" },
            take: 1,
            include: {
              values: { orderBy: { componentCodeSnapshot: "asc" } },
              performingBranch: true,
              verifiedBy: true,
              technicalReviewedBy: true,
              medicallyValidatedBy: true,
              releasedBy: true,
            },
          },
        },
      },
    },
  });

  if (!order) throw new Error("ORDER_NOT_FOUND_FOR_REPORT");

  const releasedItems = order.items
    .map((item) => ({ item, result: item.results[0] || null }))
    .filter((entry) => entry.result !== null);

  const allReleased = order.items.length > 0 && releasedItems.length === order.items.length;

  const results = releasedItems.map(({ item, result }) => {
    const specimen = item.specimenLinks.map((link) => link.specimen).find((candidate) =>
      ["COLLECTED","RECEIVED","IN_PROCESS","DISPOSED"].includes(candidate.status)
    ) || item.specimenLinks[0]?.specimen || null;

    return {
      orderItemId: item.id,
      testId: item.testId,
      testCode: item.testCodeSnapshot,
      testNameEn: item.testNameEnSnapshot,
      testNameAr: item.testNameArSnapshot,
      resultId: result!.id,
      resultVersion: result!.version,
      resultStatus: result!.status,
      source: result!.source,
      methodId: result!.methodId,
      analyzer: result!.analyzerCodeSnapshot ? {
        id: result!.analyzerId,
        code: result!.analyzerCodeSnapshot,
        name: result!.analyzerNameSnapshot,
      } : null,
      performingBranch: {
        id: result!.performingBranch.id,
        code: result!.performingBranch.code,
        nameEn: result!.performingBranch.nameEn,
        nameAr: result!.performingBranch.nameAr,
      },
      specimen: specimen ? {
        barcode: specimen.barcode,
        collectedAt: specimen.collectedAt?.toISOString() || null,
        receivedAt: specimen.receivedAt?.toISOString() || null,
      } : null,
      values: result!.values
        .filter((value) => reportValueVisible({ reportVisible: value.reportVisibleSnapshot }))
        .sort((left, right) => compareReportPresentation(
          {
            componentCode: left.componentCodeSnapshot,
            reportDisplayOrder: left.reportDisplayOrderSnapshot,
            reportVisible: left.reportVisibleSnapshot,
            reportSectionCode: left.reportSectionCodeSnapshot,
            reportSectionOrder: left.reportSectionOrderSnapshot,
          },
          {
            componentCode: right.componentCodeSnapshot,
            reportDisplayOrder: right.reportDisplayOrderSnapshot,
            reportVisible: right.reportVisibleSnapshot,
            reportSectionCode: right.reportSectionCodeSnapshot,
            reportSectionOrder: right.reportSectionOrderSnapshot,
          },
        ))
        .map((value) => ({
          componentId: value.componentId,
          componentCode: value.componentCodeSnapshot,
          componentNameEn: value.reportNameEnSnapshot || value.componentNameEnSnapshot,
          componentNameAr: value.reportNameArSnapshot || value.componentNameArSnapshot,
          originalComponentNameEn: value.componentNameEnSnapshot,
          originalComponentNameAr: value.componentNameArSnapshot,
          reportDisplayOrder: value.reportDisplayOrderSnapshot,
          reportSectionCode: value.reportSectionCodeSnapshot,
          reportSectionNameEn: value.reportSectionNameEnSnapshot,
          reportSectionNameAr: value.reportSectionNameArSnapshot,
          reportSectionOrder: value.reportSectionOrderSnapshot,
          displayValue: value.displayValue,
          unit: value.unitSnapshot,
          flag: value.flag,
          flagSource: value.flagSource,
          isAbnormal: value.isAbnormal,
          isCritical: value.isCritical,
          qualitativeOptionCode: value.qualitativeOptionCodeSnapshot,
          valueTextEn: value.valueTextEnSnapshot,
          valueTextAr: value.valueTextArSnapshot,
          comments: value.comments,
          referenceLow: value.referenceLowSnapshot?.toString() || null,
          referenceHigh: value.referenceHighSnapshot?.toString() || null,
          referenceTextEn: value.referenceTextEnSnapshot,
          referenceTextAr: value.referenceTextArSnapshot,
        })),
      comments: result!.comments,
      microbiology: result!.microbiologySnapshot,
      validationStage: result!.validationStage,
      validationPolicySnapshot: result!.validationPolicySnapshot,
      technicalReviewedBy: result!.technicalReviewedBy ? {
        id: result!.technicalReviewedBy.id,
        nameEn: result!.technicalReviewedBy.displayNameEn,
        nameAr: result!.technicalReviewedBy.displayNameAr,
      } : null,
      technicalReviewedAt: result!.technicalReviewedAt?.toISOString() || null,
      medicallyValidatedBy: result!.medicallyValidatedBy ? {
        id: result!.medicallyValidatedBy.id,
        nameEn: result!.medicallyValidatedBy.displayNameEn,
        nameAr: result!.medicallyValidatedBy.displayNameAr,
      } : null,
      medicallyValidatedAt: result!.medicallyValidatedAt?.toISOString() || null,
      verifiedBy: result!.verifiedBy ? {
        id: result!.verifiedBy.id,
        nameEn: result!.verifiedBy.displayNameEn,
        nameAr: result!.verifiedBy.displayNameAr,
      } : null,
      verifiedAt: result!.verifiedAt?.toISOString() || null,
      releasedBy: result!.releasedBy ? {
        id: result!.releasedBy.id,
        nameEn: result!.releasedBy.displayNameEn,
        nameAr: result!.releasedBy.displayNameAr,
      } : null,
      releasedAt: result!.releasedAt?.toISOString() || null,
      amendedFromResultId: result!.amendedFromId,
      amendmentReason: result!.amendmentReason,
    };
  });

  return {
    allReleased,
    resultVersionSnapshot: results.map((result) => ({
      orderItemId: result.orderItemId,
      resultId: result.resultId,
      resultVersion: result.resultVersion,
    })),
    contentSnapshot: {
      organization: {
        id: order.organization.id,
        code: order.organization.code,
        nameEn: order.organization.nameEn,
        nameAr: order.organization.nameAr,
        legalName: order.organization.legalName,
      },
      branch: {
        id: order.orderingBranch.id,
        code: order.orderingBranch.code,
        nameEn: order.orderingBranch.nameEn,
        nameAr: order.orderingBranch.nameAr,
        phone: order.orderingBranch.phone,
        email: order.orderingBranch.email,
        addressEn: order.orderingBranch.addressEn,
        addressAr: order.orderingBranch.addressAr,
      },
      patient: {
        id: order.patient.id,
        patientNumber: order.patient.patientNumber,
        fullNameEn: order.patient.fullNameEn,
        fullNameAr: order.patient.fullNameAr,
        // Clinical reference interpretation is based on demographics frozen
        // at order registration, never on edits to the central patient master.
        dateOfBirth: order.patientDobSnapshot?.toISOString().slice(0, 10) || null,
        sexAtBirth: order.patientSexSnapshot || "UNKNOWN",
        ageValueAtOrder: order.patientAgeValueSnapshot,
        ageUnitAtOrder: order.patientAgeUnitSnapshot,
        ageRecordedAtOrder: order.patientAgeRecordedAtSnapshot?.toISOString() || null,
      },
      order: {
        id: order.id,
        accessionNumber: order.accessionNumber,
        priority: order.priority,
        orderedAt: order.orderedAt.toISOString(),
        diagnosis: order.diagnosis,
        clinicalNotes: order.clinicalNotes,
      },
      // This is a point-in-time copy. Later review decisions never mutate
      // already-issued report versions or their verification tokens.
      reportInterpretation: order.interpretiveComments[0] ? {
        id: order.interpretiveComments[0].id,
        revisionNumber: order.interpretiveComments[0].revisionNumber,
        textEn: order.interpretiveComments[0].textEn,
        textAr: order.interpretiveComments[0].textAr,
        approvedAt: order.interpretiveComments[0].approvedAt?.toISOString() ?? null,
        approvedByUserId: order.interpretiveComments[0].approvedByUserId,
      } : null,
      referrer: order.referrer ? {
        id: order.referrer.id,
        code: order.referrer.code,
        nameEn: order.referrer.nameEn,
        nameAr: order.referrer.nameAr,
      } : null,
      client: order.client ? {
        id: order.client.id,
        code: order.client.code,
        nameEn: order.client.nameEn,
        nameAr: order.client.nameAr,
      } : null,
      results,
      completeness: {
        releasedItemCount: releasedItems.length,
        totalItemCount: order.items.length,
        final: allReleased,
      },
    },
  };
}
