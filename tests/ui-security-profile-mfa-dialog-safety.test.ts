import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ui = readFileSync("src/components/security-settings.tsx", "utf8");
const modal = readFileSync("src/components/crud-modal.tsx", "utf8");

test("UI #265: staff password and MFA changes use secure bilingual compact dialogs", () => {
  assert.ok(ui.includes('import { CrudModal } from "@/components/crud-modal"'));
  assert.equal((ui.match(/<CrudModal\b/g) || []).length, 3);
  assert.equal((ui.match(/<form\b/g) || []).length, 4);
  assert.ok(ui.includes('open={passwordOpen}'));
  assert.ok(ui.includes('open={mfaOpen}'));
  assert.ok(ui.includes('open={avatarRemovalOpen}'));
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes('if (!passwordBusy) setPasswordOpen(false)'));
  assert.ok(ui.includes('if (!busy) setAvatarRemovalOpen(false)'));
  assert.doesNotMatch(ui, /\b(?:window\.)?confirm\s*\(/);
  assert.doesNotMatch(ui, /\b(?:window\.)?prompt\s*\(/);
  assert.ok(ui.includes('name="confirmLogout" type="checkbox" required'));
  assert.ok(ui.includes('name="confirmDisable" required'));
  assert.ok(ui.includes('autoComplete="current-password"'));
  assert.ok(ui.includes('autoComplete="new-password"'));
  assert.ok(ui.includes('minLength={12}'));
  assert.ok(ui.includes('newPassword !== confirmPassword'));
  assert.ok(ui.includes('window.location.assign("/login?passwordChanged=1")'));
});

test("UI #265: sensitive MFA enrollment and recovery secrets are only visible in modal and until explicit acknowledgement", () => {
  const modalStart = ui.indexOf('<CrudModal open={mfaOpen}');
  const modalEnd = ui.indexOf('</CrudModal>', modalStart);
  const modalContent = ui.slice(modalStart,modalEnd);
  assert.ok(modalStart >= 0 && modalEnd > modalStart);
  assert.ok(modalContent.includes('enrollment.qrDataUrl'), "MFA QR must not leak into always-visible security page");
  assert.ok(modalContent.includes('enrollment.secret'), "Manual enrollment secret belongs in modal");
  assert.ok(modalContent.includes('recoveryCodes.map(code'), "One-time recovery codes must be in modal only");
  assert.ok(modalContent.includes('onClick={finishRecoveryCodes}'));
  assert.ok(modalContent.includes('I saved the codes'));
  assert.ok(ui.includes('if (recoveryCodes.length) {'));
  assert.ok(ui.includes('setEnrollment(null)'));
  assert.ok(ui.includes('setRecoveryCodes([])'));
  assert.ok(ui.includes('window.location.reload()'));
  assert.ok(ui.includes('role={recoveryCodes.length ? "status" : "alert"}'));
  assert.ok(!ui.slice(modalEnd).includes('recoveryCodes.map(code'),
    "Recovery codes must never be duplicated on a page outside the controlled dialog");
  for (const endpoint of [
    "/api/security/mfa/enroll", "/api/security/mfa/confirm", "/api/security/mfa/disable",
    "/api/security/profile/password",
  ]) assert.ok(ui.includes(endpoint));
});

test("UI #265: security API keeps independent password, session-revocation, MFA and audit guards", () => {
  const routes = {
    password: readFileSync("src/app/api/security/profile/password/route.ts", "utf8"),
    enroll: readFileSync("src/app/api/security/mfa/enroll/route.ts", "utf8"),
    confirm: readFileSync("src/app/api/security/mfa/confirm/route.ts", "utf8"),
    disable: readFileSync("src/app/api/security/mfa/disable/route.ts", "utf8"),
  };
  for (const [name, source] of Object.entries(routes)) {
    assert.ok(source.includes("auditEvent.create"), "Security mutation must be audited: " + name);
    assert.ok(source.includes("requireSession()") || source.includes("getCurrentSession()"),
      "Security route requires session: " + name);
  }
  assert.ok(routes.password.includes("sessionsRevoked: true"));
  assert.ok(routes.password.includes("passwordChangedAt"));
  assert.ok(routes.enroll.includes("mfaPendingSecretEncrypted"));
  assert.ok(routes.enroll.includes("MFA_ENROLLMENT_STARTED"));
  assert.ok(routes.confirm.includes("hashRecoveryCodes(recoveryCodes)"));
  assert.ok(routes.confirm.includes("MFA_ENABLED"));
  assert.ok(routes.disable.includes("MFA_DISABLED"));
  assert.ok(routes.disable.includes("revokedAt: new Date()"));
});

test("UI #265: shared modal replaces unstyled confirmation and restores focus safely", () => {
  assert.doesNotMatch(modal, /window\.confirm/);
  assert.ok(modal.includes('role="alertdialog"'));
  assert.ok(modal.includes('aria-modal="true"'));
  assert.ok(modal.includes('if (discardOpenRef.current) cancelDiscard()'));
  assert.ok(modal.includes('const trap = discardOpenRef.current ? discardRef.current : dialog'));
  assert.ok(modal.includes('closeRef.current()'));
  assert.ok(modal.includes('<OpenCrudModal {...props} />'));
});
