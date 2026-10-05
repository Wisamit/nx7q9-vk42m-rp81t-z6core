import type { Metadata } from "next";
import "./globals.css";
import { SystemShell } from "@/components/system-shell";
import { getCurrentSession, permissionSet } from "@/lib/auth";

export const metadata: Metadata = {
  title: {
    default: "Family Lab LIS",
    template: "%s · Family Lab LIS",
  },
  description: "Multi-branch Laboratory Information System",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getCurrentSession();
  const locale = session?.user.preferredLocale === "ar" ? "ar" : "en";
  const direction = locale === "ar" ? "rtl" : "ltr";

  const body = session ? <SystemShell
    user={{
      displayName: session.user.displayNameAr && locale === "ar"
        ? session.user.displayNameAr
        : session.user.displayNameEn || session.user.displayNameAr || session.user.username,
      organizationName: locale === "ar"
        ? session.user.organization.nameAr || session.user.organization.nameEn
        : session.user.organization.nameEn || session.user.organization.nameAr || session.user.organization.code,
      preferredLocale: locale,
      activeBranchId: session.activeBranchId,
      branches: session.user.branchScopes
        .filter(scope => scope.branch.status === "ACTIVE")
        .map(scope => ({
          id: scope.branch.id,
          code: scope.branch.code,
          name: locale === "ar" ? scope.branch.nameAr || scope.branch.nameEn : scope.branch.nameEn || scope.branch.nameAr || scope.branch.code,
        })),
      permissions: [...permissionSet(session)],
    }}
  >{children}</SystemShell> : children;

  return <html lang={locale} dir={direction}><body>{body}</body></html>;
}
