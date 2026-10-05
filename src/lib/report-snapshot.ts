import type { Prisma } from "../../generated/prisma/client";

export async function buildDiagnosticReportSnapshot(db: Prisma.TransactionClient, orderId: string) {
  const order = await db.labOrder.findUnique({
    where: { id: orderId },
    include: {
      organization: true,
      orderingBranch: true,
      patient: true,
      referrer: true,
      client: true,
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
      values: result!.values.map((value) => ({
        componentCode: value.componentCodeSnapshot,
        componentNameEn: value.componentNameEnSnapshot,
        componentNameAr: value.componentNameArSnapshot,
        displayValue: value.displayValue,
        unit: value.unitSnapshot,
        flag: value.flag,
        isCritical: value.isCritical,
        referenceLow: value.referenceLowSnapshot?.toString() || null,
        referenceHigh: value.referenceHighSnapshot?.toString() || null,
        referenceTextEn: value.referenceTextEnSnapshot,
        referenceTextAr: value.referenceTextArSnapshot,
      })),
      comments: result!.comments,
      microbiology: result!.microbiologySnapshot,
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
        dateOfBirth: order.patient.dateOfBirth?.toISOString().slice(0,10) || null,
        sexAtBirth: order.patient.sexAtBirth,
      },
      order: {
        id: order.id,
        accessionNumber: order.accessionNumber,
        priority: order.priority,
        orderedAt: order.orderedAt.toISOString(),
        diagnosis: order.diagnosis,
        clinicalNotes: order.clinicalNotes,
      },
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
