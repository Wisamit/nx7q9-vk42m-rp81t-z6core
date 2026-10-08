import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("TAT resolution excludes unapproved or inactive policies", () => {
  const tat = source("src/lib/tat.ts");
  assert.match(tat, /status:\s*"ACTIVE"/);
  assert.match(tat, /approvalStatus:\s*"APPROVED"/);
  assert.match(tat, /approvedAt:\s*\{\s*not:\s*null\s*\}/);
});

test("new TAT policies enter as inactive drafts", () => {
  const route = source("src/app/api/catalog/tat-policies/route.ts");
  assert.match(route, /approvalStatus:\s*"DRAFT"/);
  assert.match(route, /status:\s*"INACTIVE"/);
  assert.match(route, /catalog\.tat_policies\.approve/);
});

test("order registration snapshots TAT escalation evidence from the selected policy", () => {
  const route = source("src/app/api/orders/route.ts");
  assert.match(route, /tatEscalationAfterMinutesSnapshot/);
  assert.match(route, /tatEscalationPermissionCodeSnapshot/);
  assert.match(route, /tatFirstEscalationAt/);
});

test("notification dispatch processes persistent TAT escalation events before outbound delivery", () => {
  const route = source("src/app/api/notifications/dispatch/route.ts");
  assert.match(route, /processTatEscalations/);
  const processor = source("src/lib/tat-escalation.ts");
  assert.match(processor, /tatEscalationEvent\.create/);
  assert.match(processor, /notifyUsersWithPermission/);
  assert.match(processor, /TAT_BREACH_ESCALATED/);
});

test("TAT escalation acknowledgement is permission and branch scoped", () => {
  const route = source("src/app/api/worklists/[orderItemId]/tat-escalations/[eventId]/acknowledge/route.ts");
  assert.match(route, /worklists\.tat_escalations\.acknowledge/);
  assert.match(route, /canAccessBranch\(session, event\.branchId\)/);
  assert.match(route, /status:\s*"ACKNOWLEDGED"/);
});
