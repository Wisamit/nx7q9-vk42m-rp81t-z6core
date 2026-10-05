import { Prisma, PrismaClient } from "../../generated/prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type ReportTemplateConfiguration = {
  languageMode: "BILINGUAL" | "ENGLISH" | "ARABIC";
  logoUrl: string | null;
  headerEn: string | null;
  headerAr: string | null;
  footerEn: string | null;
  footerAr: string | null;
  watermark: string | null;
  showSignature: boolean;
  showQr: boolean;
  showPageNumbers: boolean;
  columns: Array<"TEST" | "RESULT" | "FLAG" | "UNIT" | "REFERENCE">;
};

export function normalizeReportTemplateConfiguration(value: unknown): ReportTemplateConfiguration {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const languageMode = ["BILINGUAL","ENGLISH","ARABIC"].includes(String(input.languageMode))
    ? String(input.languageMode) as ReportTemplateConfiguration["languageMode"]
    : "BILINGUAL";
  const allowedColumns = new Set(["TEST","RESULT","FLAG","UNIT","REFERENCE"]);
  const columns: ReportTemplateConfiguration["columns"] = Array.isArray(input.columns)
    ? input.columns.map(String).filter(item => allowedColumns.has(item)) as ReportTemplateConfiguration["columns"]
    : ["TEST","RESULT","FLAG","UNIT","REFERENCE"];
  const clean = (v: unknown, max: number) => typeof v === "string" && v.trim() ? v.trim().slice(0,max) : null;
  const logoUrl = clean(input.logoUrl, 1000);
  if (logoUrl) {
    const parsed = new URL(logoUrl);
    if (!["http:","https:"].includes(parsed.protocol)) throw new Error("INVALID_LOGO_URL");
  }
  return {
    languageMode,
    logoUrl,
    headerEn: clean(input.headerEn, 2000),
    headerAr: clean(input.headerAr, 2000),
    footerEn: clean(input.footerEn, 2000),
    footerAr: clean(input.footerAr, 2000),
    watermark: clean(input.watermark, 100),
    showSignature: input.showSignature !== false,
    showQr: input.showQr !== false,
    showPageNumbers: input.showPageNumbers !== false,
    columns: columns.length ? columns : ["TEST","RESULT","FLAG","UNIT","REFERENCE"],
  };
}

export async function resolveEffectiveReportTemplate(db: DbClient, input: {
  organizationId: string;
  branchId: string;
  asOf: Date;
}) {
  const candidates = await db.reportTemplate.findMany({
    where: {
      organizationId: input.organizationId,
      status: "ACTIVE",
      isDefault: true,
      OR: [{ branchId: input.branchId }, { branchId: null }],
    },
    include: {
      versions: {
        where: {
          status: "EFFECTIVE",
          effectiveFrom: { lte: input.asOf },
          AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: input.asOf } }] }],
        },
        orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
        take: 1,
      },
    },
  });
  const template = candidates.find(item => item.branchId === input.branchId && item.versions[0])
    || candidates.find(item => item.branchId === null && item.versions[0])
    || null;
  if (!template?.versions[0]) return null;
  const version = template.versions[0];
  return {
    template,
    version,
    configuration: normalizeReportTemplateConfiguration(version.configuration),
  };
}
