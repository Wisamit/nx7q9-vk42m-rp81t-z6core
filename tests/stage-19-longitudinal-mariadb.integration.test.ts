import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { currentReportResultIds } from "../src/lib/patient-history.ts";

test("MariaDB longitudinal current-report filtering respects tenant, branch, amendment and retraction", { timeout: 45000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const config = {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
  const [writer, reader] = await Promise.all([mysql.createConnection(config), mysql.createConnection(config)]);
  const undo: Array<{ sql: string; args: string[] }> = [];
  const orgA = randomUUID(), orgB = randomUUID();
  const branchA = randomUUID(), branchB = randomUUID(), foreignBranch = randomUUID();
  const userA = randomUUID(), userB = randomUUID();
  const patientA = randomUUID(), patientB = randomUUID();
  const testA = randomUUID(), testB = randomUUID();
  const orderA = randomUUID(), orderB = randomUUID(), orderForeign = randomUUID();
  const itemA = randomUUID(), itemB = randomUUID(), itemForeign = randomUUID();
  const oldReading = randomUUID(), corrected = randomUUID(), retracted = randomUUID(), foreignReading = randomUUID();
  const reportA = randomUUID(), reportB = randomUUID(), reportForeign = randomUUID();
  const suffix = orgA.slice(0, 8);

  async function insert(sql: string, args: string[], table: string, id: string) {
    await writer.execute(sql, args);
    undo.unshift({ sql: "DELETE FROM " + table + " WHERE id = ?", args: [id] });
  }
  async function snapshotVersion(id: string, reportId: string, version: number, status: string, branchId: string, userId: string, itemId: string, readingId: string, resultVersion: number) {
    await insert(
      `INSERT INTO diagnostic_report_versions
        (id,report_id,version,status,branch_id,content_snapshot,result_version_snapshot,verification_token,issued_by_user_id)
        VALUES (?,?,?,?,?,'{}',?,?,?)`,
      [id, reportId, String(version), status, branchId,
        JSON.stringify([{ orderItemId: itemId, resultId: readingId, resultVersion }]), randomUUID(), userId],
      "diagnostic_report_versions", id,
    );
  }
  async function latestEvidence(orgId: string, patientId: string) {
    const [rows] = await reader.execute<mysql.RowDataPacket[]>(
      `SELECT d.id, d.current_version AS currentVersion, v.version, v.status,
              v.result_version_snapshot AS pointer
       FROM diagnostic_reports d JOIN orders o ON o.id = d.order_id
       LEFT JOIN diagnostic_report_versions v ON v.report_id = d.id AND v.version = d.current_version
       WHERE d.organization_id = ? AND o.organization_id = ? AND o.patient_id = ?`,
      [orgId, orgId, patientId],
    );
    return rows.map(row => ({
      currentVersion: Number(row.currentVersion),
      versions: row.version === null ? [] : [{
        version: Number(row.version),
        status: String(row.status),
        resultVersionSnapshot: typeof row.pointer === "string" ? JSON.parse(row.pointer) : row.pointer,
      }],
    }));
  }
  async function visibleReadings(orgId: string, patientId: string, accessibleBranchId: string) {
    const ids = currentReportResultIds(await latestEvidence(orgId, patientId));
    if (!ids.size) return [];
    const placeholders = [...ids].map(() => "?").join(",");
    const [rows] = await reader.execute<mysql.RowDataPacket[]>(
      `SELECT r.id FROM laboratory_results r
       JOIN order_items i ON i.id = r.order_item_id
       JOIN orders o ON o.id = i.order_id
       WHERE r.organization_id = ? AND o.organization_id = ? AND o.patient_id = ?
         AND r.performing_branch_id = ? AND r.status IN ('RELEASED','AMENDED')
         AND r.id IN (${placeholders}) ORDER BY r.id`,
      [orgId, orgId, patientId, accessibleBranchId, ...ids],
    );
    return rows.map(row => String(row.id));
  }

  try {
    for (const [id, code] of [[orgA, "A"], [orgB, "B"]]) {
      await insert("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
        [id, "H19-" + code + "-" + suffix, "History Tenant " + code], "organizations", id);
    }
    for (const [id, org, code] of [[branchA, orgA, "A"], [branchB, orgA, "B"], [foreignBranch, orgB, "F"]]) {
      await insert("INSERT INTO branches (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id, org, "H19-" + code + "-" + suffix, "History Branch " + code], "branches", id);
    }
    for (const [id, org, code] of [[userA, orgA, "a"], [userB, orgB, "b"]]) {
      await insert("INSERT INTO users (id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id, org, "h19-" + code + "-" + suffix, "History Actor"], "users", id);
    }
    for (const [id, org, code] of [[patientA, orgA, "a"], [patientB, orgB, "b"]]) {
      await insert("INSERT INTO patients (id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES (?,?,?,?,?,NOW(3))",
        [id, org, "H19-" + code + "-" + suffix, "History Patient " + code, "history patient " + code], "patients", id);
    }
    for (const [id, org, code] of [[testA, orgA, "A"], [testB, orgB, "B"]]) {
      await insert("INSERT INTO lab_tests (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id, org, "H19-" + code + "-" + suffix, "History Test"], "lab_tests", id);
    }
    for (const [id, org, orderingBranch, patientId, userId, code] of [
      [orderA, orgA, branchA, patientA, userA, "A"],
      [orderB, orgA, branchB, patientA, userA, "B"],
      [orderForeign, orgB, foreignBranch, patientB, userB, "F"],
    ]) {
      await insert("INSERT INTO orders (id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES (?,?,?,?,?,?,NOW(3))",
        [id, org, "H19-" + code + "-" + suffix, orderingBranch, patientId, userId], "orders", id);
    }
    for (const [id, orderId, testId] of [[itemA, orderA, testA], [itemB, orderB, testA], [itemForeign, orderForeign, testB]]) {
      await insert("INSERT INTO order_items (id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) VALUES (?,?,?,?,?,'USD',NOW(3))",
        [id, orderId, testId, "H19-" + suffix, "History Test"], "order_items", id);
    }
    for (const [id, org, itemId, performedBranch, userId, version] of [
      [oldReading, orgA, itemA, branchA, userA, "1"],
      [corrected, orgA, itemA, branchB, userA, "2"],
      [retracted, orgA, itemB, branchB, userA, "1"],
      [foreignReading, orgB, itemForeign, foreignBranch, userB, "1"],
    ]) {
      await insert(
        "INSERT INTO laboratory_results (id,organization_id,order_item_id,performing_branch_id,entered_by_user_id,version,status,released_at,updated_at) VALUES (?,?,?,?,?,?,'RELEASED',NOW(3),NOW(3))",
        [id, org, itemId, performedBranch, userId, version], "laboratory_results", id,
      );
    }
    for (const [id, org, orderId] of [[reportA, orgA, orderA], [reportB, orgA, orderB], [reportForeign, orgB, orderForeign]]) {
      await insert("INSERT INTO diagnostic_reports (id,organization_id,order_id,updated_at) VALUES (?,?,?,NOW(3))",
        [id, org, orderId], "diagnostic_reports", id);
    }
    await snapshotVersion(randomUUID(), reportA, 1, "FINAL", branchA, userA, itemA, oldReading, 1);
    await snapshotVersion(randomUUID(), reportA, 2, "AMENDED", branchA, userA, itemA, corrected, 2);
    await snapshotVersion(randomUUID(), reportB, 1, "FINAL", branchB, userA, itemB, retracted, 1);
    await snapshotVersion(randomUUID(), reportB, 2, "RETRACTED", branchB, userA, itemB, retracted, 1);
    await snapshotVersion(randomUUID(), reportForeign, 1, "FINAL", foreignBranch, userB, itemForeign, foreignReading, 1);
    for (const [reportId, version] of [[reportA, "2"], [reportB, "2"], [reportForeign, "1"]]) {
      await writer.execute("UPDATE diagnostic_reports SET current_version = ? WHERE id = ?", [version, reportId]);
    }
    assert.deepEqual(await visibleReadings(orgA, patientA, branchA), []);
    assert.deepEqual(await visibleReadings(orgA, patientA, branchB), [corrected]);
    assert.deepEqual(await visibleReadings(orgA, patientB, foreignBranch), []);
    assert.deepEqual(await visibleReadings(orgB, patientB, branchB), []);
    assert.deepEqual(await visibleReadings(orgB, patientB, foreignBranch), [foreignReading]);

    // A second connection publishes a later retraction: the previously visible
    // corrected result must disappear from all current longitudinal reads.
    await writer.beginTransaction();
    await snapshotVersion(randomUUID(), reportA, 3, "RETRACTED", branchA, userA, itemA, corrected, 2);
    await writer.execute("UPDATE diagnostic_reports SET current_version = 3 WHERE id = ?", [reportA]);
    await writer.commit();
    assert.deepEqual(await visibleReadings(orgA, patientA, branchB), []);
  } finally {
    await writer.rollback().catch(() => {});
    for (const row of undo) await writer.execute(row.sql, row.args);
    await Promise.all([writer.end(), reader.end()]);
  }
});
