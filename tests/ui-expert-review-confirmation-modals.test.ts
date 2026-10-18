import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (file: string) => readFileSync("src/components/" + file + ".tsx", "utf8");
const expert = source("catalog-expert-review-queue");
const drift = source("catalog-bundle-drift-review");
const policy = source("catalog-policy-draft-review-queue");

test("all nonbinding expert-audit mutations require compact RTL-compatible dialog confirmation", () => {
  for (const [name, src] of [["expert",expert],["drift",drift],["policy",policy]] as const) {
    assert.match(src,/import \{ CrudModal \} from "@\/components\/crud-modal";/,name);
    assert.match(src,/<CrudModal open=\{/,name);
    assert.match(src,/size="compact"/,name);
    assert.match(src,/crud-modal-actions/,name);
    assert.match(src,/tr\("Cancel", "إلغاء"\)/,name);
    assert.match(src,/disabled=\{busy/,name);
    assert.match(src,/role="alert"/,name);
    assert.match(src,/credentials: "same-origin"/,name);
    assert.match(src,/liveWrites !== false/,name);
  }
});

test("expert reviewer stages intended decision locally; both dispositions submit only from confirmation", () => {
  assert.match(expert,/type Decision = "CONFIRM_FINDING" \| "RETURN_FOR_CORRECTION"/);
  assert.match(expert,/setPending\(\{ entry, disposition: "CONFIRM_FINDING" \}\)/);
  assert.match(expert,/setPending\(\{ entry, disposition: "RETURN_FOR_CORRECTION" \}\)/);
  assert.doesNotMatch(expert,/onClick=\{\(\) => void decide\(entry,/);
  assert.match(expert,/onClick=\{\(\) => void decide\(pending\.entry, pending\.disposition\)\}/);
  assert.match(expert,/pending\.entry\.flagEventId !== entry\.flagEventId/);
  assert.match(expert,/pending\.disposition !== disposition/);
  assert.match(expert,/inspections\[entry\.flagEventId\] !== "READY"/);
  assert.match(expert,/setInspections\(previous => \(\{ \.\.\.previous, \[entry\.flagEventId\]: "CONFLICT" \}\)\)/);
  assert.match(expert,/setPending\(null\)/);
  assert.match(expert,/EXPERT_DECISION_RECORDED/);
  assert.match(expert,/EXPERT_DECISION_ALREADY_RECORDED/);
  assert.match(expert,/approved !== false/);
  assert.match(expert,/activated !== false/);
  assert.match(expert,/Review disposition recorded\. No configuration was approved or activated/);
  assert.match(expert,/تأكيد الملاحظة \(ليس اعتماداً\)/);
  assert.match(expert,/Confirm finding \(NOT approval\)/);
});

test("drift referral modal discloses row, observation and field NAMES only before explicit submit", () => {
  assert.match(drift,/setPendingReferral\(row\)/);
  assert.doesNotMatch(drift,/onClick=\{\(\) => void flag\(row\)\}/);
  assert.match(drift,/onClick=\{\(\) => void flag\(pendingReferral\)\}/);
  assert.match(drift,/pendingReferral\.observationToken !== row\.observationToken/);
  assert.match(drift,/row\.finding\.canRefer !== true/);
  assert.match(drift,/rowNumber: row\.rowNumber, observationToken: row\.observationToken, reasonCode/);
  assert.match(drift,/pendingReferral\.changedFields\.join\(", "\)/);
  assert.match(drift,/Field names only/);
  assert.doesNotMatch(drift,/JSON\.stringify\(\{\s*sourceData:/);
  assert.match(drift,/FLAGGED_FOR_EXPERT_REVIEW/);
  assert.match(drift,/ALREADY_FLAGGED_FOR_EXPERT_REVIEW/);
  assert.match(drift,/setPendingReferral\(null\);\s*setNotice/);
  assert.match(drift,/await load\(cursor, history\)/);
  assert.match(drift,/\/\/ A successful referral refreshes its source page while flagging is still set/);
  assert.match(drift,/This creates a review flag only\. Nothing is approved, released or changed/);
});

test("policy review moves the full unsigned proposal and objection into an accessible modal", () => {
  assert.match(policy,/open=\{selected !== null\}/);
  assert.match(policy,/size="compact" protectUnsavedChanges/);
  assert.match(policy,/role="alert"/);
  assert.match(policy,/recording = useRef\(false\)/);
  assert.match(policy,/if \(!selected \|\| busy \|\| recording\.current\) return/);
  assert.match(policy,/recording\.current = true/);
  assert.match(policy,/recording\.current = false/);
  assert.match(policy,/selected\.detail\.proposal\[key\]/);
  assert.match(policy,/policyKeys\.map\(key =>/);
  assert.match(policy,/reasonByDomain\[selected\.domain\]/);
  assert.match(policy,/disposition === "NOTED_FOR_DISCUSSION"/);
  assert.match(policy,/NO_FURTHER_OBJECTION_TO_DISCUSSION/);
  assert.match(policy,/Record nonbinding review in Audit/);
  assert.match(policy,/onClick=\{\(\) => void record\(\)\}/);
  assert.match(policy,/result\.approved !== false/);
  assert.match(policy,/result\.signingEnabled !== false/);
  assert.match(policy,/result\.activated !== false/);
  assert.match(policy,/result\.liveWrites !== false/);
  assert.match(policy,/NOT SIGNING/);
  assert.match(policy,/دون توقيع أو اعتماد أو تفعيل/);
  assert.doesNotMatch(policy,/window\.confirm\(/);
});

test("the shared portal dialog retains keyboard and unsaved-state safety and honest non-acceptance status", () => {
  const modal = source("crud-modal");
  const css=readFileSync("src/app/globals.css","utf8");
  assert.match(modal,/createPortal\(/);
  assert.match(modal,/aria-modal="true"/);
  assert.match(modal,/event\.key === "Escape"/);
  assert.match(modal,/event\.key !== "Tab"/);
  assert.match(modal,/onFocusIn/);
  assert.match(modal,/previouslyFocused\.focus/);
  assert.match(modal,/protectUnsavedChanges/);
  assert.match(css,/\.crud-modal-compact\{width:min\(33\.333vw,520px\)/);
  const manifest=JSON.parse(readFileSync("docs/UI_ROUTE_MANIFEST.json","utf8"));
  assert.equal(manifest.routes.length,81);
  const docs=readFileSync("docs/UI_EXPERT_REVIEW_CONFIRMATION_DIALOGS.md","utf8");
  assert.match(docs,/NOT_EXECUTED/);
  assert.match(docs,/NO_GO/);
});
