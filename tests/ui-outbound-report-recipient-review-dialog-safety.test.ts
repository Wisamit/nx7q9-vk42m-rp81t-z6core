import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ui = readFileSync("src/components/report-outbound-delivery.tsx", "utf8");
const outbound = readFileSync("src/app/api/reports/[versionId]/outbound/route.ts", "utf8");
const contact = readFileSync("src/app/api/portal-accounts/[id]/verify-contact/route.ts", "utf8");

test("UI #265: portal contact verification requires documented independent identity evidence in compact review", () => {
  assert.ok(ui.includes("pending.kind===\"verify\""));
  assert.ok(ui.includes("requestVerification(candidate.channel)"));
  assert.ok(ui.includes('name="reason"'));
  assert.ok(ui.includes("verificationCandidates.find"));
  assert.ok(ui.includes("destinationMasked"));
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes('onSubmit={pending.kind==="verify"?verifyContact:queueDelivery}'));
  assert.ok(ui.includes("portalAccountId}/verify-contact"));
  assert.ok(ui.includes("if (!selectedRecipient || !canVerifyContacts || busy) return;"));
  assert.ok(ui.includes("setReviewError("));
  assert.doesNotMatch(ui, /(?:window\.)?(?:prompt|confirm)\s*\(/);
  assert.ok(contact.includes('requirePermission("portal_accounts.manage")'));
  assert.ok(contact.includes("maskedDestination("));
  assert.ok(contact.includes("verifiedByUserId"));
  assert.ok(contact.includes("tx.auditEvent.create"));
});

test("UI #265: secure report notification queue checks an exact snapshotted recipient/channel before posting", () => {
  assert.ok(ui.includes('kind:"deliver";recipient:RecipientOption;channel:Channel'));
  assert.ok(ui.includes('setPending({kind:"deliver",recipient:selectedRecipient,channel})'));
  assert.ok(ui.includes("pending.recipient.channels.some(item=>item.channel===pending.channel)"));
  assert.ok(ui.includes('body:JSON.stringify({recipientType:destination.type,channel:deliveryChannel})'));
  assert.ok(ui.includes("pending.recipient.label"));
  assert.ok(ui.includes('role="alert"'));
  assert.ok(ui.includes("report_delivery_already_pending_or_sent"));
  assert.ok(ui.includes("retracted_report_cannot_be_delivered"));
  assert.ok(ui.includes("superseded_report_cannot_be_delivered"));
  assert.ok(ui.includes("This external message contains no result values") ||
    ui.includes("external message contains no result values"));
  assert.ok(outbound.includes('requirePermission("reports.deliver")'));
  assert.ok(outbound.includes("resolveVerifiedPortalDestination("));
  assert.ok(outbound.includes("maskedDestination("));
  assert.ok(outbound.includes("tx.auditEvent.create"));
});
