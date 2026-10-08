import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("manifest creation locks each specimen in stable order and checks active transfers after locking", () => {
  const route = readFileSync(new URL("../src/app/api/transfers/route.ts", import.meta.url), "utf8");
  const transaction = route.indexOf("const created = await prisma.$transaction");
  const order = route.indexOf("[...specimenIds].sort()", transaction);
  const lock = route.indexOf("FOR UPDATE", order);
  const count = route.indexOf("const concurrentTransfers = await tx.specimenTransferItem.count", lock);
  const create = route.indexOf("await tx.specimenTransferManifest.create", count);
  assert.ok(transaction >= 0 && order > transaction && lock > order && count > lock && create > count);
  assert.ok(route.includes("if (concurrentTransfers !== 0) throw new ManifestStateChanged()"));
  assert.ok(route.includes('error: "specimen_already_in_active_manifest_or_state_changed"'));
});
