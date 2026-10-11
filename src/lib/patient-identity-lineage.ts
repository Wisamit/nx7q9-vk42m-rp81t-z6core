import type { Prisma } from "../../generated/prisma/client";

const MAX_LINEAGE_NODES = 512;
type PatientNode = {
  id: string;
  mergedIntoPatientId: string | null;
  status: string;
  patientNumber: string;
  fullNameEn: string;
  fullNameAr: string | null;
  mergedAt: Date | null;
};

const patientSelect = {
  id: true,
  mergedIntoPatientId: true,
  status: true,
  patientNumber: true,
  fullNameEn: true,
  fullNameAr: true,
  mergedAt: true,
} as const;

export class PatientLineageIntegrityError extends Error {
  constructor() {
    super("PATIENT_LINEAGE_INTEGRITY");
    this.name = "PatientLineageIntegrityError";
  }
}

export type PatientLineage = {
  canonicalId: string;
  patientIds: string[];
  aliases: PatientNode[];
};

/**
 * Resolve legacy multi-hop patient merges without rewriting immutable orders.
 * Every query is tenant-scoped; broken links, loops and excessive lineage
 * fail closed rather than showing a deceptively incomplete clinical history.
 * Call inside a repeatable-read transaction for a coherent merge graph.
 */
export async function resolvePatientLineage(
  db: Pick<Prisma.TransactionClient, "patient">,
  organizationId: string,
  requestedId: string,
): Promise<PatientLineage | null> {
  if (!organizationId || !requestedId) return null;

  let currentId = requestedId;
  const ancestors = new Set<string>();
  let canonical: PatientNode | null = null;
  while (currentId) {
    if (ancestors.has(currentId) || ancestors.size >= MAX_LINEAGE_NODES) {
      throw new PatientLineageIntegrityError();
    }
    ancestors.add(currentId);
    const found = await db.patient.findFirst({
      where: { id: currentId, organizationId },
      select: patientSelect,
    });
    if (!found) {
      if (currentId === requestedId) return null;
      throw new PatientLineageIntegrityError();
    }
    if (found.mergedIntoPatientId && found.status !== "INACTIVE") {
      throw new PatientLineageIntegrityError();
    }
    if (!found.mergedIntoPatientId) {
      canonical = found;
      break;
    }
    currentId = found.mergedIntoPatientId;
  }
  if (!canonical) throw new PatientLineageIntegrityError();

  const identities = new Map<string, PatientNode>([[canonical.id, canonical]]);
  let frontier = [canonical.id];
  while (frontier.length) {
    if (identities.size >= MAX_LINEAGE_NODES) {
      // An empty next level is allowed at the upper bound.
      const remaining = await db.patient.findMany({
        where: { organizationId, mergedIntoPatientId: { in: frontier } },
        select: patientSelect,
        orderBy: { id: "asc" },
        take: 1,
      });
      if (remaining.length) throw new PatientLineageIntegrityError();
      break;
    }
    const children = await db.patient.findMany({
      where: { organizationId, mergedIntoPatientId: { in: frontier } },
      select: patientSelect,
      orderBy: { id: "asc" },
      take: MAX_LINEAGE_NODES - identities.size + 1,
    });
    if (children.length > MAX_LINEAGE_NODES - identities.size) {
      throw new PatientLineageIntegrityError();
    }
    const next: string[] = [];
    for (const child of children) {
      if (child.status !== "INACTIVE" || !child.mergedIntoPatientId ||
          !identities.has(child.mergedIntoPatientId) || identities.has(child.id)) {
        throw new PatientLineageIntegrityError();
      }
      identities.set(child.id, child);
      next.push(child.id);
    }
    frontier = next;
  }

  if (![...ancestors].every(id => identities.has(id))) {
    throw new PatientLineageIntegrityError();
  }
  return {
    canonicalId: canonical.id,
    patientIds: [...identities.keys()],
    aliases: [...identities.values()]
      .filter(node => node.id !== canonical.id)
      .sort((a, b) =>
        (a.mergedAt?.getTime() || 0) - (b.mergedAt?.getTime() || 0) ||
        a.id.localeCompare(b.id)),
  };
}
