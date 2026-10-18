import { TableEmptyState } from "@/components/table-empty-state";
import Link from "next/link";
import { SystemDateText } from "@/components/system-date-text";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AnalyzerManager } from "@/components/analyzer-manager";
import { AnalyzerMappingGovernanceButton } from "@/components/analyzer-mapping-governance-button";
import { AnalyzerMessageReplayButton } from "@/components/analyzer-message-replay-button";
import { AnalyzerClinicalImportButton } from "@/components/analyzer-clinical-import-button";
import { getUiLocale, statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function AnalyzersPage() {
  const session = await requirePermission("analyzers.view");
  const permissions = permissionSet(session);
  const locale = getUiLocale(session.user.preferredLocale);
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [analyzers, branches, departments, tests, messages, resultImports, workOrders] = await Promise.all([
    prisma.analyzer.findMany({
      where: { organizationId: session.user.organizationId, branchId: { in: branchIds } },
      include: {
        branch: true,
        department: true,
        credentials: { orderBy: { createdAt: "desc" }, take: 5 },
        mappings: {
          include: {
            test: { include: { defaultUnit: true } },
            component: { include: { unit: true } },
            createdBy: { select: { displayNameEn: true, displayNameAr: true } },
            approvedBy: { select: { displayNameEn: true, displayNameAr: true } },
            retiredBy: { select: { displayNameEn: true, displayNameAr: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
      orderBy: [{ branch: { nameEn: "asc" } }, { code: "asc" }],
    }),
    prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, id: { in: branchIds }, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.department.findMany({
      where: {
        organizationId: session.user.organizationId,
        status: "ACTIVE",
        OR: [{ branchId: null }, { branchId: { in: branchIds } }],
      },
      select: { id: true, code: true, nameEn: true, nameAr: true, branchId: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.labTest.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameAr: true,
        components: {
          where: { status: "ACTIVE" },
          select: { id: true, code: true, nameEn: true, nameAr: true },
          orderBy: { displayOrder: "asc" },
        },
      },
      orderBy: { nameEn: "asc" },
    }),
    prisma.analyzerMessage.findMany({
      where: { branchId: { in: branchIds } },
      include: { analyzer: { include: { branch: { select: { timezone: true } } } } },
      orderBy: { receivedAt: "desc" },
      take: 100,
    }),
    prisma.analyzerResultImport.findMany({
      where: { analyzer: { branchId: { in: branchIds } } },
      include: {
        analyzer: { include: { branch: { select: { timezone: true } } } },
        mapping: { include: { test: true, component: true } },
        orderItem: true,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.analyzerWorkOrder.findMany({
      where: {
        organizationId: session.user.organizationId,
        branchId: { in: branchIds },
      },
      include: { analyzer: { select: { code: true, name: true, branch: { select: { timezone: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const localizedName = (item: { nameEn: string; nameAr?: string | null }) =>
    locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;

  const mappedGroups = new Map<string, {
    analyzerCode: string;
    analyzerName: string;
    orderItemId: string;
    testCode: string;
    testName: string;
    specimenId: string;
    barcode: string;
    importIds: string[];
  }>();

  for (const item of resultImports) {
    if (item.status !== "MAPPED" || !item.orderItemId || !item.specimenId) continue;
    const key = [item.analyzerId, item.orderItemId, item.specimenId].join(":");
    const group = mappedGroups.get(key);
    if (group) {
      group.importIds.push(item.id);
    } else {
      mappedGroups.set(key, {
        analyzerCode: item.analyzer.code,
        analyzerName: item.analyzer.name,
        orderItemId: item.orderItemId,
        testCode: item.orderItem?.testCodeSnapshot || "—",
        testName: locale === "ar" ? item.orderItem?.testNameArSnapshot || item.orderItem?.testNameEnSnapshot || "—" : item.orderItem?.testNameEnSnapshot || "—",
        specimenId: item.specimenId,
        barcode: item.barcodeSnapshot || "—",
        importIds: [item.id],
      });
    }
  }

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Analyzer Integration", "تكامل أجهزة التحليل")}</p>
        <h1>{tr(locale, "Analyzers & Interface Inbox", "أجهزة التحليل وصندوق رسائل الربط")}</h1>
        <p className="muted">{tr(locale, "The core LIS receives authenticated raw messages from a separately deployable Analyzer Bridge. Device serial/TCP logic stays outside the web application.", "يستقبل نظام LIS الرسائل الخام الموثقة من Analyzer Bridge منفصل، بينما تبقى اتصالات الأجهزة التسلسلية وTCP خارج تطبيق الويب.")}</p>
      </div>
      <Link className="secondary-link" href="/dashboard">{tr(locale, "Back to Dashboard", "العودة للوحة التحكم")}</Link>
    </header>

    {permissions.has("analyzers.manage") && <AnalyzerManager
      locale={locale}
      branches={branches}
      departments={departments}
      tests={tests}
      analyzers={analyzers.map(item => ({ id: item.id, code: item.code, name: item.name, branchId: item.branchId }))}
    />}

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Analyzer Registry", "سجل أجهزة التحليل")}</h2><span>{analyzers.length} {tr(locale, "analyzer(s)", "جهاز")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Analyzer", "الجهاز")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Protocol", "البروتوكول")}</th><th>{tr(locale, "Transport", "وسيلة الاتصال")}</th><th>{tr(locale, "Credentials", "بيانات الاعتماد")}</th><th>{tr(locale, "Mappings", "الربط")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
        <tbody>{analyzers.length === 0 ? <tr><td colSpan={7} className="empty-state"><TableEmptyState title={tr(locale, "No analyzers registered.", "لا توجد أجهزة تحليل مسجلة.")} description={tr(locale, "No analyzer devices are registered in this organization view. Configure a device and its branch before mapping interface codes.", "لا توجد أجهزة تحليل مسجلة في عرض المؤسسة. هيّئ الجهاز وفرعه قبل ربط رموز الواجهة.")} /></td></tr> : analyzers.map(item => <tr key={item.id}>
          <td><strong>{item.code} — {item.name}</strong><br/><small>{[item.manufacturer, item.model, item.serialNumber].filter(Boolean).join(" · ") || tr(locale, "No device metadata", "لا توجد بيانات للجهاز")}</small></td>
          <td>{localizedName(item.branch)}{item.department ? " · " + localizedName(item.department) : ""}</td>
          <td>{item.protocol}</td>
          <td>{item.transport}</td>
          <td>{item.credentials.filter(credential => credential.status === "ACTIVE").length} {tr(locale, "active", "نشط")}</td>
          <td>{item.mappings.filter(mapping => mapping.status === "ACTIVE" && mapping.approvalStatus === "APPROVED" && mapping.approvedAt).length} {tr(locale, "approved active", "معتمد ونشط")}</td>
          <td>{statusLabel(locale, item.status)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Outbound Analyzer Work Orders", "أوامر التحليل المرسلة للأجهزة")}</h2><span>{workOrders.length} {tr(locale, "recent", "حديثة")}</span></div>
      <p className="muted">{tr(locale,
        "Bridge acknowledgement means the Bridge accepted a command, not proof of analyzer completion. Queued and failed commands stay traceable per attempt.",
        "تأكيد الجسر يعني قبول أمر التحليل من الجسر، ولا يثبت انتهاء التنفيذ على الجهاز. تبقى الأوامر المعلّقة والمتعثرة قابلة للتتبع حسب المحاولة."
      )}</p>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale,"Created","التاريخ")}</th><th>{tr(locale,"Analyzer","الجهاز")}</th><th>{tr(locale,"Accession","رقم الطلب")}</th><th>{tr(locale,"Barcode","الباركود")}</th><th>{tr(locale,"Test mapping","رمز الفحص في الجهاز")}</th><th>{tr(locale,"Status","الحالة")}</th><th>{tr(locale,"Attempts","المحاولات")}</th><th>{tr(locale,"Next retry","المحاولة التالية")}</th><th>{tr(locale,"Error / ACK","الخطأ / التأكيد")}</th></tr></thead>
        <tbody>{workOrders.length === 0 ? <tr><td colSpan={9} className="empty-state"><TableEmptyState title={tr(locale,"No outbound analyzer work orders have been queued.","لم تُنشأ أي أوامر تحليل صادرة للأجهزة.")} description={tr(locale, "No outbound analyzer work orders are present. Work orders require eligible authorized specimen and instrument context.", "لا توجد أوامر عمل مرسلة لأجهزة التحليل. تتطلب الأوامر سياقاً صالحاً ومصرحاً به للعينة والجهاز.")} /></td></tr> : workOrders.map(item => <tr key={item.id}>
          <td><SystemDateText value={item.createdAt.toISOString()} timeZone={item.analyzer.branch.timezone} /></td>
          <td>{item.analyzer.code} — {item.analyzer.name}</td>
          <td>{item.accessionNumberSnapshot}</td>
          <td><strong>{item.barcodeSnapshot}</strong></td>
          <td>{item.analyzerTestCodeSnapshot}</td>
          <td>{statusLabel(locale, item.status)}</td>
          <td>{item.attemptCount}/{item.maxAttempts}</td>
          <td>{item.nextAttemptAt ? <SystemDateText value={item.nextAttemptAt.toISOString()} timeZone={item.analyzer.branch.timezone} /> : "—"}</td>
          <td>{item.lastError || item.acknowledgement || "—"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Raw Message Inbox", "صندوق الرسائل الخام")}</h2><span>{messages.length} {tr(locale, "recent", "حديثة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Received", "الاستلام")}</th><th>{tr(locale, "Analyzer", "الجهاز")}</th><th>{tr(locale, "Bridge message", "رسالة الجسر")}</th><th>{tr(locale, "Protocol", "البروتوكول")}</th><th>{tr(locale, "Status", "الحالة")}</th><th>{tr(locale, "Attempts", "المحاولات")}</th><th>{tr(locale, "Error", "الخطأ")}</th><th>{tr(locale, "Payload hash", "بصمة الحمولة")}</th><th>{tr(locale, "Action", "الإجراء")}</th></tr></thead>
        <tbody>{messages.length === 0 ? <tr><td colSpan={9} className="empty-state"><TableEmptyState title={tr(locale, "No analyzer messages received.", "لم يتم استلام رسائل من أجهزة التحليل.")} description={tr(locale, "No inbound analyzer messages are present. Review the separate analyzer bridge connection and instrument configuration if data is expected.", "لا توجد رسائل واردة من أجهزة التحليل. راجع اتصال جسر الأجهزة المنفصل وإعداد الجهاز إذا كانت البيانات متوقعة.")} /></td></tr> : messages.map(item => <tr key={item.id}>
          <td><SystemDateText value={item.receivedAt.toISOString()} timeZone={item.analyzer.branch.timezone} /></td>
          <td>{item.analyzer.code} — {item.analyzer.name}</td>
          <td>{item.bridgeMessageId}</td>
          <td>{item.protocol}</td>
          <td>{statusLabel(locale, item.status)}</td>
          <td>{item.attempts}</td>
          <td>{item.errorCode || item.errorText || "—"}</td>
          <td><code>{item.payloadHash.slice(0,16)}…</code></td>
          <td>{permissions.has("analyzers.replay") && ["ERROR","DEAD_LETTER"].includes(item.status) ? <AnalyzerMessageReplayButton messageId={item.id} locale={locale} /> : "—"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>


    {permissions.has("analyzers.import") && mappedGroups.size > 0 && <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Ready for Clinical Import", "جاهز للاستيراد السريري")}</h2><span>{mappedGroups.size} {tr(locale, "result group(s)", "مجموعة نتائج")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Analyzer", "الجهاز")}</th><th>{tr(locale, "Test", "الفحص")}</th><th>{tr(locale, "Barcode", "الباركود")}</th><th>{tr(locale, "Observations", "المشاهدات")}</th><th>{tr(locale, "Action", "الإجراء")}</th></tr></thead>
        <tbody>{[...mappedGroups.values()].map(group => <tr key={group.analyzerCode + group.orderItemId + group.specimenId}>
          <td>{group.analyzerCode} — {group.analyzerName}</td>
          <td><strong>{group.testCode}</strong><br/><small>{group.testName}</small></td>
          <td><strong>{group.barcode}</strong></td>
          <td>{group.importIds.length}</td>
          <td><AnalyzerClinicalImportButton importIds={group.importIds} locale={locale} /></td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Normalized Result Staging", "مرحلة تهيئة النتائج الموحّدة")}</h2><span>{resultImports.length} {tr(locale, "recent", "حديثة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Created", "تاريخ الإنشاء")}</th><th>{tr(locale, "Analyzer", "الجهاز")}</th><th>{tr(locale, "Observation", "المشاهدة")}</th><th>{tr(locale, "Barcode", "الباركود")}</th><th>{tr(locale, "Analyzer code", "رمز الجهاز")}</th><th>{tr(locale, "LIS target", "هدف LIS")}</th><th>{tr(locale, "Raw value", "القيمة الخام")}</th><th>{tr(locale, "Status", "الحالة")}</th><th>{tr(locale, "Error", "الخطأ")}</th><th>{tr(locale, "Clinical result", "النتيجة السريرية")}</th></tr></thead>
        <tbody>{resultImports.length === 0 ? <tr><td colSpan={10} className="empty-state"><TableEmptyState title={tr(locale, "No normalized analyzer observations staged.", "لا توجد مشاهدات أجهزة مهيأة للاستيراد.")} description={tr(locale, "No staged analyzer observations are present. Analyzer data is retained for controlled review before result verification.", "لا توجد مشاهدات أجهزة في مرحلة المراجعة. تُحفظ بيانات الجهاز للمراجعة المنضبطة قبل التحقق من النتائج.")} /></td></tr> : resultImports.map(item => <tr key={item.id}>
          <td><SystemDateText value={item.createdAt.toISOString()} timeZone={item.analyzer.branch.timezone} /></td>
          <td>{item.analyzer.code}</td>
          <td>{item.bridgeObservationId}</td>
          <td><strong>{item.barcodeSnapshot || "—"}</strong></td>
          <td>{item.analyzerTestCode}</td>
          <td>{item.mapping ? item.mapping.test.code + (item.mapping.component ? " · " + item.mapping.component.code : "") : "—"}</td>
          <td><strong>{item.rawValue}</strong>{item.rawUnit ? " " + item.rawUnit : ""}</td>
          <td>{statusLabel(locale, item.status)}</td>
          <td>{item.errorCode ? item.errorCode + (item.errorText ? " · " + item.errorText : "") : "—"}</td>
          <td>{item.resultId && item.orderItemId ? <Link href={`/worklists/${item.orderItemId}`}>{tr(locale, "Open result", "فتح النتيجة")}</Link> : "—"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="detail-grid detail-section">
      {analyzers.map(item => <article className="table-card" key={item.id}>
        <div className="table-toolbar"><h2>{item.code} {tr(locale, "Mappings", "عمليات الربط")}</h2><span>{item.mappings.length} {tr(locale, "shown", "معروضة")}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr(locale, "Analyzer code", "رمز الجهاز")}</th><th>{tr(locale, "LIS target", "هدف LIS")}</th><th>{tr(locale, "Unit mapping", "ربط الوحدة")}</th><th>{tr(locale, "Effective", "السريان")}</th><th>{tr(locale, "Lifecycle", "دورة الحياة")}</th><th>{tr(locale, "Governance evidence", "دليل الحوكمة")}</th><th>{tr(locale, "Action", "الإجراء")}</th></tr></thead>
          <tbody>{item.mappings.length === 0 ? <tr><td colSpan={7} className="empty-state"><TableEmptyState title={tr(locale, "No mappings configured.", "لا توجد عمليات ربط مهيأة.")} description={tr(locale, "No mappings appear for this analyzer. Mapping codes requires an authorized catalog and interface configuration.", "لا تظهر روابط رموز لهذا الجهاز. يتطلب الربط دليلاً وواجهة مُهيأين بصلاحية مناسبة.")} /></td></tr> : item.mappings.map(mapping => {
            const currentUnit = mapping.componentId ? mapping.component?.unit || null : mapping.test.defaultUnit;
            const lisUnit = mapping.lisUnitSymbolSnapshot || currentUnit?.symbol || "—";
            const creator = mapping.createdBy ? (locale === "ar" ? mapping.createdBy.displayNameAr || mapping.createdBy.displayNameEn : mapping.createdBy.displayNameEn) : tr(locale, "Legacy / unknown", "قديم / غير معروف");
            const approver = mapping.approvedBy ? (locale === "ar" ? mapping.approvedBy.displayNameAr || mapping.approvedBy.displayNameEn : mapping.approvedBy.displayNameEn) : null;
            const retirer = mapping.retiredBy ? (locale === "ar" ? mapping.retiredBy.displayNameAr || mapping.retiredBy.displayNameEn : mapping.retiredBy.displayNameEn) : null;
            return <tr key={mapping.id}>
              <td><strong>{mapping.analyzerTestCode}</strong></td>
              <td>{mapping.test.code}{mapping.component ? " · " + mapping.component.code : ""}</td>
              <td>{mapping.analyzerUnitCode || tr(locale, "Unitless", "بدون وحدة")} → <strong>{lisUnit}</strong>{mapping.lisUnitUcumCodeSnapshot ? <><br/><small>{tr(locale, "UCUM", "UCUM")}: {mapping.lisUnitUcumCodeSnapshot}</small></> : null}</td>
              <td><SystemDateText value={mapping.effectiveFrom.toISOString()} kind="calendar-record" /> → {mapping.effectiveTo ? <SystemDateText value={mapping.effectiveTo.toISOString()} timeZone={item.branch.timezone} /> : tr(locale, "Open", "مفتوح")}</td>
              <td><strong>{mapping.approvalStatus === "APPROVED" ? tr(locale, "Approved", "معتمد") : mapping.approvalStatus === "RETIRED" ? tr(locale, "Retired", "موقوف") : tr(locale, "Draft", "مسودة")}</strong><br/><small>{statusLabel(locale, mapping.status)}</small></td>
              <td><small>{tr(locale, "Created by", "أنشأه")}: {creator}{mapping.approvedAt ? <><br/>{tr(locale, "Approved by", "اعتمده")}: {approver || "—"} · <SystemDateText value={mapping.approvedAt.toISOString()} timeZone={item.branch.timezone} /></> : null}{mapping.retiredAt ? <><br/>{tr(locale, "Retired by", "أوقفه")}: {retirer || "—"} · <SystemDateText value={mapping.retiredAt.toISOString()} timeZone={item.branch.timezone} />{mapping.retirementReason ? " · " + mapping.retirementReason : ""}</> : null}</small></td>
              <td><AnalyzerMappingGovernanceButton analyzerId={item.id} id={mapping.id} approvalStatus={mapping.approvalStatus} canApprove={permissions.has("analyzers.mappings.approve")}
                authorId={mapping.createdByUserId} actorId={session.user.id} locale={locale} /></td>
            </tr>;
          })}</tbody>
        </table></div>
      </article>)}
    </section>
  </main>;
}
