import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("interbranch receipt requires dispatched item and claims it atomically", () => {
  const route = readFileSync(new URL("../src/app/api/transfers/[id]/actions/route.ts", import.meta.url), "utf8");
  const claim = route.indexOf("const claimed = await tx.specimenTransferItem.updateMany");
  const moved = route.indexOf("const moved = await tx.specimen.updateMany", claim);
  assert.ok(claim >= 0 && moved > claim);
  assert.ok(route.includes('status: "DISPATCHED",\n      },\n      data: {\n        status: "RECEIVED"'));
  assert.ok(route.includes('if (claimed.count !== 1) throw new Error("SPECIMEN_PREANALYTICAL_STATE_CHANGED")'));
  assert.ok(route.includes('if (item.status !== "DISPATCHED")'));
  assert.ok(route.includes("preanalyticalVersion: item.specimen.preanalyticalVersion"));
});

test("dispatch atomically claims draft manifest and does not mistake another user's dispatch for success", () => {
  const route = readFileSync(new URL("../src/app/api/transfers/[id]/actions/route.ts", import.meta.url), "utf8");
  assert.ok(route.includes('const claimedManifest = await tx.specimenTransferManifest.updateMany'));
  assert.ok(route.includes('where: { id: manifest.id, status: "DRAFT" }'));
  assert.ok(route.includes('if (claimedManifest.count !== 1) throw new Error("SPECIMEN_PREANALYTICAL_STATE_CHANGED")'));
  assert.ok(route.includes('if (dispatchedItems.count !== manifest.items.length) throw new Error("SPECIMEN_PREANALYTICAL_STATE_CHANGED")'));
  assert.ok(route.includes('if (!dispatched)'));
});

test("concurrent distinct-item receipts serialize before recalculating manifest completion", () => {
  const route = readFileSync(new URL("../src/app/api/transfers/[id]/actions/route.ts", import.meta.url), "utf8");
  const receipt = route.indexOf("const result = await prisma.$transaction");
  const lock = route.indexOf("FROM specimen_transfer_manifests", receipt);
  const claimed = route.indexOf("const claimed = await tx.specimenTransferItem.updateMany", receipt);
  const remaining = route.indexOf("const remaining = await tx.specimenTransferItem.count", receipt);
  const manifestUpdate = route.indexOf("await tx.specimenTransferManifest.update", receipt);
  assert.ok(receipt >= 0 && lock > receipt && claimed > lock && remaining > claimed && manifestUpdate > remaining);
  assert.ok(route.slice(lock, claimed).includes("FOR UPDATE"));
  assert.ok(route.slice(lock, claimed).includes('["DISPATCHED", "PARTIALLY_RECEIVED"]'));
});

test("manifest transfer actions reject unsupported action names before selecting permissions", () => {
  const route = readFileSync(new URL("../src/app/api/transfers/[id]/actions/route.ts", import.meta.url), "utf8");
  assert.ok(route.includes('body?.action !== "DISPATCH" && body?.action !== "RECEIVE_ITEM"'));
});
