import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultReportReadyMessage,
  maskedDestination,
  renderReportTemplate,
  resolveVerifiedPortalDestination,
} from "../src/lib/report-outbound.ts";

const active = {
  status: "ACTIVE",
  contactVerifiedAt: new Date("2026-10-07T00:00:00Z"),
  emailVerifiedAt: new Date("2026-10-07T00:00:00Z"),
  phoneVerifiedAt: new Date("2026-10-07T00:00:00Z"),
  email: "patient@example.com",
  phone: "+971501234567",
  preferredLocale: "en",
  contactVerifications: [
    {
      channel: "EMAIL" as const,
      destinationSnapshot: "patient@example.com",
      revokedAt: null,
    },
    {
      channel: "PHONE" as const,
      destinationSnapshot: "+971501234567",
      revokedAt: null,
    },
  ],
};

test("report outbound requires active destination-bound portal verification", () => {
  assert.equal(resolveVerifiedPortalDestination(null, "EMAIL").ok, false);
  assert.equal(resolveVerifiedPortalDestination({ ...active, status: "LOCKED" }, "EMAIL").ok, false);
  assert.equal(resolveVerifiedPortalDestination({ ...active, contactVerifications: [] }, "EMAIL").ok, false);
  assert.equal(resolveVerifiedPortalDestination({
    ...active,
    contactVerifications: active.contactVerifications.filter(item => item.channel !== "PHONE"),
  }, "SMS").ok, false);
  assert.equal(resolveVerifiedPortalDestination({
    ...active,
    contactVerifications: active.contactVerifications.filter(item => item.channel !== "PHONE"),
  }, "WHATSAPP").ok, false);
});

test("email and phone channels resolve from verified portal account", () => {
  const email = resolveVerifiedPortalDestination(active, "EMAIL");
  const sms = resolveVerifiedPortalDestination(active, "SMS");
  assert.equal(email.ok && email.destination, "patient@example.com");
  assert.equal(sms.ok && sms.destination, "+971501234567");
});

test("changed portal destination never inherits verification timestamps", () => {
  const changed = {
    ...active,
    email: "new-patient@example.com",
    emailVerifiedAt: new Date("2026-10-07T00:00:00Z"),
  };
  assert.equal(resolveVerifiedPortalDestination(changed, "EMAIL").ok, false);
});

test("revoked destination verification does not authorize delivery", () => {
  const revoked = {
    ...active,
    contactVerifications: active.contactVerifications.map(item =>
      item.channel === "EMAIL" ? { ...item, revokedAt: new Date("2026-10-07T01:00:00Z") } : item
    ),
  };
  assert.equal(resolveVerifiedPortalDestination(revoked, "EMAIL").ok, false);
});

test("report message templates replace only supported context tokens", () => {
  const rendered = renderReportTemplate(
    "Accession {{accessionNumber}} v{{reportVersion}}: {{portalUrl}}",
    {
      recipientName: "A",
      patientName: "A",
      accessionNumber: "ACC-1",
      reportVersion: 3,
      reportStatus: "FINAL",
      portalUrl: "https://lab.example/portal/reports/R1",
    },
  );
  assert.equal(rendered, "Accession ACC-1 v3: https://lab.example/portal/reports/R1");
});

test("default outbound message contains secure portal link but no result values", () => {
  const message = defaultReportReadyMessage("en", "PATIENT", {
    recipientName: "Patient",
    patientName: "Patient",
    accessionNumber: "ACC-1",
    reportVersion: 1,
    reportStatus: "FINAL",
    portalUrl: "https://lab.example/portal/reports/R1",
  });
  assert.match(message.body, /secure portal/i);
  assert.match(message.body, /ACC-1/);
  assert.doesNotMatch(message.body, /reference|critical|hemoglobin/i);
});

test("delivery destinations are masked for audit/UI summaries", () => {
  assert.equal(maskedDestination("EMAIL", "patient@example.com"), "pa***@example.com");
  assert.equal(maskedDestination("SMS", "+971501234567"), "********4567");
});
