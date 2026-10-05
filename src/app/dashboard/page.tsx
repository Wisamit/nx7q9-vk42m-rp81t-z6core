import { LogoutButton } from "@/components/logout-button";
import { permissionSet, requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireSession();
  const permissions = permissionSet(session);
  const user = session.user;
  const branch = session.activeBranch;

  return (
    <main className="dashboard-shell" dir="rtl">
      <header className="topbar">
        <div><strong>Family Lab LIS</strong><span>{user.organization.nameAr || user.organization.nameEn}</span></div>
        <div className="topbar-actions"><span>{user.displayNameAr || user.displayNameEn}</span><LogoutButton /></div>
      </header>
      <section className="dashboard-content">
        <div className="welcome-card">
          <p className="eyebrow">لوحة التحكم</p>
          <h1>مرحبًا، {user.displayNameAr || user.displayNameEn}</h1>
          <p className="muted">الفرع الحالي: <strong>{branch?.nameAr || branch?.nameEn || "—"}</strong></p>
        </div>
        <div className="module-grid">
          <article><span>01</span><h2>المؤسسة والفروع</h2><p>{permissions.has("branches.manage") ? "إدارة الفروع وإعداداتها." : "عرض الفروع المصرح بها."}</p></article>
          <article><span>02</span><h2>المستخدمون والصلاحيات</h2><p>صلاحيات مبنية على الأدوار ونطاقات الفروع.</p></article>
          <article><span>03</span><h2>سجل التدقيق</h2><p>تتبع العمليات الأمنية والتغييرات المهمة.</p></article>
          <article className="coming"><span>04</span><h2>دليل الفحوصات</h2><p>المرحلة التالية: Test Catalog configuration.</p></article>
        </div>
      </section>
    </main>
  );
}
