import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { specimenActionError } from "../src/lib/clinical-safety.ts";
import { specimenVolumeUseError } from "../src/lib/specimen-volume-policy.ts";

test("failed reception persists quarantine atomically with event and audit", () => {
  const route = readFileSync(new URL("../src/app/api/specimens/[id]/actions/route.ts", import.meta.url), "utf8");
  const branch = route.indexOf("const acceptanceError = receptionAcceptanceError");
  const tx = route.indexOf("const quarantined = await prisma.$transaction", branch);
  const claim = route.indexOf("const claimed = await tx.specimen.updateMany", tx);
  const event = route.indexOf("await tx.specimenEvent.create", claim);
  const audit = route.indexOf("await tx.auditEvent.create", event);
  assert.ok(branch >= 0 && tx > branch && claim > tx && event > claim && audit > event);
  assert.ok(route.slice(claim,event).includes('status: "QUARANTINED"'));
  assert.ok(route.slice(claim,event).includes("preanalyticalVersion: specimen.preanalyticalVersion"));
  assert.ok(route.slice(event,audit).includes('eventType: "QUARANTINED"'));
  assert.ok(route.includes('action: "SPECIMEN_RECEPTION_QUARANTINED"'));
  assert.ok(route.includes('specimenStatus: "QUARANTINED"'));
});

test("quarantine can only proceed through controlled rejection, not reception or volume consumption", () => {
  assert.equal(specimenActionError({status:"QUARANTINED",action:"RECEIVE",specimenTypeConfigured:true}),"specimen_not_receivable");
  assert.equal(specimenActionError({status:"QUARANTINED",action:"REJECT",specimenTypeConfigured:true}),null);
  assert.equal(specimenVolumeUseError({
    status:"QUARANTINED",remainingVolume:"5.000",remainingVolumeUnit:"mL",
    requestedVolume:"1.000",requestedVolumeUnit:"mL",
  }),"specimen_status_not_usable");
});

test("released-result transaction locks linked specimens and refuses clinical quarantine", () => {
  const route = readFileSync(new URL("../src/app/api/results/[id]/release/route.ts", import.meta.url), "utf8");
  const begin = route.indexOf("const released = await prisma.$transaction");
  const lock = route.indexOf("ORDER BY s.id FOR UPDATE",begin);
  const hold = route.indexOf('specimen.status === "QUARANTINED"',lock);
  const mutate = route.indexOf("tx.laboratoryResult.update",hold);
  assert.ok(begin >= 0 && lock > begin && hold > lock && mutate > hold);
  assert.ok(route.includes('error: "specimen_clinical_quarantine_blocks_release"'));
});

test("quarantine enum migration retains all existing statuses and event history", () => {
  const migration = readFileSync(new URL("../prisma/migrations/20261008190000_specimen_reception_quarantine/migration.sql", import.meta.url),"utf8");
  for(const status of ["PLANNED","COLLECTION_FAILED","COLLECTED","RECEIVED","IN_TRANSIT","IN_PROCESS","QUARANTINED","REJECTED","DISPOSED"]) {
    assert.ok(migration.includes("'"+status+"'"));
  }
  assert.ok(migration.includes("MODIFY COLUMN `from_status`"));
  assert.ok(migration.includes("MODIFY COLUMN `to_status`"));
});
