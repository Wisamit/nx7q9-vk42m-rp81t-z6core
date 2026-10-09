import { NextResponse } from "next/server";
import { IntegrationAuthError, requireIntegrationApiKey } from "@/lib/integration-auth";
import { operationOutcome, serviceRequestResource } from "@/lib/fhir-r4";
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
    const item = await prisma.orderItem.findFirst({
      where: {
        id,
        order: {
          organizationId: auth.organizationId,
          ...(auth.endpoint.branchId ? { orderingBranchId: auth.endpoint.branchId } : {}),
        },
      },
      include: { order: true },
    });
    if (!item) return NextResponse.json(operationOutcome("not-found","ServiceRequest not found"), { status: 404 });
    const mapping = await resolvePrimaryTerminologyMapping({
      organizationId: auth.organizationId,
      testId: item.testId,
      componentId: null,
      asOf: item.order.orderedAt,
    });
    return NextResponse.json(serviceRequestResource({
      itemId: item.id,
      orderId: item.orderId,
      accessionNumber: item.order.accessionNumber,
      patientId: item.order.patientId,
      priority: item.order.priority,
      orderedAt: item.order.orderedAt,
      testCode: item.testCodeSnapshot,
      testName: item.testNameEnSnapshot,
      mapping,
    }), { headers: { "content-type": "application/fhir+json" } });
  } catch (error) {
    if (error instanceof IntegrationAuthError) return NextResponse.json(operationOutcome("security", error.code), { status: error.status });
    return NextResponse.json(operationOutcome("exception","FHIR service request failed"), { status: 500 });
  }
}
