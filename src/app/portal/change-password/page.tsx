import { redirect } from "next/navigation";
import { getCurrentPortalSession } from "@/lib/portal-auth";
import { PortalChangePasswordForm } from "@/components/portal-change-password-form";

export const dynamic = "force-dynamic";

export default async function PortalChangePasswordPage() {
  const session = await getCurrentPortalSession();
  if (!session) redirect("/portal/login");
  if (!session.portalAccount.mustChangePassword) redirect("/portal");

  return <main className="catalog-shell">
    <section className="detail-card" style={{ maxWidth: 520, margin: "64px auto" }}>
      <p className="eyebrow">First sign in</p>
      <h1>Change your password</h1>
      <p className="muted">Replace the temporary password before accessing portal data.</p>
      <PortalChangePasswordForm />
    </section>
  </main>;
}
