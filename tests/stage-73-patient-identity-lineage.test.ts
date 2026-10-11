import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Prisma } from "../generated/prisma/client";
import { PatientLineageIntegrityError, resolvePatientLineage } from "../src/lib/patient-identity-lineage.ts";

type Row = {
  id: string; organizationId: string; mergedIntoPatientId: string | null;
  status: string; patientNumber: string; fullNameEn: string;
  fullNameAr: string | null; mergedAt: Date | null;
};

function source(rows: Row[]) {
  const db = { patient: {
    async findFirst({ where }: { where: { id: string; organizationId: string } }) {
      return rows.find(row => row.id === where.id && row.organizationId === where.organizationId) || null;
    },
    async findMany({ where, take }: {
      where: { organizationId: string; mergedIntoPatientId: { in: string[] } }; take: number;
    }) {
      return rows.filter(row => row.organizationId === where.organizationId &&
        row.mergedIntoPatientId && where.mergedIntoPatientId.in.includes(row.mergedIntoPatientId))
        .sort((a,b)=>a.id.localeCompare(b.id)).slice(0,take);
    },
  }};
  return db as unknown as Pick<Prisma.TransactionClient,"patient">;
}
const node = (id: string, into: string | null = null, org = "ORG"): Row => ({
  id, organizationId: org, mergedIntoPatientId: into,
  status: into ? "INACTIVE" : "ACTIVE", patientNumber: id,
  fullNameEn: id, fullNameAr: null, mergedAt: into ? new Date("2026-10-01") : null,
});

test("Stage 73: multi-generation aliases resolve to canonical patient, including sideways branches",async()=>{
  const db = source([node("A","B"),node("B","C"),node("C"),node("D","B"),node("X","B","OTHER")]);
  const found = await resolvePatientLineage(db,"ORG","A");
  assert.equal(found?.canonicalId,"C");
  assert.deepEqual(new Set(found?.patientIds),new Set(["A","B","C","D"]));
  assert.equal(found?.aliases.length,3);
  assert.equal(await resolvePatientLineage(db,"OTHER","C"),null);
  await assert.rejects(()=>resolvePatientLineage(db,"OTHER","X"),PatientLineageIntegrityError);
});

test("Stage 73: missing, cross-tenant, active-linked and cyclic ancestry fail closed",async()=>{
  await assert.rejects(
    ()=>resolvePatientLineage(source([node("A","B"),node("B",null,"OTHER")]),"ORG","A"),
    PatientLineageIntegrityError,
  );
  await assert.rejects(
    ()=>resolvePatientLineage(source([node("A","B"),node("B","A")]),"ORG","A"),
    PatientLineageIntegrityError,
  );
  await assert.rejects(
    ()=>resolvePatientLineage(source([node("A","B"),{...node("B"),mergedIntoPatientId:"C"},node("C")]),"ORG","A"),
    PatientLineageIntegrityError,
  );
  await assert.rejects(
    ()=>resolvePatientLineage(source([node("A"),{...node("B","A"),status:"ACTIVE"}]),"ORG","A"),
    PatientLineageIntegrityError,
  );
});

test("Stage 73: excessive merged history is not silently truncated",async()=>{
  const rows=[node("ROOT"),...Array.from({length:513},(_,i)=>node("ALIAS-"+i,"ROOT"))];
  await assert.rejects(()=>resolvePatientLineage(source(rows),"ORG","ROOT"),PatientLineageIntegrityError);
});

test("Stage 73: history and report view reuse tenant-scoped transitive resolution",()=>{
  const history=readFileSync("src/app/patients/[id]/history/page.tsx","utf8");
  const report=readFileSync("src/app/reports/[orderId]/page.tsx","utf8");
  for(const file of [history,report]){
    assert.match(file,/resolvePatientLineage\(tx, session\.user\.organizationId,/);
    assert.match(file,/isolationLevel: "RepeatableRead"/);
  }
  assert.match(history,/const patientIds = patientIdentityGroupIds\(canonical\.id, lineage\.aliases/);
  assert.match(report,/const linkedPatientIds = lineage\?\.patientIds \|\| \[\]/);
  assert.match(history,/orderingBranchId: \{ in: branchIds \}/);
  assert.match(report,/orderingBranchId: \{ in: activeBranchIds \}/);
});
