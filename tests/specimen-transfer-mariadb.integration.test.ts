import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("MariaDB serializes independent barcode receipts to prevent stale manifest completion", { timeout: 30000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const config = {
    host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
  const db = await mysql.createConnection(config);
  const first = await mysql.createConnection(config);
  const second = await mysql.createConnection(config);
  const org = randomUUID(), branch = randomUUID(), destination = randomUUID(), user = randomUUID();
  const patient = randomUUID(), order = randomUUID(), manifest = randomUUID();
  const specimens = [randomUUID(), randomUUID()];
  const suffix = org.slice(0, 8);
  const cleanup: Array<{ sql: string; args: string[] }> = [];
  try {
    async function insert(sql: string, args: string[], undo: string, undoArgs: string[]) {
      await db.execute(sql, args);
      cleanup.unshift({ sql: undo, args: undoArgs });
    }
    await insert("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
      [org,"RC-"+suffix,"Receipt CI"], "DELETE FROM organizations WHERE id = ?", [org]);
    await insert("INSERT INTO branches (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [branch,org,"R-"+suffix,"Receipt Branch"], "DELETE FROM branches WHERE id = ?", [branch]);
    await insert("INSERT INTO branches (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [destination,org,"D-"+suffix,"Destination Branch"], "DELETE FROM branches WHERE id = ?", [destination]);
    await insert("INSERT INTO users (id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [user,org,"r-"+suffix,"Receipt Actor"], "DELETE FROM users WHERE id = ?", [user]);
    await insert("INSERT INTO patients (id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES (?,?,?,?,?,NOW(3))",
      [patient,org,"RP-"+suffix,"Receipt Patient","receipt patient"], "DELETE FROM patients WHERE id = ?", [patient]);
    await insert("INSERT INTO orders (id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES (?,?,?,?,?,?,NOW(3))",
      [order,org,"RA-"+suffix,branch,patient,user], "DELETE FROM orders WHERE id = ?", [order]);
    for (let i = 0; i < specimens.length; i++) {
      await insert("INSERT INTO specimens (id,organization_id,order_id,barcode,sequence_number,status,current_branch_id,updated_at) VALUES (?,?,?,?,?,'IN_TRANSIT',?,NOW(3))",
        [specimens[i],org,order,"RBC-"+suffix+"-"+i,String(i+1),branch], "DELETE FROM specimens WHERE id = ?", [specimens[i]]);
    }
    await insert("INSERT INTO specimen_transfer_manifests (id,organization_id,manifest_number,source_branch_id,destination_branch_id,status,created_by_user_id,updated_at) VALUES (?,?,?,?,?,'DISPATCHED',?,NOW(3))",
      [manifest,org,"RM-"+suffix,branch,destination,user], "DELETE FROM specimen_transfer_manifests WHERE id = ?", [manifest]);
    for (let i = 0; i < specimens.length; i++) {
      await insert("INSERT INTO specimen_transfer_items (manifest_id,specimen_id,barcode_snapshot,status) VALUES (?,?,?,'DISPATCHED')",
        [manifest,specimens[i],"RBC-"+suffix+"-"+i], "DELETE FROM specimen_transfer_items WHERE manifest_id = ? AND specimen_id = ?", [manifest,specimens[i]]);
    }

    await first.beginTransaction();
    const [locked] = await first.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM specimen_transfer_manifests WHERE id = ? AND organization_id = ? FOR UPDATE", [manifest,org]);
    assert.equal(locked.length, 1);
    await first.execute("UPDATE specimen_transfer_items SET status = 'RECEIVED' WHERE manifest_id = ? AND specimen_id = ?",[manifest,specimens[0]]);

    await second.query("SET SESSION innodb_lock_wait_timeout = 1");
    await second.beginTransaction();
    await assert.rejects(
      second.execute("SELECT id FROM specimen_transfer_manifests WHERE id = ? FOR UPDATE", [manifest]),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "ER_LOCK_WAIT_TIMEOUT");
    await second.rollback();
    const [firstRemaining] = await first.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS remaining FROM specimen_transfer_items WHERE manifest_id = ? AND status <> 'RECEIVED'",[manifest]);
    assert.equal(Number(firstRemaining[0]?.remaining),1);
    await first.execute("UPDATE specimen_transfer_manifests SET status = 'PARTIALLY_RECEIVED' WHERE id = ?",[manifest]);
    await first.commit();

    await second.beginTransaction();
    const [secondLocked] = await second.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM specimen_transfer_manifests WHERE id = ? AND status = 'PARTIALLY_RECEIVED' FOR UPDATE",[manifest]);
    assert.equal(secondLocked.length,1);
    await second.execute("UPDATE specimen_transfer_items SET status = 'RECEIVED' WHERE manifest_id = ? AND specimen_id = ?",[manifest,specimens[1]]);
    const [remaining] = await second.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS remaining FROM specimen_transfer_items WHERE manifest_id = ? AND status <> 'RECEIVED'",[manifest]);
    assert.equal(Number(remaining[0]?.remaining),0);
    await second.execute("UPDATE specimen_transfer_manifests SET status = 'RECEIVED' WHERE id = ?",[manifest]);
    await second.commit();
    const [complete] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM specimen_transfer_manifests WHERE id = ?",[manifest]);
    assert.equal(complete[0]?.status,"RECEIVED");
  } finally {
    await Promise.all([first.rollback().catch(()=>{}),second.rollback().catch(()=>{})]);
    for(const item of cleanup) await db.execute(item.sql,item.args);
    await Promise.all([db.end(),first.end(),second.end()]);
  }
});
