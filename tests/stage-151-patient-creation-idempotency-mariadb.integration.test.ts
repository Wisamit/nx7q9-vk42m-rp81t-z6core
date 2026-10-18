import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  patientCreationPayloadHash, evaluatePatientCreationReplay,
} from "../src/lib/patient-creation-idempotency.ts";

/**
 * Two truly independent MariaDB clients exercise the actual migration's
 * composite UNIQUE and optional FK; no synthetic in-memory mutexes.
 */
test("Stage 151 MariaDB: one committed patient per author/org/key under concurrent registration", {
  timeout: 60000,
}, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const cfg = { host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1) };
  const [one, two] = await Promise.all([mysql.createConnection(cfg), mysql.createConnection(cfg)]);
  const org = randomUUID(), otherOrg = randomUUID(), author = randomUUID();
  const peer = randomUUID(), outsider = randomUUID(), requestKey = randomUUID();
  const hash = patientCreationPayloadHash({
    fullNameEn: "Synthetic Patient", recordedAgeValue: "35", recordedAgeUnit: "YEAR",
  });
  const ids: string[] = [];
  const tag = org.slice(0, 8);
  async function create(client: typeof one, orgId: string, actor: string | null,
    key: string | null, fingerprint: string | null, suffix: string) {
    const id = randomUUID();
    await client.execute(
      "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,sex_at_birth," +
      "creation_request_user_id,creation_submission_key,creation_payload_hash,updated_at)" +
      " VALUES(?,?,?,?,?,'MALE',?,?,?,NOW(3))",
      [id, orgId, "S151-" + tag + "-" + suffix, "Synthetic Patient",
        "SYNTHETIC PATIENT", actor, key, fingerprint],
    );
    ids.push(id);
    return id;
  }
  async function find(orgId: string, actor: string, key: string) {
    const [rows] = await two.execute<mysql.RowDataPacket[]>(
      "SELECT id,status,merged_into_patient_id,creation_payload_hash FROM patients" +
      " WHERE organization_id=? AND creation_request_user_id=? AND creation_submission_key=?",
      [orgId, actor, key]);
    return rows;
  }
  try {
    for (const [id, suffix] of [[org, "A"], [otherOrg, "B"]]) {
      await one.execute("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id, "S151-" + tag + suffix, "Patient idempotency test organization"]);
    }
    for (const [id, orgId, suffix] of [[author, org, "A"], [peer, org, "B"],
      [outsider, otherOrg, "C"]]) {
      await one.execute("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id, orgId, "s151-" + tag + suffix, "Synthetic registration actor"]);
    }
    // No unique constraint can be bypassed by two concurrent independent DB sessions.
    const results = await Promise.allSettled([
      create(one, org, author, requestKey, hash, "C1"),
      create(two, org, author, requestKey, hash, "C2"),
    ]);
    assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
    const failed = results.find(x => x.status === "rejected");
    assert.equal(failed?.status, "rejected");
    assert.equal((failed as PromiseRejectedResult).reason?.code, "ER_DUP_ENTRY");
    const visible = await find(org, author, requestKey);
    assert.equal(visible.length, 1);
    const decision = evaluatePatientCreationReplay({
      id: visible[0].id, status: visible[0].status,
      mergedIntoPatientId: visible[0].merged_into_patient_id,
      creationPayloadHash: visible[0].creation_payload_hash,
    }, hash);
    assert.deepEqual(decision, { kind: "replay", id: visible[0].id });
    assert.deepEqual(evaluatePatientCreationReplay({
      id: visible[0].id, status: visible[0].status,
      mergedIntoPatientId: visible[0].merged_into_patient_id,
      creationPayloadHash: visible[0].creation_payload_hash,
    }, patientCreationPayloadHash({ fullNameEn: "Other patient" })), { kind: "conflict" });

    // A matching UUID in another tenant or created by another staff user may
    // never retrieve or conflict with this tenant/author's registration.
    assert.equal((await find(org, peer, requestKey)).length, 0);
    assert.equal((await find(otherOrg, outsider, requestKey)).length, 0);
    await create(one, org, peer, requestKey, hash, "PEER");
    await create(two, otherOrg, outsider, requestKey, hash, "FOREIGN");
    assert.equal((await find(org, peer, requestKey)).length, 1);
    assert.equal((await find(otherOrg, outsider, requestKey)).length, 1);
    assert.equal((await find(org, author, requestKey)).length, 1);

    // Unkeyed historical API registrations retain their nullable behavior.
    await create(one, org, null, null, null, "LEGACY1");
    await create(one, org, null, null, null, "LEGACY2");

    // The author FK makes an unrecognized creator impossible to impersonate.
    await assert.rejects(
      () => create(one, org, randomUUID(), randomUUID(), hash, "NOACTOR"),
      (error: unknown) => Boolean(error && typeof error === "object" &&
        "code" in error && error.code === "ER_NO_REFERENCED_ROW_2"),
    );
  } finally {
    await one.execute("DELETE FROM patients WHERE patient_number LIKE ?",
      ["S151-" + tag + "-%"]).catch(() => {});
    await one.execute("DELETE FROM users WHERE username LIKE ?", ["s151-" + tag + "%"]).catch(() => {});
    await one.execute("DELETE FROM organizations WHERE id IN (?,?)", [org, otherOrg]).catch(() => {});
    await Promise.all([one.end(), two.end()]);
  }
});
