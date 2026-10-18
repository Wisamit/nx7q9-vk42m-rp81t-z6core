import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { summarizeWebhookDispatch } from "../src/lib/webhook-dispatch-outcome.ts";

const source = (path: string) => readFileSync(path, "utf8");

test("external webhook dispatch returns truthful per-delivery outcomes, not generic success", () => {
  assert.deepEqual(summarizeWebhookDispatch({ status: "ok", attempted: 0, results: [] }), {
    kind: "empty", attempted: 0, httpAccepted: 0, failed: 0,
    deadLetter: 0, errors: 0, skipped: 0,
  });
  assert.deepEqual(summarizeWebhookDispatch({ status: "ok", attempted: 2, results: [
    { id: "a", status: "DELIVERED", attemptCount: 1 },
    { id: "b", status: "DELIVERED", attemptCount: 2 },
  ] }), { kind: "http_accepted", attempted: 2, httpAccepted: 2, failed: 0,
    deadLetter: 0, errors: 0, skipped: 0 });
  assert.deepEqual(summarizeWebhookDispatch({ status: "ok", attempted: 5, results: [
    { id: "a", status: "DELIVERED" },
    { id: "b", status: "FAILED" },
    { id: "c", status: "DEAD_LETTER" },
    { id: "d", status: "DISPATCH_ERROR" },
    { id: "e", status: "SKIPPED_CONCURRENT_CLAIM" },
  ] }), { kind: "partial", attempted: 5, httpAccepted: 1, failed: 1,
    deadLetter: 1, errors: 1, skipped: 1 });
});

test("unknown, inconsistent or inflated dispatch response fails closed", () => {
  const invalid: unknown[] = [
    null, {}, [], "ok",
    { status: "failed", attempted: 0, results: [] },
    { status: "ok", attempted: -1, results: [] },
    { status: "ok", attempted: 1.5, results: [] },
    { status: "ok", attempted: Number.POSITIVE_INFINITY, results: [] },
    { status: "ok", attempted: 21, results: Array(21).fill({ id: "same", status: "DELIVERED" }) },
    { status: "ok", attempted: 2, results: [{ id: "a", status: "DELIVERED" }] },
    { status: "ok", attempted: 1, results: "not-array" },
    { status: "ok", attempted: 1, results: [null] },
    { status: "ok", attempted: 1, results: [{ id: "", status: "DELIVERED" }] },
    { status: "ok", attempted: 1, results: [{ id: "a", status: "UNKNOWN" }] },
    { status: "ok", attempted: 2, results: [{ id: "a", status: "DELIVERED" }, { id: "a", status: "FAILED" }] },
    { status: "ok", attempted: 1, results: [{ id: "a", status: "FAILED", attemptCount: -3 }] },
    { status: "ok", attempted: 1, results: [{ id: "a", status: "DELIVERED", attemptCount: "one" }] },
  ];
  for (const value of invalid) assert.deepEqual(summarizeWebhookDispatch(value), { kind: "invalid" },
    "Expected rejection: " + JSON.stringify(value)?.slice(0,160));
});

test("integration dispatch requires compact explicit confirmation and cannot replay uncertain network POST", () => {
  const ui = source("src/components/integration-manager.tsx");
  assert.ok(ui.includes('import { summarizeWebhookDispatch } from "@/lib/webhook-dispatch-outcome"'));
  assert.ok(ui.includes('const [dispatchOpen, setDispatchOpen] = useState(false)'));
  assert.ok(ui.includes('const [dispatchUncertain, setDispatchUncertain] = useState(false)'));
  assert.ok(ui.includes('if (!canReplay || !dispatchOpen || dispatchUncertain || submitting.current || busy) return'));
  assert.ok(ui.includes('setDispatchUncertain(true)'));
  assert.ok(!ui.includes('setDispatchUncertain(false)'),
    "A POST that reached the receiver must not be resubmitted by closing/reopening the modal.");
  assert.ok(ui.includes('<CrudModal open={dispatchOpen}'));
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes('onSubmit={dispatch}'));
  assert.ok(ui.includes('Review Due Webhook Dispatch'));
  assert.ok(ui.includes('Confirm external dispatch'));
  assert.ok(ui.includes('onClick={() => setDispatchOpen(false)}'));
  assert.ok(ui.includes('disabled={busy !== "" || dispatchUncertain}'));
  assert.ok(ui.includes('disabled={Boolean(busy) || dispatchUncertain}'));
  assert.ok(ui.includes('if (!submitting.current && !busy) setDispatchOpen(false)'));
  assert.ok(ui.includes('response.ok ? summarizeWebhookDispatch(body)'));
  assert.ok(ui.includes('outcome.kind === "invalid"'));
  assert.ok(ui.includes('outcome.kind === "partial"'));
  assert.ok(ui.includes('outcome.kind === "empty"'));
  assert.ok(ui.includes('setIsError(outcome.kind === "partial")'));
  assert.ok(ui.includes('submitting.current = false;'));
  assert.ok(ui.includes('setBusy("");'));
  assert.ok(ui.includes('x-family-lab-delivery-id'));
  assert.ok(ui.includes('Provider processing/clinical receipt is NOT verified'));
  assert.ok(ui.includes('role="alert"'));
  assert.ok(ui.includes('role="status"'));
  assert.doesNotMatch(ui, /onClick=\{\(\) => void dispatch\(\)\}/);
  assert.doesNotMatch(ui, /\b(?:window\.)?(?:confirm|prompt)\s*\(/);
});

test("dispatch server still limits live external transmissions by replay permission, branch, due queue, 20 and CAS", () => {
  const api = source("src/app/api/integrations/webhooks/dispatch/route.ts");
  const sender = source("src/lib/webhook-delivery.ts");
  for (const invariant of [
    'requirePermission("integrations.replay")',
    'organizationId: session.user.organizationId',
    'canAccessBranch(session, item.subscription.endpoint.branchId)',
    'take: deliveryId ? 1 : 20',
    'dispatchWebhookDelivery(item.id)',
    'WEBHOOK_DISPATCH_RUN',
    'attempted: due.length, results',
  ]) assert.ok(api.includes(invariant), invariant);
  for (const safety of [
    "At-least-once delivery", "x-family-lab-delivery-id",
    'status: "SENT"', "updateMany", "report_version_superseded_or_retracted",
    "DEAD_LETTER", "safeOutboundUrl",
  ]) assert.ok(sender.includes(safety), safety);
  const docs = source("docs/UI_WEBHOOK_MANUAL_DISPATCH_REVIEW_CLOSURE.md");
  assert.ok(docs.includes("Issue #265 OPEN"));
  assert.ok(docs.includes("Issue #250 NO_GO"));
  assert.ok(docs.includes("NOT_EXECUTED"));
});
