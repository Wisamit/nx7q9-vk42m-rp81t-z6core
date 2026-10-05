import { NextResponse } from "next/server";
import { IntegrationAuthError, requireIntegrationApiKey } from "@/lib/integration-auth";
import { operationOutcome } from "@/lib/fhir-r4";
import { prisma } from "@/lib/db";

type Snapshot = {
  patient?: { id?: string };
  order?: { accessionNumber?: string };
  results?: Array<{
    orderItemId: string;
    resultId: string;
    testCode: string;
    testNameEn: string;
    releasedAt: string | null;
    values: Array<{
      componentCode: string;
      componentNameEn: string;
      displayValue: string;
      unit: string | null;
      flag: string;
      referenceLow: string | null;
      referenceHigh: string | null;
      referenceTextEn: string | null;
    }>;
  }>;
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireIntegrationApiKey(request, "fhir.read");
    const { id } = await params;
    const version = await prisma.diagnosticReportVersion.findFirst({
      where: {
        id,
        report: { organizationId: auth.organizationId },
        ...(auth.endpoint.branchId ? { branchId: auth.endpoint.branchId } : {}),
      },
    });
    if (!version) return NextResponse.json(operationOutcome("not-found","DiagnosticReport not found"), { status: 404 });

    const snapshot = version.contentSnapshot as unknown as Snapshot;
    const contained: Array<Record<string, unknown>> = [];
    const resultRefs: Array<{ reference: string }> = [];
    for (const result of snapshot.results || []) {
      result.values.forEach((value, index) => {
        const observationId = `obs-${result.resultId}-${index + 1}`;
        contained.push({
          resourceType: "Observation",
          id: observationId,
          status: "final",
          code: { coding: [{ system: "urn:family-lab:local", code: value.componentCode, display: value.componentNameEn }], text: value.componentNameEn },
          subject: snapshot.patient?.id ? { reference: `Patient/${snapshot.patient.id}` } : undefined,
          basedOn: [{ reference: `ServiceRequest/${result.orderItemId}` }],
          effectiveDateTime: result.releasedAt || version.issuedAt.toISOString(),
          valueString: value.displayValue,
          interpretation: value.flag === "NORMAL" || value.flag === "UNKNOWN" ? undefined : [{ text: value.flag }],
          referenceRange: value.referenceLow || value.referenceHigh || value.referenceTextEn ? [{
            low: value.referenceLow ? { value: Number(value.referenceLow), unit: value.unit || undefined } : undefined,
            high: value.referenceHigh ? { value: Number(value.referenceHigh), unit: value.unit || undefined } : undefined,
            text: value.referenceTextEn || undefined,
          }] : undefined,
        });
        resultRefs.push({ reference: `#${observationId}` });
      });
    }

    const resource = {
      resourceType: "DiagnosticReport",
      id: version.id,
      contained,
      identifier: snapshot.order?.accessionNumber ? [{ system: "urn:family-lab:accession", value: snapshot.order.accessionNumber }] : undefined,
      status: version.status === "RETRACTED" ? "entered-in-error" : version.status === "PARTIAL" ? "partial" : version.status === "AMENDED" ? "amended" : "final",
      category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0074", code: "LAB", display: "Laboratory" }] }],
      subject: snapshot.patient?.id ? { reference: `Patient/${snapshot.patient.id}` } : undefined,
      issued: version.issuedAt.toISOString(),
      result: resultRefs,
    };
    return NextResponse.json(resource, { headers: { "content-type": "application/fhir+json" } });
  } catch (error) {
    if (error instanceof IntegrationAuthError) return NextResponse.json(operationOutcome("security", error.code), { status: error.status });
    return NextResponse.json(operationOutcome("exception","FHIR diagnostic report request failed"), { status: 500 });
  }
}
