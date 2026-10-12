import Link from "next/link";
import { redirect } from "next/navigation";
import { permissionSet, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";
const visibleStatus = ["SCHEDULED","ASSIGNED","EN_ROUTE","ARRIVED",
  "COLLECTING","COLLECTED","DELIVERED","CANCELLED"] as const;

export default async function HomeCollectionsBoard({
  searchParams,
}: { searchParams: Promise<{ status?: string; branch?: string; after?: string }> }) {
  const session = await requireSession();
  const permissions = permissionSet(session);
  const manage = permissions.has("home_collection.manage");
  const canView = manage || permissions.has("home_collection.view") ||
    permissions.has("specimens.collect") || permissions.has("specimens.receive");
  if (!canView) redirect("/dashboard?forbidden=1");
  const params = await searchParams;
  const scope = session.user.branchScopes.filter(b =>
    b.branch.status === "ACTIVE" &&
    b.branch.organizationId === session.user.organizationId).map(b => b.branchId);
  const selected = params.branch && scope.includes(params.branch) ? params.branch : null;
  const requestedStatus = visibleStatus.find(status => status === params.status) || null;
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  const afterValue = params.after && /^[a-f0-9-]{36}$/i.test(params.after) ? params.after : null;
  const visits = await prisma.homeCollectionVisit.findMany({
    where: {
      branchId: { in: selected ? [selected] : scope },
      ...(requestedStatus ? { status: requestedStatus } : {}),
      ...(manage || permissions.has("home_collection.view") ? {} :
        permissions.has("specimens.collect") && permissions.has("specimens.receive") ? {
          OR: [{ assignedCollectorUserId: session.user.id },
            { status: "COLLECTED" as const }],
        } : permissions.has("specimens.collect") ?
          { assignedCollectorUserId: session.user.id } : { status: "COLLECTED" as const }),
      appointment: { organizationId: session.user.organizationId, mode: "HOME_COLLECTION" },
    },
    include: {
      appointment: { include: { patient: true } },
      branch: true,
      assignedCollector: { select: { displayNameEn: true, displayNameAr: true } },
      order: { select: { accessionNumber: true, invoices: {
        select: { status: true, currency: true, balanceAmount: true } },
        _count: { select: { specimens: true } } } },
    },
    orderBy: [{ appointment: { scheduledStart: "asc" } }, { id: "asc" }],
    ...(afterValue ? { cursor: { id: afterValue }, skip: 1 } : {}),
    take: 101,
  });
  const visible = visits.slice(0,100);
  const next = visits.length > 100 ? visible.at(-1)?.id : null;
  const branches = await prisma.branch.findMany({
    where: { id: { in: scope }, organizationId: session.user.organizationId, status: "ACTIVE" },
    select: { id: true, code: true, nameEn: true, nameAr: true },
    orderBy: { nameEn: "asc" },
  });
  const href = (branch: string, status: string, after?: string) =>
    "/home-collections?" + new URLSearchParams({
      ...(branch ? { branch } : {}), ...(status ? { status } : {}),
      ...(after ? { after } : {}),
    }).toString();
  return <main className="page-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Home Collection Dispatch", "إدارة السحب المنزلي")}</p>
        <h1>{tr(locale, "Visits, specimens & branch handoff", "الزيارات والعينات والتسليم للفروع")}</h1>
        <p className="muted">{tr(locale,
          "Operational queue for assigned field collectors and authorized branch teams. Each case links to an accession, invoices, barcode attempts and reception evidence.",
          "قائمة تشغيلية للمُجمّعين المعيّنين وفرق الفروع المخوّلة. كل حالة مرتبطة بطلب وفواتير ومحاولات باركود ودليل استلام.")}</p>
      </div>
      <Link className="secondary-link" href="/digital-services">{tr(locale,
        "Scheduling console", "إدارة المواعيد")}</Link>
    </header>
    <section className="detail-section">
      <form method="get" className="inline-search">
        <select name="branch" defaultValue={selected || ""}>
          <option value="">{tr(locale, "All my branches", "كل الفروع المسموحة")}</option>
          {branches.map(b=><option key={b.id} value={b.id}>{b.code} — {
            locale === "ar" ? b.nameAr || b.nameEn : b.nameEn}</option>)}
        </select>
        <select name="status" defaultValue={requestedStatus || ""}>
          <option value="">{tr(locale, "All states", "جميع الحالات")}</option>
          {visibleStatus.map(st=><option key={st} value={st}>{st}</option>)}
        </select>
        <button className="secondary-button">{tr(locale, "Filter", "تصفية")}</button>
      </form>
      <article className="table-card">
        <div className="table-toolbar">
          <h2>{tr(locale, "Home collection cases", "حالات السحب المنزلي")}</h2>
          <span>{visible.length} {tr(locale, "shown", "معروضة")}</span>
        </div>
        <div className="table-wrap"><table><thead><tr>
          <th>{tr(locale, "Booking / time", "الحجز / الوقت")}</th>
          <th>{tr(locale, "Patient", "المريض")}</th><th>{tr(locale, "Branch / collector", "الفرع / المُجمّع")}</th>
          <th>{tr(locale, "Accession / invoice", "الطلب / الفاتورة")}</th>
          <th>{tr(locale, "Status", "الحالة")}</th><th>{tr(locale, "Workflow", "سير العمل")}</th>
        </tr></thead><tbody>{visible.length === 0 ?
          <tr><td colSpan={6} className="empty-state">{tr(locale,
            "No home collections for this filter.", "لا توجد زيارات منزلية مطابقة.")}</td></tr>
          : visible.map(visit => {
            const patient = visit.appointment.patient;
            const collector = visit.assignedCollector;
            return <tr key={visit.id}>
              <td><strong>{visit.appointment.appointmentNumber}</strong><br/>
                <small>{new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB",
                  { timeZone: visit.branch.timezone, dateStyle: "short", timeStyle: "short" })
                  .format(visit.appointment.scheduledStart)}</small></td>
              <td>{patient.patientNumber}<br/><small>{locale === "ar" ?
                patient.fullNameAr || patient.fullNameEn : patient.fullNameEn}</small></td>
              <td>{visit.branch.code}<br/><small>{collector ?
                locale === "ar" ? collector.displayNameAr || collector.displayNameEn :
                  collector.displayNameEn : tr(locale,"Unassigned","غير معيّن")}</small></td>
              <td>{visit.order?.accessionNumber || tr(locale,"Not linked","غير مرتبط")}<br/>
                <small>{visit.order ? `${visit.order._count.specimens} specimens · ${visit.order.invoices.length} invoices` : "—"}</small></td>
              <td>{visit.status}</td>
              <td><Link className="secondary-link" href={`/home-collections/${visit.id}`}>
                {tr(locale, "Open case", "فتح الحالة")}</Link></td>
            </tr>;
          })}</tbody></table></div>
        {next && <p><Link className="secondary-link" href={href(selected || "",requestedStatus || "",next)}>
          {tr(locale, "Next 100 visits", "المئة زيارة التالية")}</Link></p>}
      </article>
    </section>
  </main>;
}
