import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { summarizeSignatoryPlanning } from "../src/lib/catalog-signatory-planning.ts";

test("Stage 58 MariaDB: live branch and domain-grant revocation removes potential reviewers without approval writes", {
  timeout: 45000,
}, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const cfg = { host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1) };
  const [writer, reader] = await Promise.all([mysql.createConnection(cfg), mysql.createConnection(cfg)]);
  const org = randomUUID(), foreignOrg = randomUUID(), branch = randomUUID();
  const sourceAuthor = randomUUID(), clinician = randomUUID(), finance = randomUUID();
  const foreignUser = randomUUID(), medicalRole = randomUUID(), financialRole = randomUUID();
  const prefix = "S58" + org.slice(0, 8);
  const addedPermissions: string[] = [];
  const exec = (sql: string, values: Array<string | number | null>) => writer.execute(sql, values);
  try {
    for (const [id, suffix] of [[org, "A"], [foreignOrg, "F"]])
      await exec("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id, prefix + suffix, "Stage58 Tenant"]);
    await exec("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch, org, prefix + "B", "Stage58 Branch"]);
    for (const [id, tenant, suffix] of [
      [sourceAuthor, org, "A"], [clinician, org, "C"],
      [finance, org, "M"], [foreignUser, foreignOrg, "F"],
    ]) await exec("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id, tenant, prefix + suffix, "Stage58 User"]);
    for (const [id, code] of [[medicalRole, prefix+"C"],[financialRole,prefix+"P"]])
      await exec("INSERT INTO roles(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id, org, code, "Stage58 Reviewer Role"]);
    for (const [person, role] of [[clinician, medicalRole],[finance,financialRole]])
      await exec("INSERT INTO user_roles(user_id,role_id) VALUES(?,?)", [person,role]);
    const permissionIds = new Map<string,string>();
    for(const code of ["catalog.manage","catalog.reference_ranges.manage","pricing.manage"]) {
      const [exists] = await writer.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM permissions WHERE code=?", [code]);
      if(exists.length) permissionIds.set(code, String(exists[0].id));
      else {
        const id=randomUUID();
        await exec("INSERT INTO permissions(id,code,module) VALUES(?,?,'catalog')", [id,code]);
        addedPermissions.push(id);permissionIds.set(code,id);
      }
    }
    for(const [role, codes] of [
      [medicalRole,["catalog.manage","catalog.reference_ranges.manage"]],
      [financialRole,["catalog.manage","pricing.manage"]],
    ] as const) {
      for(const code of codes)
        await exec("INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)",
          [role,permissionIds.get(code)!]);
    }
    for(const id of [clinician, finance])
      await exec("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",[id,branch]);

    const inspect = async () => {
      const [rows] = await reader.execute<mysql.RowDataPacket[]>(
        `SELECT u.id,u.status,u.mfa_enabled,
          GROUP_CONCAT(DISTINCT CASE WHEN b.status='ACTIVE' THEN s.branch_id END) branch_ids,
          GROUP_CONCAT(DISTINCT CASE WHEN r.status='ACTIVE' THEN p.code END) permission_codes
          FROM users u
          LEFT JOIN user_branch_scopes s ON s.user_id=u.id
          LEFT JOIN branches b ON b.id=s.branch_id AND b.organization_id=u.organization_id
          LEFT JOIN user_roles ur ON ur.user_id=u.id
          LEFT JOIN roles r ON r.id=ur.role_id AND r.organization_id=u.organization_id
          LEFT JOIN role_permissions rp ON rp.role_id=r.id
          LEFT JOIN permissions p ON p.id=rp.permission_id
          WHERE u.organization_id=? AND u.status='ACTIVE'
          GROUP BY u.id,u.status,u.mfa_enabled`, [org]);
      return summarizeSignatoryPlanning({
        branchId: branch, authorId: sourceAuthor,
        candidates: rows.map(x => ({
          id:String(x.id), status:String(x.status),
          mfaEnabled:Boolean(x.mfa_enabled),
          activeBranchIds:String(x.branch_ids||"").split(",").filter(Boolean),
          hasRestrictedDepartments:false, hasActiveApplicableDepartment:false,
          permissions:new Set(String(x.permission_codes||"").split(",").filter(Boolean)),
        })),
      });
    };

    await reader.beginTransaction();
    const [orgRows] = await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(orgRows.length,1);
    const ready = await inspect();
    assert.equal(ready.clinicalReviewerCandidates,1);
    assert.equal(ready.financialReviewerCandidates,1);
    assert.equal(ready.distinctPairAvailable,true);
    assert.equal(ready.signaturePolicyApproved,false);
    assert.equal(ready.clinicalApprovalAllowed,false);
    assert.equal(ready.financialApprovalAllowed,false);
    await reader.commit();

    // Simulate a permitted administrator changing privileges. The fresh
    // organization lock forces a subsequent assessment to see revocations.
    await exec("DELETE FROM role_permissions WHERE role_id=? AND permission_id=?",
      [financialRole,permissionIds.get("pricing.manage")!]);
    await exec("DELETE FROM user_branch_scopes WHERE user_id=?",[clinician]);
    await reader.beginTransaction();
    const [freshLock] = await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? FOR UPDATE",[org]);
    assert.equal(freshLock.length,1);
    const revoked = await inspect();
    assert.equal(revoked.clinicalReviewerCandidates,0);
    assert.equal(revoked.financialReviewerCandidates,0);
    assert.equal(revoked.distinctPairAvailable,false);
    assert.ok(revoked.gaps.includes("NO_INDEPENDENT_CLINICAL_REVIEW_CANDIDATE"));
    assert.ok(revoked.gaps.includes("NO_INDEPENDENT_FINANCIAL_REVIEW_CANDIDATE"));
    assert.equal(revoked.signingEnabled,false);
    const [foreign] = await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM users WHERE organization_id=? AND id=?",[org,foreignUser]);
    assert.equal(foreign.length,0);
    await reader.commit();
  } finally {
    await writer.rollback().catch(()=>{});
    await reader.rollback().catch(()=>{});
    await exec("DELETE FROM role_permissions WHERE role_id IN (?,?)",
      [medicalRole,financialRole]).catch(()=>{});
    await exec("DELETE FROM user_roles WHERE role_id IN (?,?)",
      [medicalRole,financialRole]).catch(()=>{});
    await exec("DELETE FROM user_branch_scopes WHERE user_id IN (?,?,?)",
      [sourceAuthor,clinician,finance]).catch(()=>{});
    await exec("DELETE FROM roles WHERE id IN (?,?)",
      [medicalRole,financialRole]).catch(()=>{});
    await exec("DELETE FROM users WHERE id IN (?,?,?,?)",
      [sourceAuthor,clinician,finance,foreignUser]).catch(()=>{});
    await exec("DELETE FROM branches WHERE id=?",[branch]).catch(()=>{});
    await exec("DELETE FROM organizations WHERE id IN (?,?)",
      [org,foreignOrg]).catch(()=>{});
    for(const id of addedPermissions)
      await exec("DELETE FROM permissions WHERE id=?",[id]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
