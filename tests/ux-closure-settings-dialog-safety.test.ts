import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modal = readFileSync("src/components/crud-modal.tsx", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");
const settingsRoute = readFileSync("src/app/settings/page.tsx", "utf8");
const settingsDialog = readFileSync("src/components/system-settings-dialog.tsx", "utf8");

test("UI gate #265: modal supplies per-instance dialog labels and restores trigger focus", () => {
  assert.ok(modal.includes("const headingId = useId()"));
  assert.ok(modal.includes("const descriptionId = useId()"));
  assert.ok(modal.includes("aria-labelledby={headingId}"));
  assert.ok(modal.includes("aria-describedby={description ? descriptionId : undefined}"));
  assert.ok(modal.includes("role=\"dialog\""));
  assert.ok(modal.includes("aria-modal=\"true\""));
  assert.ok(modal.includes("tabIndex={-1}"));
  assert.ok(modal.includes("previouslyFocused.focus({ preventScroll: true })"));
  assert.ok(modal.includes('document.addEventListener("keydown", onKey, true)'));
  assert.ok(modal.includes('event.key === "Escape"'));
  assert.ok(modal.includes('event.key !== "Tab"'));
  assert.ok(modal.includes("last.focus()"));
  assert.ok(modal.includes("first.focus()"));
  assert.ok(modal.includes("dialogs[dialogs.length - 1] !== dialog"),
    "stacked dialogs must not each handle Escape/Tab");
});

test("UI gate #265: unsaved edits request an explicit localized discard decision", () => {
  assert.ok(modal.includes("protectUnsavedChanges = true"));
  assert.ok(modal.includes("onInputCapture"));
  assert.ok(modal.includes("onChangeCapture"));
  assert.ok(modal.includes("changedRef.current"));
  assert.ok(!modal.includes("window.confirm("),
    "Do not use native browser confirmations; render a themed accessible alertdialog.");
  assert.ok(modal.includes('role="alertdialog"'));
  assert.ok(modal.includes('aria-labelledby={discardTitleId}'));
  assert.ok(modal.includes('aria-describedby={discardDescriptionId}'));
  assert.ok(modal.includes('const trap = discardOpenRef.current ? discardRef.current : dialog'));
  assert.ok(modal.includes('if (discardOpenRef.current) cancelDiscard()'));
  assert.ok(modal.includes('setDiscardOpen(true)'));
  assert.ok(modal.includes('setDiscardOpen(false)'));
  assert.ok(modal.includes('Keep editing'));
  assert.ok(modal.includes('Discard changes'));
  assert.ok(modal.includes('if (!props.open) return null'),
    "Each opened dialog gets fresh dirty/confirmation state.");
  assert.ok(modal.includes('<OpenCrudModal {...props} />'));
  assert.ok(css.includes(".crud-modal-discard-shade"));
  assert.ok(css.includes(".crud-modal-discard-panel"));
  assert.ok(css.includes(".crud-modal-discard-actions"));
  assert.ok(modal.includes("لديك تغييرات غير محفوظة"));
  assert.ok(modal.includes("You have unsaved changes."));
  assert.ok(modal.includes("event.target === event.currentTarget"));
  assert.ok(modal.includes("requestClose()"));
});

test("UI gate #265: compact dialog has one-third desktop width and mobile full usable scroll", () => {
  assert.ok(css.includes(".crud-modal-compact{width:min(33.333vw,520px);min-width:0}"));
  assert.ok(css.includes(".crud-modal-compact .theme-editor-grid,"));
  assert.ok(css.includes(".crud-modal-compact .color-grid{grid-template-columns:minmax(0,1fr)}"));
  assert.ok(css.includes(".crud-modal-body{padding:20px;overflow:auto"));
  assert.ok(css.includes("max-height:calc(100vh - 48px)"));
  assert.ok(css.includes("@media(max-width:760px)"));
  assert.ok(css.includes(".crud-modal-full,.crud-modal-compact{width:100%;height:100%"));
});

test("UI gate #265: system settings cannot be edited inline; existing validated save remains", () => {
  const form = readFileSync("src/components/system-settings-form.tsx", "utf8");
  assert.ok(settingsRoute.includes("<SystemSettingsDialog initial={settings} locale={locale} />"));
  assert.ok(!settingsRoute.includes("<SystemSettingsForm"));
  assert.ok(settingsDialog.includes('size="compact"'));
  assert.ok(settingsDialog.includes("<CrudModal"));
  assert.ok(settingsDialog.includes("open && <SystemSettingsForm"));
  assert.ok(settingsDialog.includes('type="button"'));
  assert.ok(settingsDialog.includes('onClick={() => setOpen(true)}'));
  assert.ok(settingsDialog.includes("initial.timezone"));
  assert.ok(settingsDialog.includes("initial.dateFormat"));
  assert.ok(settingsDialog.includes("initial.defaultTheme"));
  assert.ok(form.includes('fetch("/api/settings"'));
  assert.ok(form.includes('method: "PUT"'));
});
