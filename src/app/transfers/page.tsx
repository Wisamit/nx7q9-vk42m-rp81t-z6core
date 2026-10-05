import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TransferManager } from "@/components/transfer-manager";

export const dynamic = "force-dynamic";

export default async function TransfersPage() {
  const session = await requirePermission("transfers.view");
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [branches, sourceBranches, specimens, manifests] = await Promise.all([
    prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.branch.findMany({
      where: { id: { in: branchIds }, organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.specimen.findMany({
      where: {
        organizationId: session.user.organizationId,
        currentBranchId: { in: branchIds },
        status: { in: ["COLLECTED","RECEIVED"] },
      },
      select: {
        id: true,
        barcode: true,
        status: true,
        currentBranchId: true,
        specimenType: { select: { nameEn: true } },
        order: {
          select: {
            accessionNumber: true,
            patient: { select: { patientNumber: true, fullNameEn: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.specimenTransferManifest.findMany({
      where: {
        organizationId: session.user.organizationId,
        OR: [
          { sourceBranchId: { in: branchIds } },
          { destinationBranchId: { in: branchIds } },
        ],
      },
      include: {
        sourceBranch: { select: { id: true, code: true, nameEn: true } },
        destinationBranch: { select: { id: true, code: true, nameEn: true } },
        items: {
          include: {
            specimen: {
              select: {
                specimenType: { select: { nameEn: true } },
                order: {
                  select: {
                    accessionNumber: true,
                    patient: { select: { patientNumber: true, fullNameEn: true } },
                  },
                },
              },
            },
          },
          orderBy: { barcodeSnapshot: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Inter-Branch Logistics</p>
        <h1>Specimen Transfers</h1>
        <p className="muted">Create shipment manifests, dispatch specimens into transit, and receive each barcode at the destination with custody traceability.</p>
      </div>
      <div className="header-actions">
        <Link className="secondary-link" href="/specimens">Specimens</Link>
        <Link className="secondary-link" href="/dashboard">Back to Dashboard</Link>
      </div>
    </header>

    <TransferManager
      branches={branches}
      sourceBranches={sourceBranches}
      specimens={specimens}
      manifests={manifests.map(manifest => ({
        ...manifest,
        createdAt: manifest.createdAt.toISOString(),
        dispatchedAt: manifest.dispatchedAt?.toISOString() || null,
        receivedAt: manifest.receivedAt?.toISOString() || null,
      }))}
      activeBranchId={session.activeBranchId}
    />
  </main>;
}
