import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const result = readFileSync("src/components/result-layout-manager.tsx", "utf8");
const server = readFileSync("src/app/api/catalog/result-layout/route.ts", "utf8");
const question = readFileSync("src/components/order-question-manager.tsx", "utf8");

test("Issue #265: result layout section, component and assignment forms all live in compact dialogs", () => {
  const handlers = [
    "saveLayout", "createSection", "updateSectionPresentation",
    "updateComponentPresentation", "assignComponent",
  ];
  assert.ok(result.includes('import { CrudModal } from "@/components/crud-modal"'));
  assert.equal((result.match(/<CrudModal\b/g) || []).length, 6);
  assert.equal((result.match(/<form\b/g) || []).length, 6);
  for (const handler of handlers) {
    const needle = 'onSubmit={' + handler + '}>';
    const formAt = result.indexOf(needle);
    const modalAt = result.lastIndexOf("<CrudModal", formAt);
    const closedAt = result.indexOf("</CrudModal>", formAt);
    assert.ok(formAt > modalAt && closedAt > formAt, handler + " must be under a modal");
    assert.ok(result.slice(modalAt, formAt).includes('size="compact"'), handler);
    assert.ok(result.slice(modalAt, formAt).includes("uiEditor === "), handler);
  }
  assert.ok(result.includes('open={statusReview !== null}'));
  assert.ok(result.includes('onSubmit={setSectionStatus}'));
  assert.ok(!/\bconfirm\s*\(/.test(result));
});

test("Issue #265: historical clinical report layout snapshots and section status stay server validated", () => {
  for (const key of [
    '"SET_LAYOUT"', '"CREATE_SECTION"', '"ASSIGN_COMPONENT"',
    '"UPDATE_SECTION_PRESENTATION"', '"UPDATE_COMPONENT_PRESENTATION"',
    '"SET_SECTION_STATUS"',
  ]) assert.ok(result.includes(key), key + " lost from UI");
  assert.ok(result.includes('sectionId: presentationSectionId'));
  assert.ok(result.includes('componentId: presentationComponentId'));
  assert.ok(result.includes("entryWidth,"));
  assert.ok(result.includes("reportNameEn,"));
  assert.ok(result.includes("reportNameAr,"));
  assert.ok(result.includes("reportDisplayOrder,"));
  assert.ok(result.includes("reportVisible,"));
  assert.ok(result.includes("router.refresh()"));
  assert.ok(result.includes("if (!response.ok)"));
  assert.ok(result.includes("} catch {"));
  assert.ok(result.includes("} finally {"));
  assert.ok(server.includes('requirePermission("catalog.manage")'));
  assert.ok(server.includes("auditEvent"));
});

test("Issue #265: effective-dated order question editor preserves prior order answers and requires explicit local date", () => {
  assert.ok(question.includes('import { CrudModal } from "@/components/crud-modal"'));
  assert.ok(question.includes('open={open}'));
  assert.ok(question.includes('size="compact"'));
  assert.ok(question.includes('open && <form className="catalog-form" onSubmit={submit}'));
  assert.ok(question.includes('<SystemDateField name="effectiveFrom" required'));
  assert.ok(!question.includes("new Date().toISOString().slice(0,10)"),
    "clinical effective dates must not silently use UTC's current date");
  assert.ok(question.includes('fetch(`/api/catalog/tests/${testId}/questions`'));
  assert.ok(question.includes("if (busy) return;"));
  assert.ok(question.includes("setOpen(false)"));
  assert.ok(question.includes("formElement.reset()"));
  assert.ok(question.includes("} catch {"));
  assert.ok(question.includes("} finally {"));
  assert.ok(question.includes('role="alert"'));
  assert.ok(question.includes('Reusing the same question code creates a new effective-dated version'));
});
