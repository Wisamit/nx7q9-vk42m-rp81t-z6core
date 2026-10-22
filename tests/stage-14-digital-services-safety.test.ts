import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const file = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("appointment and home collection status workflows lock the same appointment", () => {
  const appointment = file("../src/app/api/appointments/[id]/status/route.ts");
  const visit = file("../src/app/api/home-collections/[id]/route.ts");
  for (const s of [appointment, visit]) {
    assert.ok(s.includes("SELECT id FROM appointments"));
    assert.ok(s.includes("FOR UPDATE"));
    assert.ok(s.includes('isolationLevel: "Serializable"'));
    assert.ok(s.includes("updateMany"));
    assert.ok(s.includes("tx.auditEvent.create"));
  }
  assert.ok(appointment.indexOf("SELECT id FROM appointments") < appointment.indexOf("tx.homeCollectionVisit.findUnique"));
  assert.ok(visit.indexOf("SELECT id FROM appointments") < visit.indexOf("tx.homeCollectionVisit.findUniqueOrThrow"));
  assert.ok(appointment.includes("HOME_COLLECTION_ALREADY_STARTED"));
  assert.ok(appointment.includes("HOME_COLLECTION_NOT_DELIVERED"));
  assert.ok(visit.includes("SPECIMEN_CUSTODY_ALREADY_STARTED"));
  assert.ok(visit.includes('"APPOINTMENT_NOT_ACTIVE"'));
  assert.ok(visit.includes('"APPOINTMENT_NOT_READY"'));
});

test("queue issuing and check-in hold the appointment lock while ticket status uses CAS", () => {
  const issue = file("../src/app/api/queue/route.ts");
  const status = file("../src/app/api/queue/[id]/status/route.ts");
  assert.ok(issue.indexOf("SELECT id FROM appointments") < issue.indexOf("tx.queueTicket.create"));
  assert.ok(issue.includes('"APPOINTMENT_NOT_READY_FOR_QUEUE"'));
  assert.ok(issue.includes('isolationLevel: "Serializable"'));
  assert.ok(issue.includes('["P2002", "P2034"]'));
  assert.ok(status.includes("tx.queueTicket.updateMany"));
  assert.ok(status.includes("updatedAt: ticket.updatedAt"));
  assert.ok(status.includes("changed.count !== 1"));
});

test("corporate portal never discloses appointments of another portal identity", () => {
  const page = file("../src/app/portal/page.tsx");
  const book = file("../src/app/api/portal/appointments/route.ts");
  assert.ok(page.includes("portalAccountId: account.id, patientId: { in: allowedPatientIds }"));
  assert.ok(page.includes("const scopes = corporatePortalPatientScopes(access)"));
  assert.ok(page.includes("bookingPatientIds = scopes.bookingPatientIds"));
  assert.ok(page.includes("reportPatientIds = scopes.reportPatientIds"));
  assert.ok(page.includes("patientId: { in: reportPatientIds }"));
  assert.ok(!page.includes("bookingPatientIds = access.filter(item => item.canBook)"));
  assert.ok(page.includes("id: { in: bookingPatientIds }"));
  assert.ok(book.includes("canBook: true"));
  assert.ok(book.includes("organizationId: account.organizationId"));
});

test("portal login and administrative disabling serialize account sessions", () => {
  const login = file("../src/app/api/portal/auth/login/route.ts");
  const admin = file("../src/app/api/portal-accounts/[id]/status/route.ts");
  assert.equal((login.match(/SELECT id FROM portal_accounts/g) || []).length, 2);
  assert.ok(admin.includes("SELECT id FROM portal_accounts"));
  assert.ok(login.includes('current.status === "DISABLED"'));
  assert.ok(login.includes("current.passwordHash !== account.passwordHash"));
  assert.ok(login.indexOf("SELECT id FROM portal_accounts", login.indexOf("const token = newPortalToken()"))
    < login.indexOf("tx.portalSession.create"));
  assert.ok(admin.indexOf("SELECT id FROM portal_accounts") < admin.indexOf("tx.portalSession.updateMany"));
});
