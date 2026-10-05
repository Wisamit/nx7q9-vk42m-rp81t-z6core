import type { PrismaClient } from "../../generated/prisma/client";

type Db = PrismaClient;

export const protectedRetentionClasses = new Set(["AUDIT_EVENTS","CLINICAL_RESULTS","DIAGNOSTIC_REPORTS"]);
export const inAppPurgeClasses = new Set(["USER_SESSIONS","PORTAL_SESSIONS"]);

export function retentionCutoff(days: number) {
  return new Date(Date.now() - days * 86_400_000);
}

export async function countRetentionCandidates(db: Db, organizationId: string, dataClass: string, cutoff: Date) {
  if (dataClass === "USER_SESSIONS") {
    return db.userSession.count({
      where: {
        user: { organizationId },
        OR: [
          { expiresAt: { lte: cutoff } },
          { revokedAt: { not: null, lte: cutoff } },
        ],
      },
    });
  }
  if (dataClass === "PORTAL_SESSIONS") {
    return db.portalSession.count({
      where: {
        portalAccount: { organizationId },
        OR: [
          { expiresAt: { lte: cutoff } },
          { revokedAt: { not: null, lte: cutoff } },
        ],
      },
    });
  }
  if (dataClass === "ANALYZER_MESSAGES") {
    return db.analyzerMessage.count({
      where: { analyzer: { organizationId }, receivedAt: { lte: cutoff } },
    });
  }
  if (dataClass === "INTEGRATION_MESSAGES") {
    return db.integrationMessage.count({
      where: { organizationId, createdAt: { lte: cutoff } },
    });
  }
  if (dataClass === "WEBHOOK_DELIVERIES") {
    return db.webhookDelivery.count({
      where: { organizationId, createdAt: { lte: cutoff } },
    });
  }
  if (dataClass === "AUDIT_EVENTS") {
    return db.auditEvent.count({ where: { organizationId, occurredAt: { lte: cutoff } } });
  }
  if (dataClass === "CLINICAL_RESULTS") {
    return db.laboratoryResult.count({ where: { organizationId, createdAt: { lte: cutoff } } });
  }
  if (dataClass === "DIAGNOSTIC_REPORTS") {
    return db.diagnosticReportVersion.count({
      where: { report: { organizationId }, createdAt: { lte: cutoff } },
    });
  }
  return 0;
}
