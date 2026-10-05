import { NextResponse } from "next/server";
import { IntegrationAuthError, requireIntegrationApiKey } from "@/lib/integration-auth";
import { operationOutcome, patientResource } from "@/lib/fhir-r4";
import { prisma } from "@/lib/db";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireIntegrationApiKey(request, "fhir.read");
    const { id } = await params;
    const patient = await prisma.patient.findFirst({
      where: {
        id,
        organizationId: auth.organizationId,
        ...(auth.endpoint.branchId ? { orders: { some: { orderingBranchId: auth.endpoint.branchId } } } : {}),
      },
      include: { identifiers: { where: { status: "ACTIVE" } } },
    });
    if (!patient) return NextResponse.json(operationOutcome("not-found","Patient not found"), { status: 404 });
    return NextResponse.json(patientResource(patient), { headers: { "content-type": "application/fhir+json" } });
  } catch (error) {
    if (error instanceof IntegrationAuthError) return NextResponse.json(operationOutcome("security", error.code), { status: error.status });
    return NextResponse.json(operationOutcome("exception","FHIR patient request failed"), { status: 500 });
  }
}
