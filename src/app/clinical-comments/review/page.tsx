import Link from "next/link";
import { redirect } from "next/navigation";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CommentTemplateStatusButton } from "@/components/comment-template-status-button";
import {
  commentReviewBlocker, decodeCommentReviewCursor, encodeCommentReviewCursor,
} from "@/lib/comment-template-review-queue";
import { commentTemplateReviewFingerprint } from "@/lib/comment-template-approval";
import { tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;

export default async function CommentReviewPage({
  searchParams,
}: { searchParams: Promise<{ after?: string }> }) {
  const session = await requirePermission("clinical_rules.approve");
  const permissions = permissionSet(session);
  if (!permissions.has("result_comments.manage")) redirect("/dashboard?forbidden=1");
  const branchId = session.activeBranchId;
  if (!branchId || !session.user.branchScopes.some(scope =>
    scope.branchId === branchId && scope.branch.status === "ACTIVE" &&
    scope.branch.organizationId === session.user.organizationId)) {
    redirect("/dashboard?forbidden=1");
  }
  const organizationId = session.user.organizationId;
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  const params = await searchParams;
  const after = decodeCommentReviewCursor(params.after);
  // A cursor cannot grant read permission. A malformed value never widens the
  // query or falls back to a potentially misleading page.
  if (params.after && !after) redirect("/clinical-comments/review");
  const scoped = {
    organizationId, status: "INACTIVE" as const,
    ...(after ? { OR: [
      { createdAt: { gt: after.createdAt } },
      { createdAt: after.createdAt, id: { gt: after.id } },
    ] } : {}),
  };
  const [pendingCount, rows] = await Promise.all([
    prisma.resultCommentTemplate.count({ where: { organizationId, status: "INACTIVE" } }),
    prisma.resultCommentTemplate.findMany({
      where: scoped,
      include: {
        test: { select: { id: true, code: true, nameEn: true, nameAr: true, status: true, organizationId: true } },
        component: { select: { id: true, code: true, nameEn: true, nameAr: true, status: true, testId: true } },
        supersedesTemplate: { select: { id: true, code: true, status: true, revisionNumber: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: PAGE_SIZE + 1,
    }),
  ]);
  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);
  const ids = page.map(row => row.id);
  const events = ids.length ? await prisma.auditEvent.findMany({
    where: {
      organizationId, entityId: { in: ids },
      OR: [
        { entityType: "COMMENT_TEMPLATE", action: "LEGACY_MASTER_RECORD_CREATED" },
        { entityType: "ResultCommentTemplate", action: "RESULT_COMMENT_TEMPLATE_CREATED" },
        { entityType: "ResultCommentTemplate", action: "RESULT_COMMENT_TEMPLATE_REVISION_CREATED" },
        { entityType: "ResultCommentTemplate", action: "RESULT_COMMENT_TEMPLATE_CLINICALLY_APPROVED" },
        { entityType: "ResultCommentTemplate", action: "RESULT_COMMENT_TEMPLATE_DEACTIVATED" },
      ],
    },
    include: { actor: { select: { displayNameEn: true, displayNameAr: true, username: true } } },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    // Four historical decisions per template on average; cap to avoid unbounded
    // queries and do not infer provenance if evidence is omitted.
    take: 1000,
  }) : [];
  const creatorById = new Map<string, typeof events[number]>();
  const latestById = new Map<string, typeof events[number]>();
  for (const event of events) {
    if (event.action === "RESULT_COMMENT_TEMPLATE_CREATED" ||
      event.action === "RESULT_COMMENT_TEMPLATE_REVISION_CREATED" ||
      event.action === "LEGACY_MASTER_RECORD_CREATED") {
      if (!creatorById.has(event.entityId)) creatorById.set(event.entityId, event);
    } else {
      latestById.set(event.entityId, event);
    }
  }
  const blockerLabels = {
    CREATOR_UNVERIFIED: tr(locale, "Creation audit not verified — approval blocked", "سجل الإنشاء غير موثّق — الاعتماد محظور"),
    SELF_APPROVAL: tr(locale, "A different authorized reviewer is required", "يلزم مراجع معتمد آخر غير المُنشئ"),
    TARGET_INACTIVE_OR_INVALID: tr(locale, "The test/component scope is inactive or invalid", "الفحص أو المكوّن المرتبط غير صالح أو غير نشط"),
    CONTENT_MISSING: tr(locale, "Required clinical wording is missing", "نص التعليق السريري المطلوب غير مكتمل"),
    PREDECESSOR_INACTIVE: tr(locale, "Previous approved revision is no longer active", "النسخة المعتمدة السابقة لم تعد فعالة"),
  } as const;
  const next = page.at(-1);
  return <main className="page-shell">
    <header className="page-header">
      <div>
        <h1>{tr(locale, "Clinical Comment Approval Queue", "قائمة اعتماد التعليقات السريرية")}</h1>
        <p><Link className="secondary-link" href="/clinical-comments/revisions">{tr(locale, "Prepare comment revision", "إعداد نسخة جديدة من التعليق")}</Link></p>
        <p className="muted">{tr(locale,
          "Review both languages, clinical target and original creator before a second authorized reviewer activates a draft.",
          "راجع النصين العربي والإنجليزي وربط الفحص والمُنشئ قبل اعتماد المسودة من مراجع مستقل.")}</p>
      </div>
      <Link className="secondary-link" href="/dashboard">
        {tr(locale, "Back to Dashboard", "العودة إلى لوحة التحكم")}
      </Link>
    </header>
    <section className="detail-grid">
      <article className="detail-card">
        <h2>{tr(locale, "Inactive templates pending review", "قوالب غير مفعلة بانتظار المراجعة")}</h2>
        <strong>{pendingCount}</strong>
        <p className="muted">{tr(locale,
          "Not every inactive template is immediately eligible for approval; blocked items show their reason.",
          "ليس كل قالب غير مفعّل مؤهلاً للاعتماد؛ يظهر سبب المنع بجانب كل قالب.")}</p>
      </article>
    </section>
    <section className="detail-section">
      <article className="table-card">
        <div className="table-toolbar">
          <h2>{tr(locale, "Clinical review worklist", "قائمة عمل المراجعة السريرية")}</h2>
          <span>{page.length} {tr(locale, "shown", "معروضة")}</span>
        </div>
        <div className="table-wrap"><table>
          <thead><tr>
            <th>{tr(locale, "Template / Target", "القالب / الهدف")}</th>
            <th>{tr(locale, "Exact English & Arabic text", "النص الكامل بالإنجليزية والعربية")}</th>
            <th>{tr(locale, "Creation evidence", "توثيق الإنشاء")}</th>
            <th>{tr(locale, "Review decision", "قرار الاعتماد")}</th>
          </tr></thead>
          <tbody>{page.length === 0
            ? <tr><td colSpan={4} className="empty-state">{tr(locale,
              "No templates on this page.", "لا توجد قوالب في هذه الصفحة.")}</td></tr>
            : page.map(template => {
              const creator = creatorById.get(template.id);
              const last = latestById.get(template.id);
              const blocker = commentReviewBlocker(template,
                creator?.actorUserId ?? null, session.user.id);
              const creatorName = creator?.actor
                ? locale === "ar" ? creator.actor.displayNameAr || creator.actor.displayNameEn :
                  creator.actor.displayNameEn || creator.actor.displayNameAr
                : creator?.actorUserId || tr(locale, "Unknown", "غير معروف");
              const scopeName = template.scope === "ORGANIZATION"
                ? tr(locale, "Organization", "المؤسسة")
                : template.scope === "TEST" ? tr(locale, "Test", "فحص") :
                  tr(locale, "Component", "مكوّن");
              return <tr key={template.id}>
                <td><strong>{template.code}</strong>
                  <div><small>{tr(locale, "Revision", "الإصدار")} {template.revisionNumber}</small></div>
                  {template.supersedesTemplate && <div><small>{tr(locale, "Replaces", "يحل محل")}: {template.supersedesTemplate.code} ({template.supersedesTemplate.status})</small></div>}
                  <div>{locale === "ar"
                  ? template.nameAr || template.nameEn : template.nameEn}</div>
                  <small>{scopeName}: {template.component
                    ? `${template.test?.code || "?"} / ${template.component.code}`
                    : template.test?.code || tr(locale, "Organization", "المؤسسة")}</small>
                </td>
                <td>
                  <div dir="ltr" style={{ whiteSpace: "pre-wrap" }}><strong>{tr(locale, "English:", "الإنجليزية:")}</strong> {template.textEn}</div>
                  <div dir="rtl" style={{ whiteSpace: "pre-wrap" }}><strong>{tr(locale, "Arabic:", "العربية:")}</strong> {template.textAr ||
                    tr(locale, "No Arabic text supplied", "لم يُزوّد نص عربي")}</div>
                  <small>{tr(locale, "Names", "الأسماء")}: {template.nameEn} / {template.nameAr || "—"}</small>
                </td>
                <td>
                  <strong>{creatorName}</strong>
                  <div><small>{creator?.action === "LEGACY_MASTER_RECORD_CREATED"
                    ? tr(locale, "Legacy CSV import", "استيراد من النظام القديم")
                    : creator?.action === "RESULT_COMMENT_TEMPLATE_REVISION_CREATED"
                      ? tr(locale, "Revised clinical draft", "مسودة تصحيح سريرية")
                    : creator ? tr(locale, "Manual draft", "مسودة يدوية")
                      : tr(locale, "No creation audit", "لا يوجد سجل إنشاء")}</small></div>
                  <small>{creator?.occurredAt.toISOString().slice(0, 19).replace("T", " ") || "—"} UTC</small>
                  {last && <div><small>{tr(locale, "Previous decision", "القرار السابق")}: {last.action}<br/>
                    {last.reason || tr(locale, "No reason recorded", "لا يوجد سبب مدون")}</small></div>}
                </td>
                <td>{blocker ? <p className="form-warning">{blockerLabels[blocker]}</p>
                  : <CommentTemplateStatusButton
                    id={template.id} status="INACTIVE"
                    fingerprint={commentTemplateReviewFingerprint(template)}
                    canManage canApprove locale={locale}
                    supersedesTemplateId={template.supersedesTemplateId} />}
                </td>
              </tr>;
            })}
          </tbody>
        </table></div>
        {hasMore && next && <p><Link className="secondary-link"
          href={`/clinical-comments/review?after=${encodeURIComponent(encodeCommentReviewCursor(next))}`}>
          {tr(locale, "Next 50 drafts →", "المسودات الخمسون التالية ←")}
        </Link></p>}
        {after && <p><Link className="secondary-link" href="/clinical-comments/review">
          {tr(locale, "Start of queue", "بداية القائمة")}</Link></p>}
      </article>
    </section>
  </main>;
}
