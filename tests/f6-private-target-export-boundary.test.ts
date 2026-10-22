import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {exportF3TargetLineage} from "../scripts/legacy/export-target-lineage.mjs";

const organizationId="00000000-0000-4000-8000-000000000001";
const sourceSha256="a".repeat(64);
const args={
  databaseUrl:"mysql://synthetic:test@example.invalid/f6_synthetic",
  organizationId,sourceSha256,outputPath:"/tmp/f6-private-test-output.json",
};

test("F6: F3 private target export refuses remote MariaDB without verified TLS trust anchor",async()=>{
  await assert.rejects(()=>exportF3TargetLineage(args),
    /f3_remote_database_tls_ca_required/);
  await assert.rejects(()=>exportF3TargetLineage({...args,caFile:"relative-cert.pem"}),
    /f3_remote_database_tls_ca_required/);
  await assert.rejects(()=>exportF3TargetLineage({
    ...args,organizationId:"not-a-uuid",
  }),/f3_export_invalid_arguments/);
});

test("F6: private verifier binds literal source extension to Jet/ACE header, not filename alone",()=>{
  const verifier=readFileSync("scripts/legacy/verify-evidence-package.mjs","utf8");
  const reconciler=readFileSync("scripts/legacy/verify-target-reconciliation.mjs","utf8");
  const exporter=readFileSync("scripts/legacy/export-target-lineage.mjs","utf8");
  assert.ok(verifier.includes("Standard ACE DB"));
  assert.ok(verifier.includes("Standard Jet DB"));
  assert.ok(verifier.includes("const accdb="));
  assert.ok(reconciler.includes('if(!/\\.(?:mdb|accdb)$/i.test(basename(mdb)))'));
  assert.ok(exporter.includes("START TRANSACTION READ ONLY"));
  assert.ok(exporter.includes("organization_id=? AND source_sha256=? AND id>?"));
  assert.ok(exporter.includes('open(outputPath,"wx",0o600)'));
  assert.ok(exporter.includes("rejectUnauthorized:true"));
  assert.ok(!exporter.includes("console.log(rows)"));
});
