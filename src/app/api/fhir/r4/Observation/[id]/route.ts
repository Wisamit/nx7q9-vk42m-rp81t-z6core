import { NextResponse } from "next/server";
import { IntegrationAuthError, requireIntegrationApiKey } from "@/lib/integration-auth";
import { observationResource, operationOutcome } from "@/lib/fhir-r4";
import { resolvePrimaryTerminologyMapping } from "@/lib/terminology";
import { prisma } from "@/lib/db";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireIntegrationApiKey(request, "fhir.read");
    if (!["FHIR_R4", "REST"].includes(auth.endpoint.endpointType) ||
        !["OUTBOUND", "BIDIRECTIONAL"].includes(auth.endpoint.direction)) {
      return NextResponse.json(operationOutcome("forbidden", "FHIR endpoint not authorized for outbound reads"), { status: 403 });
    }
    const { id } = await params;
    const value = await prisma.laboratoryResultValue.findFirst({
      where: {
        id,
        result: {
          organizationId: auth.organizationId,
          status: { in: ["RELEASED", "AMENDED"] },
          releasedAt: { not: null },
          ...(auth.endpoint.branchId ? {
            OR: [
              { performingBranchId: auth.endpoint.branchId },
              { orderItem: { order: { orderingBranchId: auth.endpoint.branchId } } },
            ],
          } : {}),
        },
      },
      include: { result: { include: { orderItem: { include: { order: true } } } } },
    });
    if (!value) return NextResponse.json(operationOutcome("not-found","Observation not found"), { status: 404 });
    const result = value.result;
    // Observations are returned only from the current non-retracted diagnostic
    // report snapshot. A draft/verified value or superseded result can never
    // appear as a newly final FHIR Observation.
    const report = await prisma.diagnosticReport.findUnique({
      where: { orderId: result.orderItem.orderId },
      select: { id: true, currentVersion: true },
    });
    const currentVersion = report && report.currentVersion > 0
      ? await prisma.diagnosticReportVersion.findUnique({
          where: { reportId_version: { reportId: report.id, version: report.currentVersion } },
          select: { status: true, contentSnapshot: true, branchId: true },
        })
      : null;
    const contents = currentVersion?.contentSnapshot as { results?: Array<{ resultId?: string }> } | null;
    if (!currentVersion || currentVersion.status === "RETRACTED" ||
        (auth.endpoint.branchId && currentVersion.branchId !== auth.endpoint.branchId &&
          result.performingBranchId !== auth.endpoint.branchId) ||
        !contents?.results?.some(item => item.resultId === result.id)) {
      return NextResponse.json(operationOutcome("not-found", "Current released Observation not found"), { status: 404 });
    }
    const asOf = result.releasedAt!;
    const mapping = await resolvePrimaryTerminologyMapping({
      organizationId: auth.organizationId,
      testId: result.orderItem.testId,
      componentId: value.componentId,
      asOf,
    });
    return NextResponse.json(observationResource({
      valueId: value.id,
      resultId: result.id,
      status: result.status,
      patientId: result.orderItem.order.patientId,
      serviceRequestId: result.orderItemId,
      releasedAt: result.releasedAt,
      enteredAt: result.enteredAt,
      componentCode: value.componentCodeSnapshot,
      componentName: value.componentNameEnSnapshot,
      mapping,
      displayValue: value.displayValue,
      valueNumeric: value.valueNumeric?.toString() || null,
      valueBoolean: value.valueBoolean,
      valueDate: value.valueDate,
      unit: value.unitSnapshot,
      flag: value.flag,
      referenceLow: value.referenceLowSnapshot?.toString() || null,
      referenceHigh: value.referenceHighSnapshot?.toString() || null,
      referenceText: value.referenceTextEnSnapshot,
    }), { headers: { "content-type": "application/fhir+json" } });
  } catch (error) {
    if (error instanceof IntegrationAuthError) return NextResponse.json(operationOutcome("security", error.code), { status: error.status });
    return NextResponse.json(operationOutcome("exception","FHIR observation request failed"), { status: 500 });
  }
}
