import test from "node:test";
import assert from "node:assert/strict";
import {
  signF2ApplicationJournal,verifyF2ApplicationJournal,
} from "../src/lib/catalog-f2-application-journal.ts";
const secret="synthetic-application-journal-key-not-real-2026-12345";
test("F2: application ledger seals complete medical/finance before and after without exposing signing key",()=>{
  const payload={batchId:"synthetic",planDigest:"a".repeat(64),
    before:{unitPrice:"123.4500",criticalLow:"-1.500000"},
    after:{unitPrice:"128.9900",criticalLow:"-2.400000"},
    effectiveAt:"2026-12-01T00:00:00.000Z",
  };
  const signed=signF2ApplicationJournal(payload,secret);
  assert.deepEqual(verifyF2ApplicationJournal(signed,secret),payload);
  assert.equal(JSON.stringify(signed).includes(secret),false);
  assert.equal(verifyF2ApplicationJournal({...signed,before:{
    unitPrice:"123.4501",criticalLow:"-1.500000",
  }},secret),null);
  assert.equal(verifyF2ApplicationJournal({...signed,
    seal:{...(signed.seal as object),signature:"b".repeat(64)},
  },secret),null);
  assert.equal(verifyF2ApplicationJournal({...signed,extra:true},secret),null);
  assert.equal(verifyF2ApplicationJournal(signed,"foreign-installation-secret-key-unrelated-0001"),null);
  assert.equal(verifyF2ApplicationJournal({
    ...signed,seal:{...(signed.seal as object),algorithm:"SHA256"},
  },secret),null);
  assert.throws(()=>signF2ApplicationJournal({...payload,seal:{}},secret));
  assert.throws(()=>signF2ApplicationJournal(payload,"short"));
});
test("F2: HMAC domain separation is stable across JSON key order",()=>{
  const payload={a:{x:"1.2500",y:1},b:[1,"x"],c:null};
  const reverse={c:null,b:[1,"x"],a:{y:1,x:"1.2500"}};
  assert.deepEqual(signF2ApplicationJournal(payload,secret).seal,
    signF2ApplicationJournal(reverse,secret).seal);
  assert.deepEqual(verifyF2ApplicationJournal(
    signF2ApplicationJournal(payload,secret),secret),payload);
});
