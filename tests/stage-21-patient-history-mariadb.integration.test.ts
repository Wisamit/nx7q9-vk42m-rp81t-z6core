import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("MariaDB longitudinal pagination preserves all allowed pages while isolating tenant and branch", { timeout: 45000 }, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  const uri = new URL(databaseUrl);
  const config = { host: uri.hostname, port: Number(uri.port || 3306),
    user: decodeURIComponent(uri.username), password: decodeURIComponent(uri.password),
    database: uri.pathname.slice(1) };
  const [writer, reader] = await Promise.all([mysql.createConnection(config), mysql.createConnection(config)]);
  const undo: Array<{ table: string; id: string }> = [];
  const tenant = randomUUID(), foreignTenant = randomUUID();
  const branch = randomUUID(), restrictedBranch = randomUUID(), foreignBranch = randomUUID();
  const staff = randomUUID(), foreignStaff = randomUUID();
  const patient = randomUUID(), foreignPatient = randomUUID();
  const suffix = tenant.slice(0, 8);
  async function insert(sql: string, args: Array<string | number>, table: string, id: string) {
    await writer.execute(sql, args);
    undo.unshift({ table, id });
  }
  async function pages(org: string, patientId: string, scopes: string[], offset: number) {
    const sql = scopes.map(() => "?").join(",");
    const [rows] = await reader.execute<mysql.RowDataPacket[]>(
      `SELECT id, accession_number FROM orders
        WHERE organization_id = ? AND patient_id = ? AND ordering_branch_id IN (${sql})
        ORDER BY ordered_at DESC, id DESC LIMIT 21 OFFSET ?`,
      [org, patientId, ...scopes, offset],
    );
    return rows.map(row => ({ id: String(row.id), accession: String(row.accession_number) }));
  }
  async function attachments(org: string, patientId: string, scopes: string[], offset: number) {
    const sql = scopes.map(() => "?").join(",");
    const [rows] = await reader.execute<mysql.RowDataPacket[]>(
      `SELECT id FROM attachments WHERE organization_id = ? AND target_type = 'PATIENT'
       AND target_id = ? AND branch_id IN (${sql})
       ORDER BY created_at DESC, id DESC LIMIT 21 OFFSET ?`,
      [org, patientId, ...scopes, offset],
    );
    return rows.map(row => String(row.id));
  }

  try {
    for (const [id, code] of [[tenant,"A"],[foreignTenant,"B"]]) {
      await insert("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
        [id,"H21-"+code+suffix,"History Pagination Tenant"],"organizations",id);
    }
    for (const [id,org,code] of [[branch,tenant,"A"],[restrictedBranch,tenant,"R"],[foreignBranch,foreignTenant,"F"]]) {
      await insert("INSERT INTO branches (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,org,"H21-"+code+suffix,"History Pagination Branch"],"branches",id);
    }
    for (const [id,org,code] of [[staff,tenant,"A"],[foreignStaff,foreignTenant,"F"]]) {
      await insert("INSERT INTO users (id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,org,"h21-"+code+suffix,"History Pagination Actor"],"users",id);
    }
    for (const [id,org,code] of [[patient,tenant,"A"],[foreignPatient,foreignTenant,"F"]]) {
      await insert("INSERT INTO patients (id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES (?,?,?,?,?,NOW(3))",
        [id,org,"H21-"+code+suffix,"History Pagination Patient","history pagination patient"],"patients",id);
    }
    const allowedOrderIds: string[] = [], allowedAttachmentIds: string[] = [];
    for (let index=0; index<27; index++) {
      const id=randomUUID();
      const b=index<25?branch:restrictedBranch;
      const date="2026-10-"+String(index+1).padStart(2,"0")+" 09:00:00";
      await insert(
        "INSERT INTO orders (id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,ordered_at,updated_at) VALUES (?,?,?,?,?,?,?,NOW(3))",
        [id,tenant,"H21-"+String(index)+suffix,b,patient,staff,date],"orders",id,
      );
      if (b===branch) allowedOrderIds.push(id);
    }
    const foreignOrder=randomUUID();
    await insert(
      "INSERT INTO orders (id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES (?,?,?,?,?,?,NOW(3))",
      [foreignOrder,foreignTenant,"H21-foreign-"+suffix,foreignBranch,foreignPatient,foreignStaff],"orders",foreignOrder,
    );

    for (let index=0; index<27; index++) {
      const id=randomUUID(), b=index<25?branch:restrictedBranch;
      await insert(
        "INSERT INTO attachments (id,organization_id,branch_id,target_type,target_id,original_name,content_type,size_bytes,sha256,uploaded_by_user_id,created_at) VALUES (?,?,?,'PATIENT',?,'history.pdf','application/pdf',1,?,?,?)",
        [id,tenant,b,patient,"f".repeat(64),staff,"2026-10-"+String(index+1).padStart(2,"0")+" 09:00:00"],
        "attachments",id,
      );
      if (b===branch) allowedAttachmentIds.push(id);
    }
    const foreignAttachment=randomUUID();
    await insert(
      "INSERT INTO attachments (id,organization_id,branch_id,target_type,target_id,original_name,content_type,size_bytes,sha256,uploaded_by_user_id) VALUES (?,?,?,'PATIENT',?,'private.pdf','application/pdf',1,?,?)",
      [foreignAttachment,foreignTenant,foreignBranch,foreignPatient,"d".repeat(64),foreignStaff],"attachments",foreignAttachment,
    );

    const first=await pages(tenant,patient,[branch],0);
    const second=await pages(tenant,patient,[branch],20);
    assert.equal(first.length,21);
    assert.equal(second.length,5);
    assert.equal(new Set([...first.slice(0,20),...second].map(x=>x.id)).size,25);
    assert.deepEqual(new Set([...first.slice(0,20),...second].map(x=>x.id)),new Set(allowedOrderIds));
    assert.deepEqual(await pages(tenant,foreignPatient,[branch],0),[]);
    assert.deepEqual(await pages(foreignTenant,foreignPatient,[branch],0),[]);

    const filesFirst=await attachments(tenant,patient,[branch],0);
    const filesSecond=await attachments(tenant,patient,[branch],20);
    assert.equal(filesFirst.length,21);
    assert.equal(filesSecond.length,5);
    assert.deepEqual(new Set([...filesFirst.slice(0,20),...filesSecond]),new Set(allowedAttachmentIds));
    assert.deepEqual(await attachments(tenant,patient,[foreignBranch],0),[]);
    assert.deepEqual(await attachments(foreignTenant,patient,[foreignBranch],0),[]);

    // A separate SQL connection can see committed additions, including older rows;
    // no fixed cap silently prevents navigating later pages.
    assert.equal((await pages(tenant,patient,[branch],40)).length,0);
  } finally {
    for (const row of undo) await writer.execute(`DELETE FROM ${row.table} WHERE id = ?`,[row.id]);
    await Promise.all([writer.end(),reader.end()]);
  }
});
