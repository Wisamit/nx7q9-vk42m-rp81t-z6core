import { prisma } from "@/lib/db";

export async function resolvePrimaryTerminologyMapping(input: {
  organizationId: string;
  testId: string;
  componentId?: string | null;
  asOf: Date;
  system?: "LOINC" | "SNOMED_CT" | "ICD10" | "LOCAL";
}) {
  return prisma.terminologyMapping.findFirst({
    where: {
      organizationId: input.organizationId,
      testId: input.testId,
      componentId: input.componentId || null,
      system: input.system || "LOINC",
      isPrimary: true,
      status: "ACTIVE",
      effectiveFrom: { lte: input.asOf },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: input.asOf } }],
    },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    select: { system: true, code: true, display: true },
  });
}
