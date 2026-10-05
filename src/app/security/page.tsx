import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { SecuritySettings } from "@/components/security-settings";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const session = await requireSession();
  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Account Security</p>
        <h1>Security Settings</h1>
        <p className="muted">Manage multi-factor authentication for your staff account. Security changes are audit logged.</p>
      </div>
      <Link className="secondary-link" href="/dashboard">Dashboard</Link>
    </header>
    <SecuritySettings
      mfaEnabled={session.user.mfaEnabled}
      mfaConfirmedAt={session.user.mfaConfirmedAt?.toISOString() || null}
    />
  </main>;
}
