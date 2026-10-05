function esc(value: unknown) {
  return String(value ?? "")
    .replaceAll("\\", "\\E\\")
    .replaceAll("|", "\\F\\")
    .replaceAll("^", "\\S\\")
    .replaceAll("&", "\\T\\")
    .replaceAll("~", "\\R\\")
    .replace(/[\r\n]+/g, " ");
}

function dt(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return date.getUTCFullYear() + pad(date.getUTCMonth()+1) + pad(date.getUTCDate()) +
    pad(date.getUTCHours()) + pad(date.getUTCMinutes()) + pad(date.getUTCSeconds());
}

type ReportSnapshot = {
  organization: { code: string };
  branch: { code: string };
  patient: {
    patientNumber: string;
    fullNameEn: string;
    dateOfBirth: string | null;
    sexAtBirth: string;
  };
  order: { accessionNumber: string; orderedAt: string };
  results: Array<{
    testId: string;
    testCode: string;
    testNameEn: string;
    loincCode?: string | null;
    releasedAt: string | null;
    values: Array<{
      componentId?: string | null;
      componentCode: string;
      componentNameEn: string;
      loincCode?: string | null;
      displayValue: string;
      unit: string | null;
      flag: string;
      referenceLow: string | null;
      referenceHigh: string | null;
      referenceTextEn: string | null;
    }>;
  }>;
};

export function buildHl7OruR01(snapshot: ReportSnapshot, controlId: string, issuedAt: Date) {
  const sex = snapshot.patient.sexAtBirth === "MALE" ? "M" : snapshot.patient.sexAtBirth === "FEMALE" ? "F" : "U";
  const segments: string[] = [
    `MSH|^~\\&|FAMILY_LAB|${esc(snapshot.branch.code)}|||${dt(issuedAt)}||ORU^R01|${esc(controlId)}|P|2.5.1`,
    `PID|||${esc(snapshot.patient.patientNumber)}||${esc(snapshot.patient.fullNameEn)}||${snapshot.patient.dateOfBirth?.replaceAll("-","") || ""}|${sex}`,
  ];

  let obr = 0;
  let obx = 0;
  for (const result of snapshot.results) {
    obr++;
    const obrCode = result.loincCode
      ? `${esc(result.loincCode)}^${esc(result.testNameEn)}^LN`
      : `${esc(result.testCode)}^${esc(result.testNameEn)}^99FAMILYLAB`;
    segments.push(`OBR|${obr}|${esc(snapshot.order.accessionNumber)}|${esc(snapshot.order.accessionNumber)}|${obrCode}|||||||||||||||||||||${result.releasedAt ? dt(result.releasedAt) : dt(issuedAt)}`);
    for (const value of result.values) {
      obx++;
      const range = value.referenceTextEn || [value.referenceLow,value.referenceHigh].filter(Boolean).join("-");
      const abnormal = value.flag === "HIGH" || value.flag === "CRITICAL_HIGH" ? "H" :
        value.flag === "LOW" || value.flag === "CRITICAL_LOW" ? "L" :
        value.flag === "ABNORMAL" ? "A" : "N";
      const obxCode = value.loincCode
        ? `${esc(value.loincCode)}^${esc(value.componentNameEn)}^LN`
        : `${esc(value.componentCode)}^${esc(value.componentNameEn)}^99FAMILYLAB`;
      segments.push(`OBX|${obx}|ST|${obxCode}||${esc(value.displayValue)}|${esc(value.unit)}|${esc(range)}|${abnormal}|||F`);
    }
  }
  return segments.join("\r") + "\r";
}

export function buildHl7Ack(input: {
  originalSendingApplication: string;
  originalSendingFacility: string;
  controlId: string;
  acknowledgementCode: "AA" | "AE" | "AR";
  message?: string;
}) {
  const now = new Date();
  const ackId = `ACK-${input.controlId || now.getTime()}`;
  return [
    `MSH|^~\\&|FAMILY_LAB|LIS|${esc(input.originalSendingApplication)}|${esc(input.originalSendingFacility)}|${dt(now)}||ACK|${esc(ackId)}|P|2.5.1`,
    `MSA|${input.acknowledgementCode}|${esc(input.controlId)}|${esc(input.message || "")}`,
  ].join("\r") + "\r";
}

export function parseHl7Msh(payload: string) {
  const normalized = payload.replaceAll("\n","\r").split("\r").filter(Boolean);
  const msh = normalized.find(segment => segment.startsWith("MSH|"));
  if (!msh) return null;
  const fields = msh.split("|");
  return {
    sendingApplication: fields[2] || "",
    sendingFacility: fields[3] || "",
    receivingApplication: fields[4] || "",
    receivingFacility: fields[5] || "",
    messageType: fields[8] || "",
    controlId: fields[9] || "",
    version: fields[11] || "",
  };
}
