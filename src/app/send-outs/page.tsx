import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SendOutManager } from "@/components/send-out-manager";
import { getUiLocale, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function SendOutsPage() {
  const session = await requirePermission("sendouts.view");
  const permissions = permissionSet(session);
  const locale = getUiLocale(session.user.preferredLocale);
  const branchIds = session.user.branchScopes.filter(scope => scope.branch.status === "ACTIVE").map(scope => scope.branchId);

  const [laboratories, orderItems, referrals] = await Promise.all([
    prisma.externalLaboratory.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.orderItem.findMany({
      where: {
        order: { organizationId: session.user.organizationId, orderingBranchId: { in: branchIds } },
        status: { notIn: ["VERIFIED", "CANCELLED"] },
        specimenLinks: {
          some: {
            specimen: {
              currentBranchId: { in: branchIds },
              status: { in: ["COLLECTED", "RECEIVED", "IN_PROCESS"] },
            },
          },
        },
        sendOutReferrals: { none: { status: { notIn: ["COMPLETED", "CANCELLED"] } } },
      },
      include: {
        order: { include: { patient: true, orderingBranch: true } },
        specimenLinks: {
          where: { specimen: { currentBranchId: { in: branchIds }, status: { in: ["COLLECTED", "RECEIVED", "IN_PROCESS"] } } },
          include: { specimen: { include: { currentBranch: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    prisma.sendOutReferral.findMany({
      where: { organizationId: session.user.organizationId, branchId: { in: branchIds } },
      include: {
        branch: true,
        externalLaboratory: true,
        orderItem: { include: { order: { include: { patient: true } } } },
        specimen: true,
        events: { include: { actor: true }, orderBy: { occurredAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
  ]);

  const referralIds = referrals.map(referral => referral.id);
  const attachments = referralIds.length ? await prisma.attachment.findMany({
    where: {
      organizationId: session.user.organizationId,
      targetType: "SEND_OUT_REFERRAL",
      targetId: { in: referralIds },
    },
    include: { uploadedBy: true },
    orderBy: { createdAt: "desc" },
  }) : [];
  const attachmentsByTarget = new Map<string, typeof attachments>();
  for (const attachment of attachments) {
    const list = attachmentsByTarget.get(attachment.targetId) || [];
    list.push(attachment);
    attachmentsByTarget.set(attachment.targetId, list);
  }

  const patientName = (item: { fullNameEn: string; fullNameAr?: string | null }) => locale === "ar" ? item.fullNameAr || item.fullNameEn : item.fullNameEn;
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const userName = (item: { displayNameEn: string; displayNameAr?: string | null }) => locale === "ar" ? item.displayNameAr || item.displayNameEn : item.displayNameEn;

  const candidates = orderItems.flatMap(item =>
    item.specimenLinks.map(link => ({
      key: item.id + ":" + link.specimenId,
      orderItemId: item.id,
      specimenId: link.specimenId,
      branchId: link.specimen.currentBranchId!,
      label: [
        item.order.accessionNumber,
        item.order.patient.patientNumber,
        patientName(item.order.patient),
        item.testCodeSnapshot + " — " + (locale === "ar" ? item.testNameArSnapshot || item.testNameEnSnapshot : item.testNameEnSnapshot),
        link.specimen.barcode,
        link.specimen.currentBranch?.code,
      ].filter(Boolean).join(" · "),
    }))
  );

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Referral Laboratory Workflow", "مسار المختبرات المرجعية")}</p>
        <h1>{tr(locale, "Send-out Laboratories", "المختبرات المرجعية الخارجية")}</h1>
        <p className="muted">{tr(locale, "Track external laboratory referral, specimen dispatch, cost, expected TAT, external reports, verification and chain of custody.", "تتبع إحالة المختبر الخارجي وإرسال العينات والتكلفة والوقت المتوقع والنتائج الخارجية والتحقق وسلسلة الحيازة.")}</p>
      </div>
    </header>

    <section className="workflow-summary">
      <article><span>{tr(locale, "Active labs", "مختبرات نشطة")}</span><strong>{laboratories.length}</strong><small>{tr(locale, "configured referral laboratories", "مختبرات مرجعية مهيأة")}</small></article>
      <article><span>{tr(locale, "Open referrals", "إحالات مفتوحة")}</span><strong>{referrals.filter(row => !["COMPLETED","CANCELLED"].includes(row.status)).length}</strong><small>{tr(locale, "not yet completed", "غير مكتملة بعد")}</small></article>
      <article><span>{tr(locale, "Awaiting result", "بانتظار النتيجة")}</span><strong>{referrals.filter(row => row.status === "DISPATCHED").length}</strong><small>{tr(locale, "specimens dispatched", "عينات تم إرسالها")}</small></article>
      <article><span>{tr(locale, "Awaiting verification", "بانتظار التحقق")}</span><strong>{referrals.filter(row => row.status === "RESULT_RECEIVED").length}</strong><small>{tr(locale, "external result received", "تم استلام النتيجة الخارجية")}</small></article>
    </section>

    <SendOutManager
      locale={locale}
      laboratories={laboratories}
      candidates={candidates}
      referrals={referrals.map(referral => ({
        id: referral.id,
        status: referral.status,
        branchCode: referral.branch.code,
        branchTimeZone: referral.branch.timezone,
        accessionNumber: referral.orderItem.order.accessionNumber,
        patientNumber: referral.orderItem.order.patient.patientNumber,
        patientName: patientName(referral.orderItem.order.patient),
        testCode: referral.orderItem.testCodeSnapshot,
        testName: locale === "ar" ? referral.orderItem.testNameArSnapshot || referral.orderItem.testNameEnSnapshot : referral.orderItem.testNameEnSnapshot,
        specimenBarcode: referral.specimen?.barcode || null,
        laboratoryCode: referral.externalLaboratory.code,
        laboratoryName: localizedName(referral.externalLaboratory),
        externalAccession: referral.externalAccession,
        costAmount: referral.costAmount?.toString() || null,
        costCurrency: referral.costCurrency,
        expectedResultAt: referral.expectedResultAt?.toISOString() || null,
        courier: referral.courier,
        trackingReference: referral.trackingReference,
        dispatchedAt: referral.dispatchedAt?.toISOString() || null,
        resultReceivedAt: referral.resultReceivedAt?.toISOString() || null,
        externalResultText: referral.externalResultText,
        verifiedAt: referral.verifiedAt?.toISOString() || null,
        events: referral.events.map(event => ({
          id: event.id,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          occurredAt: event.occurredAt.toISOString(),
          actor: userName(event.actor),
          note: event.note,
        })),
        attachments: (attachmentsByTarget.get(referral.id) || []).map(attachment => ({
          id: attachment.id,
          originalName: attachment.originalName,
          contentType: attachment.contentType,
          sizeBytes: attachment.sizeBytes,
          createdAt: attachment.createdAt.toISOString(),
          uploadedBy: userName(attachment.uploadedBy),
        })),
      }))}
      canManage={permissions.has("sendouts.manage")}
      canVerify={permissions.has("sendouts.verify")}
      canUploadAttachments={permissions.has("attachments.upload")}
    />
  </main>;
}
