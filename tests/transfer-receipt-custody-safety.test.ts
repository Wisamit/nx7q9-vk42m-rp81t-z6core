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
