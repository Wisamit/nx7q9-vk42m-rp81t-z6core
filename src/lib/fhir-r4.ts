type Mapping = { system: string; code: string; display: string | null };

function coding(mapping: Mapping | null | undefined, fallbackCode: string, fallbackDisplay: string) {
  if (!mapping) return [{ system: "urn:family-lab:local", code: fallbackCode, display: fallbackDisplay }];
  const systemUri =
    mapping.system === "LOINC" ? "http://loinc.org" :
    mapping.system === "SNOMED_CT" ? "http://snomed.info/sct" :
    mapping.system === "ICD10" ? "http://hl7.org/fhir/sid/icd-10" :
    "urn:family-lab:local";
  return [{ system: systemUri, code: mapping.code, display: mapping.display || fallbackDisplay }];
}

export function operationOutcome(code: string, diagnostics: string) {
  return {
    resourceType: "OperationOutcome",
    issue: [{ severity: "error", code, diagnostics }],
  };
}

export function patientResource(patient: {
  id: string;
  patientNumber: string;
  fullNameEn: string;
  fullNameAr: string | null;
  dateOfBirth: Date | null;
  sexAtBirth: string;
  phone: string | null;
  email: string | null;
  identifiers: Array<{ identifierType: string; value: string; issuingCountry: string | null }>;
}) {
  const telecom = [
    patient.phone ? { system: "phone", value: patient.phone, use: "mobile" } : null,
    patient.email ? { system: "email", value: patient.email } : null,
  ].filter(Boolean);

  return {
    resourceType: "Patient",
    id: patient.id,
    identifier: [
      { system: "urn:family-lab:patient-number", value: patient.patientNumber },
      ...patient.identifiers.map(identifier => ({
        type: { text: identifier.identifierType },
        system: identifier.issuingCountry
          ? `urn:family-lab:identifier:${identifier.issuingCountry.toLowerCase()}`
          : "urn:family-lab:identifier",
        value: identifier.value,
      })),
    ],
    name: [
      { use: "official", text: patient.fullNameEn },
      ...(patient.fullNameAr ? [{ use: "usual", text: patient.fullNameAr }] : []),
    ],
    gender:
      patient.sexAtBirth === "MALE" ? "male" :
      patient.sexAtBirth === "FEMALE" ? "female" : "unknown",
    birthDate: patient.dateOfBirth?.toISOString().slice(0, 10),
    telecom,
  };
}

export function serviceRequestResource(input: {
  itemId: string;
  orderId: string;
  accessionNumber: string;
  patientId: string;
  priority: string;
  orderedAt: Date;
  testCode: string;
  testName: string;
  mapping?: Mapping | null;
}) {
  return {
    resourceType: "ServiceRequest",
    id: input.itemId,
    identifier: [{ system: "urn:family-lab:accession", value: input.accessionNumber }],
    status: "active",
    intent: "order",
    priority: input.priority === "STAT" ? "stat" : input.priority === "URGENT" ? "urgent" : "routine",
    code: { coding: coding(input.mapping, input.testCode, input.testName), text: input.testName },
    subject: { reference: `Patient/${input.patientId}` },
    authoredOn: input.orderedAt.toISOString(),
    requisition: { value: input.orderId },
  };
}

export function observationResource(input: {
  valueId: string;
  resultId: string;
  status: string;
  patientId: string;
  serviceRequestId: string;
  releasedAt: Date | null;
  enteredAt: Date;
  componentCode: string;
  componentName: string;
  mapping?: Mapping | null;
  displayValue: string;
  valueNumeric: string | null;
  valueBoolean: boolean | null;
  valueDate: Date | null;
  unit: string | null;
  flag: string;
  referenceLow: string | null;
  referenceHigh: string | null;
  referenceText: string | null;
}) {
  const resource: Record<string, unknown> = {
    resourceType: "Observation",
    id: input.valueId,
    status: ["RELEASED","AMENDED"].includes(input.status) ? "final" : input.status === "VERIFIED" ? "preliminary" : "registered",
    code: { coding: coding(input.mapping, input.componentCode, input.componentName), text: input.componentName },
    subject: { reference: `Patient/${input.patientId}` },
    basedOn: [{ reference: `ServiceRequest/${input.serviceRequestId}` }],
    effectiveDateTime: (input.releasedAt || input.enteredAt).toISOString(),
    interpretation: input.flag === "NORMAL" || input.flag === "UNKNOWN"
      ? undefined
      : [{ text: input.flag }],
  };

  if (input.valueNumeric !== null) {
    resource.valueQuantity = { value: Number(input.valueNumeric), unit: input.unit || undefined };
  } else if (input.valueBoolean !== null) {
    resource.valueBoolean = input.valueBoolean;
  } else if (input.valueDate) {
    resource.valueDateTime = input.valueDate.toISOString();
  } else {
    resource.valueString = input.displayValue;
  }

  if (input.referenceLow !== null || input.referenceHigh !== null || input.referenceText) {
    resource.referenceRange = [{
      low: input.referenceLow !== null ? { value: Number(input.referenceLow), unit: input.unit || undefined } : undefined,
      high: input.referenceHigh !== null ? { value: Number(input.referenceHigh), unit: input.unit || undefined } : undefined,
      text: input.referenceText || undefined,
    }];
  }

  return resource;
}

export function diagnosticReportResource(input: {
  reportVersionId: string;
  status: string;
  patientId: string;
  accessionNumber: string;
  issuedAt: Date;
  serviceRequestIds: string[];
  observationIds: string[];
  conclusion?: string | null;
}) {
  return {
    resourceType: "DiagnosticReport",
    id: input.reportVersionId,
    identifier: [{ system: "urn:family-lab:accession", value: input.accessionNumber }],
    status: input.status === "RETRACTED" ? "entered-in-error" : input.status === "PARTIAL" ? "partial" : input.status === "AMENDED" ? "amended" : "final",
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0074", code: "LAB", display: "Laboratory" }] }],
    subject: { reference: `Patient/${input.patientId}` },
    basedOn: input.serviceRequestIds.map(id => ({ reference: `ServiceRequest/${id}` })),
    issued: input.issuedAt.toISOString(),
    result: input.observationIds.map(id => ({ reference: `Observation/${id}` })),
    conclusion: input.conclusion || undefined,
  };
}
