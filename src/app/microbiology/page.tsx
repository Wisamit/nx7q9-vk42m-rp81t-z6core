import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MicrobiologyManager } from "@/components/microbiology-manager";
import { getUiLocale, statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function MicrobiologyPage() {
  const session = await requirePermission("microbiology.view");
  const permissions = permissionSet(session);
  const locale = getUiLocale(session.user.preferredLocale);
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [cases, orderItems, organismCount, antibioticCount] = await Promise.all([
    prisma.microbiologyCase.findMany({
      where: {
        organizationId: session.user.organizationId,
        performingBranchId: { in: branchIds },
      },
      include: {
        orderItem: { include: { test: true, order: { include: { patient: true } } } },
        specimen: true,
        performingBranch: true,
        _count: { select: { isolates: true, observations: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.orderItem.findMany({
      where: {
        order: { organizationId: session.user.organizationId },
        test: { workflowType: "MICROBIOLOGY", status: "ACTIVE" },
        microbiologyCases: { none: {} },
        specimenLinks: {
          some: {
            specimen: {
              status: { in: ["RECEIVED","IN_PROCESS"] },
              currentBranchId: { in: branchIds },
            },
          },
        },
      },
      include: {
        test: true,
        order: { include: { patient: true } },
        specimenLinks: {
          where: {
            specimen: {
              status: { in: ["RECEIVED","IN_PROCESS"] },
              currentBranchId: { in: branchIds },
            },
          },
          include: { specimen: { include: { currentBranch: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.organism.count({ where: { organizationId: session.user.organizationId, status: "ACTIVE" } }),
    prisma.antibiotic.count({ where: { organizationId: session.user.organizationId, status: "ACTIVE" } }),
  ]);

  const candidates = orderItems.flatMap(item => item.specimenLinks.map(link => ({
    orderItemId: item.id,
    specimenId: link.specimen.id,
    performingBranchId: link.specimen.currentBranchId!,
    accession: item.order.accessionNumber,
    patient: item.order.patient.fullNameEn,
    testCode: item.test.code,
    testName: item.test.nameEn,
    barcode: link.specimen.barcode,
    branchName: link.specimen.currentBranch?.nameEn || "—",
  })));

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Microbiology", "الأحياء الدقيقة")}</p>
        <h1>{tr(locale, "Culture & Susceptibility", "الزرع والحساسية")}</h1>
        <p className="muted">{tr(locale, "Dedicated microbiology workflow over the shared order, specimen and result architecture.", "مسار عمل مخصص للأحياء الدقيقة مبني فوق بنية الطلبات والعينات والنتائج المشتركة.")}</p>
      </div>
      <Link className="secondary-link" href="/dashboard">{tr(locale, "Back to Dashboard", "العودة للوحة التحكم")}</Link>
    </header>

    <section className="detail-grid">
      <article className="detail-card"><h2>{tr(locale, "Open cases", "الحالات المفتوحة")}</h2><strong>{cases.filter(item => !["FINAL","CANCELLED"].includes(item.status)).length}</strong></article>
      <article className="detail-card"><h2>{tr(locale, "Organisms", "الكائنات الدقيقة")}</h2><strong>{organismCount}</strong></article>
      <article className="detail-card"><h2>{tr(locale, "Antibiotics", "المضادات الحيوية")}</h2><strong>{antibioticCount}</strong></article>
    </section>

    {(permissions.has("microbiology.enter") || permissions.has("microbiology.manage")) && <MicrobiologyManager
      candidates={candidates}
      canEnter={permissions.has("microbiology.enter")}
      canManage={permissions.has("microbiology.manage")}
    />}

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Microbiology Cases", "حالات الأحياء الدقيقة")}</h2><span>{cases.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Accession / Patient</th><th>Test</th><th>Specimen</th><th>Culture</th><th>Case status</th><th>Content</th><th>Action</th></tr></thead>
        <tbody>{cases.length === 0 ? <tr><td colSpan={7} className="empty-state">{tr(locale, "No microbiology cases yet.", "لا توجد حالات أحياء دقيقة بعد.")}</td></tr> : cases.map(item => <tr key={item.id}>
          <td><strong>{item.orderItem.order.accessionNumber}</strong><br/><small>{item.orderItem.order.patient.fullNameEn}</small></td>
          <td>{item.orderItem.test.code} — {item.orderItem.test.nameEn}</td>
          <td>{item.specimen.barcode}<br/><small>{item.performingBranch.nameEn}</small></td>
          <td>{item.cultureStatus}</td>
          <td>{statusLabel(locale, item.status)}</td>
          <td>{item._count.observations} {tr(locale, "observation(s)", "ملاحظة")} · {item._count.isolates} {tr(locale, "isolate(s)", "عزلة")}</td>
          <td><Link className="secondary-link" href={`/microbiology/${item.id}`}>{tr(locale, "Open Case", "فتح الحالة")}</Link></td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </main>;
}
