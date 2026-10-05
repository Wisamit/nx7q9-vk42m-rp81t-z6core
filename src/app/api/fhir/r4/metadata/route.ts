import { NextResponse } from "next/server";
import { IntegrationAuthError, requireIntegrationApiKey } from "@/lib/integration-auth";
import { operationOutcome } from "@/lib/fhir-r4";

export async function GET(request: Request) {
  try {
    await requireIntegrationApiKey(request, "fhir.read");
    return NextResponse.json({
      resourceType: "CapabilityStatement",
      status: "active",
      date: new Date().toISOString(),
      kind: "instance",
      fhirVersion: "4.0.1",
      format: ["application/fhir+json","json"],
      rest: [{
        mode: "server",
        resource: [
          { type: "Patient", interaction: [{ code: "read" }] },
          { type: "ServiceRequest", interaction: [{ code: "read" }] },
          { type: "Observation", interaction: [{ code: "read" }] },
          { type: "DiagnosticReport", interaction: [{ code: "read" }] },
        ],
        security: {
          cors: false,
          description: "Scoped Family Lab integration API key required.",
        },
      }],
    }, { headers: { "content-type": "application/fhir+json" } });
  } catch (error) {
    if (error instanceof IntegrationAuthError) {
      return NextResponse.json(operationOutcome("security", error.code), { status: error.status });
    }
    return NextResponse.json(operationOutcome("exception","CapabilityStatement request failed"), { status: 500 });
  }
}
