import { PortalLoginForm } from "@/components/portal-login-form";

export const dynamic = "force-dynamic";

export default function PortalLoginPage() {
  return <main className="catalog-shell">
    <section className="detail-card" style={{ maxWidth: 520, margin: "64px auto" }}>
      <p className="eyebrow">Family Lab</p>
      <h1>Portal Sign In</h1>
      <p className="muted">Secure access for patients, doctors and corporate clients.</p>
      <PortalLoginForm />
    </section>
  </main>;
}
