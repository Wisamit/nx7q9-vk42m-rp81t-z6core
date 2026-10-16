import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const attachment = readFileSync("src/components/attachment-manager.tsx", "utf8");
const aliquot = readFileSync("src/components/specimen-aliquot-manager.tsx", "utf8");
const specimen = readFileSync("src/components/specimen-actions.tsx", "utf8");

test("Issue #265: attachment upload is gated by permissions, file and user confirmation", () => {
  assert.ok(attachment.includes('import { CrudModal } from "@/components/crud-modal"'));
  assert.ok(attachment.includes("open={canUpload && uploadOpen}"));
  assert.ok(attachment.includes('size="compact"'));
  assert.ok(attachment.includes("canUpload && uploadOpen && <form"));
  assert.ok(attachment.includes('new FormData(element)'));
  assert.ok(attachment.includes('form.set("targetType", targetType)'));
  assert.ok(attachment.includes('form.set("targetId", targetId)'));
  assert.ok(attachment.includes('fetch("/api/attachments", { method: "POST", body: form })'));
  assert.ok(attachment.includes('if (!response.ok)'));
  assert.ok(attachment.includes("setFormError("));
  assert.ok(attachment.includes('element.reset();'));
  assert.ok(attachment.includes("setUploadOpen(false)"));
  assert.ok(attachment.includes("router.refresh()"));
  assert.ok(attachment.includes("finally {"));
  assert.ok(attachment.includes("if (!busy) setUploadOpen(false)"));
  assert.ok(!attachment.includes("event.currentTarget.reset()"), "capture the live form before awaiting network");
});

test("Issue #265: six high-risk specimen volume and storage mutations are compact, reviewable dialogs", () => {
  for (const fn of [
    "reconcile", "changeStorageStatus", "registerStorage",
    "relocateStorage", "createAliquot", "recordUsage",
  ]) {
    const marker = '<form className="catalog-form specimen-action-form" onSubmit={' + fn + '}>';
    const formStart = aliquot.indexOf(marker);
    const modalStart = aliquot.lastIndexOf("<CrudModal", formStart);
    const modalEnd = aliquot.indexOf("</CrudModal>", formStart);
    assert.ok(formStart >= 0 && modalStart >= 0 && modalEnd > formStart,
      fn + " must remain inside a real modal");
    const modalOpen = aliquot.slice(modalStart, formStart);
    assert.ok(modalOpen.includes('size="compact"'), fn);
    assert.ok(modalOpen.includes("actionModal === "), fn);
    assert.ok(modalOpen.includes("if (!busy && !storageBusy) setActionModal"), fn);
  }
  assert.equal((aliquot.match(/<CrudModal\b/g) || []).length, 6);
  assert.equal((aliquot.match(/<form\b/g) || []).length, 6);
});

test("Issue #265: specimen barcode lineage, volume and storage history remain server-side", () => {
  const endpoints = [
    "/api/settings/specimen-storage-locations",
    "/volume-reconcile", "/aliquots", "/storage-location", "/usage",
  ];
  for (const path of endpoints) assert.ok(aliquot.includes(path), path);
  assert.ok(aliquot.includes('orderItemIds: form.getAll("orderItemIds")'));
  assert.ok(aliquot.includes('if (!ok) return;'));
  assert.ok(aliquot.includes('const refreshed = await refreshLocations(true)'));
  assert.ok(aliquot.includes("A successful audited PATCH is not undone"));
  assert.ok(aliquot.includes('Status saved, but location list could not refresh.'));
  assert.ok(aliquot.includes('volumeUnit: form.get("volumeUnit")'));
  assert.ok(aliquot.includes('remainingVolume !== null'));
  assert.ok(aliquot.includes('volumeUsed: form.get("volumeUsed")'));
  assert.ok(aliquot.includes('child.barcode'));
  assert.ok(aliquot.includes('usageEvents.map'));
  assert.ok(aliquot.includes("router.refresh()"));
});

test("Issue #265: specimen reception, scope-specific rejection and disposal are guarded by custody modal", () => {
  assert.ok(specimen.includes('import { CrudModal } from "@/components/crud-modal"'));
  assert.ok(specimen.includes("open={mode !== null}"));
  assert.ok(specimen.includes('size="compact"'));
  assert.ok(specimen.includes('"Barcode: " + barcode'));
  assert.ok(specimen.includes("if (!busy) { setMode(null)"));
  assert.ok(specimen.includes('if (!mode || busy) return;'));
  assert.ok(specimen.includes('mode && <form className="catalog-form specimen-action-form"'));
  assert.ok(specimen.includes('role="alert"'));
  assert.ok(specimen.includes('} catch {'));
  assert.ok(specimen.includes('} finally {'));
  assert.ok(specimen.includes('setBusy(false)'));
  for (const term of [
    'labelAssessment: form.get("labelAssessment")',
    'conditionCode: form.get("conditionCode")',
    'observedContainerCode: form.get("observedContainerCode")',
    'receptionNotes: form.get("receptionNotes")',
    'rejectionReasonId: form.get("rejectionReasonId")',
    'scope: rejectionScope',
    'orderItemIds: form.getAll("orderItemIds")',
    'disposalReason',
    'replacementBarcode',
    'requirementsFinalized',
    'specimenTypeConfigured',
  ]) assert.ok(specimen.includes(term), "Custody history or reviewer data lost: " + term);
});
