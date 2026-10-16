import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const editor = readFileSync("src/components/microbiology-case-editor.tsx", "utf8");
const uiForms = [
  ["updateCulture", "culture"],
  ["addObservation", "observation"],
  ["addIsolate", "isolate"],
] as const;

test("Issue #265: microbiology culture, observation and isolates are scoped compact dialogs", () => {
  assert.equal((editor.match(/<CrudModal\\b/g) || []).length, 3);
  for (const [handler, mode] of uiForms) {
    const needle = '<form className="catalog-form" onSubmit={' + handler + '}>';
    const start = editor.indexOf(needle);
    const modalStart = editor.lastIndexOf("<CrudModal", start);
    const modalEnd = editor.indexOf("</CrudModal>", start);
    assert.ok(start > modalStart && modalStart >= 0 && modalEnd > start,
      handler + " must stay inside its own guarded dialog");
    const header = editor.slice(modalStart, start);
    assert.ok(header.includes('open={editor === "' + mode + '"}'));
    assert.ok(header.includes('size="compact"'));
    assert.ok(header.includes('if (!busy) setEditor(null)'));
    assert.ok(editor.slice(start, modalEnd).includes("</form>"));
  }
  assert.ok(editor.includes('setEditor(null)'));
  assert.ok(editor.includes('errorMessage && <p className="form-error" role="alert"'));
});

test("Issue #265: AST remains a traceable separate clinical workspace rather than blindly squeezed", () => {
  assert.ok(editor.includes('onSubmit={addSusceptibility}'));
  assert.ok(editor.includes('rows.map(row =>'));
  assert.ok(editor.includes('breakpointSnapshot: row.breakpointSnapshot'));
  assert.ok(editor.includes('micValue: row.micValue || null'));
  assert.ok(editor.includes('zoneDiameterMm: row.zoneDiameterMm || null'));
  assert.ok(editor.includes('method: form.get("method")'));
  assert.ok(editor.includes('microbiology_ast_catalog_changed'));
  assert.ok(editor.includes('microbiology_result_submitted_withdraw_before_edit'));
  assert.ok(editor.includes('no_growth_conflicts_with_isolates'));
  assert.ok(editor.includes('specimen_not_ready_for_microbiology'));
});

test("Issue #265: clinical updates never reset a detached synthetic form or dismiss on failed requests", () => {
  assert.ok(editor.includes('const formElement = event.currentTarget;'));
  assert.ok(editor.includes('formElement.reset();'));
  assert.ok(!editor.includes('event.currentTarget.reset()'),
    "event.currentTarget can be null after await in React 19");
  assert.ok(editor.includes('if (busy) return null;'));
  assert.ok(editor.includes('if (!response.ok)'));
  assert.ok(editor.includes('setErrorMessage('));
  assert.ok(editor.includes('catch {'));
  assert.ok(editor.includes('finally {'));
  assert.ok(editor.includes('router.refresh()'));
  assert.ok(editor.includes('if (result) {'));
  const source = readFileSync("src/app/api/microbiology/cases/[id]/route.ts", "utf8");
  assert.ok(source.includes("auditEvent.create"), "Microbiology server mutations remain audited");
});
