import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CommentRevisionEditor } from "@/components/comment-revision-editor";
import { commentTemplateReviewFingerprint } from "@/lib/comment-template-approval";
import {
  decodeCommentReviewCursor, encodeCommentReviewCursor,
} from "@/lib/comment-template-review-queue";
import { tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 100;

export default async function ClinicalCommentRevisionsPage({
  searchParams,
}: { searchParams: Promise<{ after?: string }> }) {
  const session = await requirePermission("result_comments.manage");
  const organizationId = session.user.organizationId;
  const branchId = session.activeBranchId;
  if (!branchId || !session.user.branchScopes.some(s =>
    s.branchId === branchId && s.branch.status === "ACTIVE" &&
    s.branch.organizationId === organizationId)) redirect("/dashboard?forbidden=1");
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  const params = await searchParams;
  const after = decodeCommentReviewCursor(params.after);
  if (params.after && !after) redirect("/clinical-comments/revisions");
  const rows = await prisma.resultCommentTemplate.findMany({
    where: { organizationId, status: "ACTIVE", nextRevision: null,
      ...(after ? { OR: [
        { createdAt: { gt: after.createdAt } },
        { createdAt: after.createdAt, id: { gt: after.id } },
      ] } : {}),
    },
    include: {
      test: { select: { code: true } },
      component: { select: { code: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: PAGE_SIZE + 1,
  });
  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return <main className="page-shell">
    <header className="page-header">
      <div>
        <h1>{tr(locale, "Clinical Comment Text Revisions", "تصحيح نسخ التعليقات السريرية")}</h1>
        <p className="muted">{tr(locale,
          "Create a new inactive version of approved text. The approved original and all released results remain immutable. A different clinician approves the revision.",
          "أنشئ نسخة غير مفعلة من التعليق المعتمد. يبقى الأصل المعتمد والنتائج الصادرة محفوظين دون تغيير. يعتمد النسخة الجديدة مراجع سريري مستقل.")}</p>
      </div>
      <Link href="/clinical-comments/review" className="secondary-link">{tr(locale,
        "Clinical approval queue", "قائمة الاعتماد السريري")}</Link>
    </header>
    <section className="detail-section">
      <article className="detail-card">
        <h2>{tr(locale, "Prepare an immutable clinical revision", "إعداد نسخة سريرية جديدة محفوظة")}</h2>
        <CommentRevisionEditor locale={locale} sources={page.map(row => ({
          id: row.id, code: row.code, revisionNumber: row.revisionNumber,
          scope: row.scope,
          target: row.component ? `${row.test?.code || "?"} / ${row.component.code}` :
            row.test?.code || tr(locale, "Organization", "المؤسسة"),
          nameEn: row.nameEn, nameAr: row.nameAr,
          textEn: row.textEn, textAr: row.textAr,
          fingerprint: commentTemplateReviewFingerprint(row),
        }))} />
        {hasMore && last && <p><Link className="secondary-link"
          href={`/clinical-comments/revisions?after=${encodeURIComponent(encodeCommentReviewCursor(last))}`}>
          {tr(locale, "Next approved templates", "القوالب المعتمدة التالية")}
        </Link></p>}
        {after && <p><Link className="secondary-link" href="/clinical-comments/revisions">
          {tr(locale, "Return to first page", "العودة إلى الصفحة الأولى")}</Link></p>}
      </article>
    </section>
  </main>;
}
