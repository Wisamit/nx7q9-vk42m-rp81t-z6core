import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { medicalApprovalEvidenceError, snapshotValidationPolicy } from "../src/lib/result-validation.ts";

test("MariaDB: medical approval evidence must match recorded manual or automated technical approval", { timeout: 45000 }, async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const uri = new URL(url);
  const config = {
    host: uri.hostname, port: Number(uri.port || 3306),
    user: decodeURIComponent(uri.username), password: decodeURIComponent(uri.password),
    database: uri.pathname.slice(1),
  };
  const [writer, reviewer] = await Promise.all([mysql.createConnection(config), mysql.createConnection(config)]);
  const org = randomUUID(), branch = randomUUID(), staff = randomUUID(), medical = randomUUID();
  const patient = randomUUID(), order = randomUUID(), testId = randomUUID(), item = randomUUID(), resultId = randomUUID();
  const suffix = org.slice(0, 8);
  const cleanup: Array<{ table: string; id: string }> = [];
  const policy = snapshotValidationPolicy({
    id: "P-" + suffix, code: "MEDICAL-" + suffix, nameEn: "Medical validation", nameAr: null,
    scope: "TEST", branchId: branch, departmentId: null, testId,
    requiresMedicalValidation: true, allowSameReviewer: false,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveTo: null,
  });
  const evidenceAt = "2026-10-09 08:00:00.000";
  async function insert(sql: string, values: string[], table: string, id: string) {
    await writer.execute(sql, values);
    cleanup.unshift({ table, id });
  }
  async function medicalEvidence() {
    const [rows] = await reviewer.execute<mysql.RowDataPacket[]>(
      `SELECT r.organization_id, r.performing_branch_id, r.technical_reviewed_by_user_id,
        r.technical_reviewed_at, r.auto_verified, r.validation_policy_snapshot,
        oi.test_id
       FROM laboratory_results r JOIN order_items oi ON oi.id = r.order_item_id
       WHERE r.id = ? AND r.organization_id = ?`, [resultId, org],
    );
    assert.equal(rows.length, 1);
    const [reviews] = await reviewer.execute<mysql.RowDataPacket[]>(
      `SELECT stage,outcome,reviewer_user_id,reviewed_at,automated,policy_snapshot
       FROM result_validation_reviews WHERE result_id = ? AND stage = 'TECHNICAL_REVIEW'
       ORDER BY reviewed_at DESC, id DESC LIMIT 1`, [resultId],
    );
    const parse = (value: unknown) => typeof value === "string" ? JSON.parse(value) : value;
    const r = rows[0], event = reviews[0];
    return medicalApprovalEvidenceError({
      policySnapshot: parse(r.validation_policy_snapshot),
      performingBranchId: String(r.performing_branch_id),
      testId: String(r.test_id),
      departmentId: null,
      technicalReviewedByUserId: r.technical_reviewed_by_user_id ? String(r.technical_reviewed_by_user_id) : null,
      technicalReviewedAt: r.technical_reviewed_at ? new Date(r.technical_reviewed_at) : null,
      autoVerified: Boolean(r.auto_verified),
      technicalReview: event ? {
        stage: String(event.stage), outcome: String(event.outcome),
        reviewerUserId: event.reviewer_user_id ? String(event.reviewer_user_id) : null,
        reviewedAt: new Date(event.reviewed_at), automated: Boolean(event.automated),
        policySnapshot: parse(event.policy_snapshot),
      } : null,
      candidateUserId: medical,
    });
  }
  try {
    await insert("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
      [org,"MED23-"+suffix,"Medical Evidence Tenant"],"organizations",org);
    await insert("INSERT INTO branches (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [branch,org,"MED23-"+suffix,"Medical Evidence Branch"],"branches",branch);
    for (const [id,code] of [[staff,"TECH"],[medical,"MED"]]) {
      await insert("INSERT INTO users (id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,org,"med23-"+code+suffix,code+" Reviewer"],"users",id);
    }
    await insert("INSERT INTO patients (id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES (?,?,?,?,?,NOW(3))",
      [patient,org,"MED23-"+suffix,"Evidence Patient","evidence patient"],"patients",patient);
    await insert("INSERT INTO lab_tests (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [testId,org,"MED23-"+suffix,"Evidence Test"],"lab_tests",testId);
    await insert("INSERT INTO orders (id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES (?,?,?,?,?,?,NOW(3))",
      [order,org,"MED23-"+suffix,branch,patient,staff],"orders",order);
    await insert("INSERT INTO order_items (id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) VALUES (?,?,?,?,?,'USD',NOW(3))",
      [item,order,testId,"MED23","Evidence Test"],"order_items",item);
    await insert(
      `INSERT INTO laboratory_results
       (id,organization_id,order_item_id,performing_branch_id,entered_by_user_id,
        status,validation_stage,technical_reviewed_by_user_id,technical_reviewed_at,
        validation_policy_snapshot,updated_at)
       VALUES (?,?,?,?,?,'ENTERED','MEDICAL_VALIDATION',?,?,?,NOW(3))`,
      [resultId,org,item,branch,staff,staff,evidenceAt,JSON.stringify(policy)],"laboratory_results",resultId,
    );

    // A timestamp without a matching review cannot be approved.
    assert.equal(await medicalEvidence(),"technical_review_evidence_missing");
    const reviewId=randomUUID();
    await insert(
      `INSERT INTO result_validation_reviews
       (id,result_id,stage,outcome,reviewer_user_id,reviewed_at,automated,policy_snapshot)
       VALUES (?,?,'TECHNICAL_REVIEW','APPROVED',?,?,false,?)`,
      [reviewId,resultId,staff,evidenceAt,JSON.stringify(policy)],"result_validation_reviews",reviewId,
    );
    assert.equal(await medicalEvidence(),null);

    // A later return or a policy mismatch is never silently promoted to
    // technical APPROVED even when the result's stage flag remains unchanged.
    await writer.execute("UPDATE result_validation_reviews SET outcome='RETURNED' WHERE id=?", [reviewId]);
    assert.equal(await medicalEvidence(),"technical_review_evidence_missing");
    await writer.execute("UPDATE result_validation_reviews SET outcome='APPROVED' WHERE id=?", [reviewId]);
    await writer.execute("UPDATE result_validation_reviews SET policy_snapshot = ? WHERE id = ?",
      [JSON.stringify({ ...policy, allowSameReviewer: true }),reviewId]);
    assert.equal(await medicalEvidence(),"technical_review_evidence_missing");
    await writer.execute("UPDATE result_validation_reviews SET policy_snapshot = ? WHERE id = ?",
      [JSON.stringify(policy),reviewId]);

    // Automated technical review has no human reviewer; the original
    // autoverification decision AND an approved auto review are both required.
    await writer.execute(
      "UPDATE laboratory_results SET technical_reviewed_by_user_id=NULL, auto_verified=true WHERE id=?",[resultId],
    );
    await writer.execute(
      "UPDATE result_validation_reviews SET reviewer_user_id=NULL, automated=true WHERE id=?",[reviewId],
    );
    assert.equal(await medicalEvidence(),null);
    await writer.execute("UPDATE laboratory_results SET auto_verified=false WHERE id=?",[resultId]);
    assert.equal(await medicalEvidence(),"technical_review_evidence_missing");
    await writer.execute("UPDATE laboratory_results SET auto_verified=true, validation_policy_snapshot=? WHERE id=?",
      [JSON.stringify({ ...policy, branchId: "OTHER_BRANCH" }),resultId]);
    assert.equal(await medicalEvidence(),"medical_validation_policy_snapshot_invalid");
  } finally {
    await writer.rollback().catch(() => {});
    for (const row of cleanup) await writer.execute(`DELETE FROM ${row.table} WHERE id=?`,[row.id]);
    await Promise.all([writer.end(),reviewer.end()]);
  }
});
