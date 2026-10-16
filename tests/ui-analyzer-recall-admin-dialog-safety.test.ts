import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(file, "utf8");

test("UI #265: analyzer assignment and removal are explicit scoped, auditable, compact dialogs", () => {
  const ui = read("src/components/analyzer-routing-control.tsx");
  assert.equal((ui.match(/<CrudModal\b/g) || []).length, 2);
  assert.equal((ui.match(/<form\b/g) || []).length, 2);
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes("open={assignOpen}"));
  assert.ok(ui.includes("open={removeTarget !== null}"));
  assert.ok(ui.includes('onSubmit={assign}'));
  assert.ok(ui.includes('onSubmit={clear}'));
  assert.ok(ui.includes("assignedIds.has(item.id)"));
  assert.ok(ui.includes("availableCandidates.some(item => item.id === selectedAnalyzerId)"));
  assert.ok(ui.includes("assigned.some(item => item.analyzerId === removeTarget.analyzerId)"));
  assert.ok(ui.includes("if (busy || !canRoute"));
  assert.ok(ui.includes('method: "POST"'));
  assert.ok(ui.includes('method: "DELETE"'));
  assert.ok(ui.includes('body: JSON.stringify({ analyzerId, reason })'));
  assert.ok(ui.includes('name="reason"'));
  assert.ok(ui.includes("if (!response.ok)"));
  assert.ok(ui.includes("catch {"));
  assert.doesNotMatch(ui, /(?:window\.)?(?:prompt|confirm)\s*\(/);

  const api = read("src/app/api/worklists/[orderItemId]/analyzers/route.ts");
  assert.ok(api.includes("orderItemAnalyzerRouteEvent.create"));
  assert.ok(api.includes("reason"));
});

test("UI #265: analyzer replay asks for deliberate review and never mutates raw payload", () => {
  const ui = read("src/components/analyzer-message-replay-button.tsx");
  assert.equal((ui.match(/<CrudModal\b/g) || []).length, 1);
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes("open={open}"));
  assert.ok(ui.includes('onSubmit={replay}'));
  assert.ok(ui.includes('/api/analyzers/messages/'));
  assert.ok(ui.includes('method: "POST"'));
  assert.ok(ui.includes("original raw payload"));
  assert.ok(ui.includes("if (!response.ok)"));
  assert.ok(ui.includes("catch {"));
  assert.doesNotMatch(ui, /(?:window\.)?(?:prompt|confirm)\s*\(/);

  const api = read("src/app/api/analyzers/messages/[id]/replay/route.ts");
  assert.ok(api.includes("analyzer_message_replay_state_changed"));
  assert.ok(api.includes('requirePermission("analyzers.replay")'));
});

test("UI #265: recalled lot quality nonconformance is created through explicit restricted modal", () => {
  const ui = read("src/components/recall-quality-case-manager.tsx");
  assert.ok(ui.includes('canCreate&&safetyEventId?<>'));
  assert.ok(ui.includes('open={open}'));
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes("if(!busy)setOpen(false)"));
  assert.ok(ui.includes('name="severity"'));
  assert.ok(ui.includes('name="description" minLength={30}') ||
    ui.includes('name="description"'));
  assert.ok(ui.includes('name="title" minLength={15}'));
  assert.ok(ui.includes('onSubmit={e=>void submit(e)}'));
  assert.ok(ui.includes('setOpen(false)'));
  assert.ok(ui.includes('body:JSON.stringify({lotId,safetyEventId,title:form.get("title")'));
  assert.doesNotMatch(ui, /(?:window\.)?(?:prompt|confirm)\s*\(/);
});

test("UI #265: already-modal staff password reset no longer stacks native confirmation", () => {
  const ui = read("src/components/user-management.tsx");
  assert.ok(ui.includes('open={Boolean(resetting)}'));
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes('onSubmit={e => void resetStaffPassword(e)}'));
  assert.ok(ui.includes('name="actorPassword"'));
  assert.ok(ui.includes('name="newPassword"'));
  assert.ok(ui.includes('name="confirmPassword"'));
  assert.ok(ui.includes('name="reason" minLength={10}'));
  assert.ok(ui.includes("revokes ALL target sessions"));
  assert.ok(ui.includes("user.id !== currentUserId"));
  assert.ok(ui.includes('setResetError('));
  assert.doesNotMatch(ui, /(?:window\.)?(?:prompt|confirm)\s*\(/);
  const api = read("src/app/api/admin/users/[id]/reset-password/route.ts");
  assert.ok(api.includes("STAFF_PASSWORD_ADMIN_RESET"));
});

test("UI #265: new analyzer mapping dates are selected explicitly by branch operators, not silently UTC-defaulted", () => {
  const analyzer = read("src/components/analyzer-manager.tsx");
  assert.ok(analyzer.includes('name="effectiveFrom" type="date" required'));
  assert.ok(analyzer.includes('Effective from (select local branch date)'));
  assert.ok(analyzer.includes('ساري من (اختر تاريخ الفرع المحلي)'));
  assert.ok(!analyzer.includes('defaultValue={new Date().toISOString().slice(0,10)}'),
    "UTC midnight must not silently select the wrong local effective date");
  assert.ok(analyzer.includes('name="effectiveTo" type="date"'));
});
