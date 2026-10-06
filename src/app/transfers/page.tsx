import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TransferManager } from "@/components/transfer-manager";
import { getUiLocale, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function TransfersPage() {
  const session = await requirePermission("transfers.view");
  const locale = getUiLocale(session.user.preferredLocale);
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
        <p className="eyebrow">{tr(locale, "Inter-Branch Logistics", "اللوجستيات بين الفروع")}</p>
        <h1>{tr(locale, "Specimen Transfers", "نقل العينات بين الفروع")}</h1>
        <p className="muted">{tr(locale, "Create shipment manifests, dispatch specimens into transit, and receive each barcode at the destination with custody traceability.", "إنشاء بيانات الشحن وإرسال العينات واستلام كل باركود في الفرع الوجهة مع تتبع كامل لسلسلة الحيازة.")}</p>
      </div>
      <div className="header-actions">
        <Link className="secondary-link" href="/specimens">{tr(locale, "Specimens", "العينات")}</Link>
        <Link className="secondary-link" href="/dashboard">{tr(locale, "Back to Dashboard", "العودة للوحة التحكم")}</Link>
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
