import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  compareCurrentReportWithPrevious,
  type ReportComparisonEvidence,
} from "../src/lib/report-cumulative.ts";

test("MariaDB two-session report comparisons isolate tenant/branch and respect retractions", { timeout: 45000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const uri = new URL(process.env.DATABASE_URL);
  const cfg = {
    host: uri.hostname, port: Number(uri.port || 3306),
    user: decodeURIComponent(uri.username), password: decodeURIComponent(uri.password),
    database: uri.pathname.slice(1),
  };
  const [writer, reader] = await Promise.all([mysql.createConnection(cfg), mysql.createConnection(cfg)]);
  const cleanup: Array<{ sql: string; params: string[] }> = [];
  const tenant = randomUUID(), foreignTenant = randomUUID();
  const branchA = randomUUID(), branchB = randomUUID(), foreignBranch = randomUUID();
  const staff = randomUUID(), foreignStaff = randomUUID();
  const patient = randomUUID(), foreignPatient = randomUUID();
  const orderNow = randomUUID(), orderOldA = randomUUID(), orderOldB = randomUUID(), orderForeign = randomUUID();
  const reportNow = randomUUID(), reportOldA = randomUUID(), reportOldB = randomUUID(), reportForeign = randomUUID();
  const suffix = tenant.slice(0, 8);

  async function insert(sql: string, params: string[], table: string, id: string) {
    await writer.execute(sql, params);
    cleanup.unshift({ sql: "DELETE FROM " + table + " WHERE id = ?", params: [id] });
  }
  const snapshot = (orderId: string, branchId: string, value: string, patientId: string, accessionNumber: string) => {
    const resultId = orderId + "-result", itemId = orderId + "-item";
    return {
      payload: JSON.stringify({ order: { id: orderId, accessionNumber }, patient: { id: patientId }, results: [{
        orderItemId: itemId, resultId, resultVersion: 1,
        testId: "test-unchanged", testCode: "GLU", testNameEn: "Glucose",
        methodId: "method-unchanged", analyzer: { code: "ANA-1" },
        performingBranch: { id: branchId, code: "performed" },
        values: [{ componentId: "component-unchanged", componentCode: "GLU",
          componentNameEn: "Glucose", displayValue: value, unit: "mg/dL", flag: "NORMAL",
          referenceLow: "70", referenceHigh: "100", referenceTextEn: "70-100" }],
      }] }),
      pointers: JSON.stringify([{ orderItemId: itemId, resultId, resultVersion: 1 }]),
    };
  };

  async function version(id: string, reportId: string, nr: string, status: string, branchId: string, issuer: string, issuedAt: string, orderId: string, value: string, patientId: string, accessionNumber: string) {
    const record = snapshot(orderId, branchId, value, patientId, accessionNumber);
    await insert(
      "INSERT INTO diagnostic_report_versions (id,report_id,version,status,branch_id,content_snapshot,result_version_snapshot,verification_token,issued_by_user_id,issued_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [id, reportId, nr, status, branchId, record.payload, record.pointers, randomUUID(), issuer, issuedAt],
      "diagnostic_report_versions", id,
    );
  }

  async function load(reportId: string): Promise<ReportComparisonEvidence> {
    const [rows] = await reader.execute<mysql.RowDataPacket[]>(
      `SELECT d.current_version, o.id AS order_id, o.patient_id, o.accession_number, o.ordered_at,
         v.version, v.status, v.issued_at, v.content_snapshot, v.result_version_snapshot
       FROM diagnostic_reports d JOIN orders o ON o.id = d.order_id
       LEFT JOIN diagnostic_report_versions v ON v.report_id = d.id AND v.version = d.current_version
       WHERE d.id = ?`, [reportId],
    );
    assert.equal(rows.length, 1);
    const row = rows[0];
    const decode = (value: unknown) => typeof value === "string" ? JSON.parse(value) : value;
    return {
      currentVersion: Number(row.current_version),
      order: { id: String(row.order_id), patientId: String(row.patient_id), accessionNumber: String(row.accession_number), orderedAt: new Date(row.ordered_at) },
      versions: row.version === null ? [] : [{
        version: Number(row.version), status: String(row.status), issuedAt: new Date(row.issued_at),
        contentSnapshot: decode(row.content_snapshot), resultVersionSnapshot: decode(row.result_version_snapshot),
      }],
    };
  }

  async function previous(org: string, patientId: string, allowedBranches: string[], before: Date) {
    const placeholders = allowedBranches.map(() => "?").join(",");
    const [rows] = await reader.execute<mysql.RowDataPacket[]>(
      `SELECT d.id FROM diagnostic_reports d JOIN orders o ON o.id = d.order_id
        WHERE d.organization_id = ? AND o.organization_id = ? AND o.patient_id = ?
          AND o.ordering_branch_id IN (${placeholders}) AND o.ordered_at < ?
        ORDER BY o.ordered_at DESC LIMIT 101`,
      [org, org, patientId, ...allowedBranches, before.toISOString().slice(0, 19).replace("T", " ")],
    );
    return Promise.all(rows.map(row => load(String(row.id))));
  }

  try {
    for (const [id, code] of [[tenant, "a"], [foreignTenant, "b"]])
      await insert("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
        [id, "C20-" + code + suffix, "Comparison Tenant"], "organizations", id);
    for (const [id, org, code] of [[branchA, tenant, "a"], [branchB, tenant, "b"], [foreignBranch, foreignTenant, "f"]])
      await insert("INSERT INTO branches (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id, org, "C20-" + code + suffix, "Comparison Branch"], "branches", id);
    for (const [id, org, code] of [[staff, tenant, "a"], [foreignStaff, foreignTenant, "b"]])
      await insert("INSERT INTO users (id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id, org, "c20-" + code + suffix, "Comparison Staff"], "users", id);
    for (const [id, org, code] of [[patient, tenant, "a"], [foreignPatient, foreignTenant, "b"]])
      await insert("INSERT INTO patients (id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES (?,?,?,?,?,NOW(3))",
        [id, org, "C20-" + code + suffix, "Comparison Patient", "comparison patient"], "patients", id);
    for (const [id, org, b, patientId, actor, date, code] of [
      [orderNow, tenant, branchA, patient, staff, "2026-10-08 09:00:00", "N"],
      [orderOldA, tenant, branchA, patient, staff, "2026-01-08 09:00:00", "A"],
      [orderOldB, tenant, branchB, patient, staff, "2026-09-08 09:00:00", "B"],
      [orderForeign, foreignTenant, foreignBranch, foreignPatient, foreignStaff, "2026-08-08 09:00:00", "F"],
    ]) await insert(
      "INSERT INTO orders (id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,ordered_at,updated_at) VALUES (?,?,?,?,?,?,?,NOW(3))",
      [id, org, "C20-" + code + suffix, b, patientId, actor, date], "orders", id,
    );
    for (const [id, org, orderId] of [
      [reportNow, tenant, orderNow], [reportOldA, tenant, orderOldA],
      [reportOldB, tenant, orderOldB], [reportForeign, foreignTenant, orderForeign],
    ]) await insert("INSERT INTO diagnostic_reports (id,organization_id,order_id,updated_at) VALUES (?,?,?,NOW(3))",
      [id, org, orderId], "diagnostic_reports", id);

    await version(randomUUID(), reportNow, "1", "FINAL", branchA, staff, "2026-10-09 12:00:00", orderNow, "99", patient, "C20-N" + suffix);
    await version(randomUUID(), reportOldA, "1", "FINAL", branchA, staff, "2026-01-09 12:00:00", orderOldA, "91", patient, "C20-A" + suffix);
    await version(randomUUID(), reportOldB, "1", "FINAL", branchB, staff, "2026-09-09 12:00:00", orderOldB, "93", patient, "C20-B" + suffix);
    await version(randomUUID(), reportForeign, "1", "FINAL", foreignBranch, foreignStaff, "2026-08-09 12:00:00", orderForeign, "300", foreignPatient, "C20-F" + suffix);
    for (const id of [reportNow, reportOldA, reportOldB, reportForeign])
      await writer.execute("UPDATE diagnostic_reports SET current_version = 1 WHERE id = ?", [id]);

    const current = await load(reportNow);
    const scoped = await previous(tenant, patient, [branchA], current.order.orderedAt);
    assert.equal(compareCurrentReportWithPrevious(current, scoped, [branchA])[0].previous?.value, "91");
    const both = await previous(tenant, patient, [branchA, branchB], current.order.orderedAt);
    assert.equal(compareCurrentReportWithPrevious(current, both, [branchA, branchB])[0].previous?.value, "93");
    const foreign = await previous(tenant, foreignPatient, [branchA, branchB], current.order.orderedAt);
    assert.equal(foreign.length, 0);
    assert.equal(compareCurrentReportWithPrevious(current, [await load(reportForeign)], [branchA])[0].previous?.value ?? null, null);

    // Commit a retraction from the writer connection, then verify its immediate
    // exclusion on the independent reader connection.
    await writer.beginTransaction();
    await version(randomUUID(), reportOldB, "2", "RETRACTED", branchB, staff, "2026-09-10 12:00:00", orderOldB, "93", patient, "C20-B" + suffix);
    await writer.execute("UPDATE diagnostic_reports SET current_version = 2 WHERE id = ?", [reportOldB]);
    await writer.commit();
    const afterRetraction = await previous(tenant, patient, [branchA, branchB], current.order.orderedAt);
    assert.equal(compareCurrentReportWithPrevious(current, afterRetraction, [branchA, branchB])[0].previous?.value, "91");
  } finally {
    await writer.rollback().catch(() => {});
    for (const item of cleanup) await writer.execute(item.sql, item.params);
    await Promise.all([writer.end(), reader.end()]);
  }
});
