import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("UI #265: all final microbiology lifecycle actions require guarded review instead of native prompts",()=>{
 const ui=readFileSync("src/components/microbiology-final-workflow.tsx","utf8");
 assert.ok(ui.includes('import { CrudModal } from "@/components/crud-modal";'));
 assert.ok(ui.includes('open={editorOpen}'));
 assert.ok(ui.includes('open={reviewAction!==null}'));
 assert.equal((ui.match(/<CrudModal\b/g)||[]).length,2);
 assert.ok(ui.includes('size="compact"'));
 assert.ok(ui.includes('editorOpen&&<form className="catalog-form" onSubmit={submitFinal}'));
 assert.ok(ui.includes('if(!busy)setReviewAction(null)'));
 assert.ok(ui.includes('setReviewAction("WITHDRAW")'));
 assert.ok(ui.includes('setReviewAction("VERIFY")'));
 assert.ok(ui.includes('setReviewAction("RELEASE")'));
 assert.doesNotMatch(ui,/(?:window\.)?(?:prompt|confirm)\s*\(/);
 assert.ok(ui.includes('if (!resultId || busy || reviewAction !== "RELEASE") return'));
});

test("UI #265: microbiology final result stays versioned with QC and validation holds",()=>{
 const ui=readFileSync("src/components/microbiology-final-workflow.tsx","utf8");
 assert.ok(ui.includes('/submit-final'));
 assert.ok(ui.includes('/withdraw-final'));
 assert.ok(ui.includes('"/api/results/" + resultId + "/verify"'));
 assert.ok(ui.includes('"/api/results/" + resultId + "/release"'));
 assert.ok(ui.includes('confirmDeltaWarnings:false'));
 assert.ok(ui.includes("validation_hold_review_required"));
 assert.ok(ui.includes("reflex_review_required"));
 assert.ok(ui.includes("microbiology_result_version_conflict"));
 assert.ok(ui.includes("no_growth_conflicts_with_isolates"));
 assert.ok(ui.includes("creates an immutable diagnostic report version"));
 assert.ok(ui.includes("Check for a released report/version before retrying"));
 assert.ok(ui.includes("finally {setBusy(\"\");}")||ui.includes("finally { setBusy(\"\"); }"));
 const releaseApi=readFileSync("src/app/api/results/[id]/release/route.ts","utf8");
 assert.ok(releaseApi.includes("auditEvent")||releaseApi.includes("reportVersion"));
});
