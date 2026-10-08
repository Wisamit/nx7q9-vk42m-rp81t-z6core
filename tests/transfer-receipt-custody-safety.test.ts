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
