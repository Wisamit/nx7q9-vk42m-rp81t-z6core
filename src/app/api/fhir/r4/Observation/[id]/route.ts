import { NextResponse } from "next/server";
import { IntegrationAuthError, requireIntegrationApiKey } from "@/lib/integration-auth";
import { observationResource, operationOutcome } from "@/lib/fhir-r4";
import { resolvePrimaryTerminologyMapping } from "@/lib/terminology";
import { prisma } from "@/lib/db";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireIntegrationApiKey(request, "fhir.read");
    const { id } = await params;
    const value = await prisma.laboratoryResultValue.findFirst({
      where: {
        id,
        result: {
          organizationId: auth.organizationId,
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
    const asOf = result.releasedAt || result.verifiedAt || result.enteredAt;
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
