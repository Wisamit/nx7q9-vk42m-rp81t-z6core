import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import type { Prisma } from "../generated/prisma/client";
import { resolvePatientLineage, PatientLineageIntegrityError } from "../src/lib/patient-identity-lineage.ts";

test("Stage 73 MariaDB: multi-hop merged patient histories preserve tenant and branch scope",{
  timeout:60000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const uri=new URL(process.env.DATABASE_URL);
  const config={host:uri.hostname,port:Number(uri.port||3306),
    user:decodeURIComponent(uri.username),password:decodeURIComponent(uri.password),
    database:uri.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(config),mysql.createConnection(config)]);
  const orgA=randomUUID(),orgB=randomUUID(),branchA=randomUUID(),branchB=randomUUID(),
    branchForeign=randomUUID(),actorA=randomUUID(),actorB=randomUUID();
  const [root,middle,oldest,sibling,foreign,cycleRoot,cycleLeaf]=
    Array.from({length:7},()=>randomUUID());
  const prefix="S73"+orgA.slice(0,8);
  const cleanup:Array<{table:string;id:string}>=[];
  async function insert(table:string,id:string,sql:string,values:Array<string|number|null>){
    await writer.execute(sql,values);
    cleanup.unshift({table,id});
  }
  const db={patient:{
    async findFirst({where}:{where:{organizationId:string;id:string}}){
      const [rows]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT id,merged_into_patient_id AS mergedIntoPatientId,status,"+
        "patient_number AS patientNumber,full_name_en AS fullNameEn,"+
        "full_name_ar AS fullNameAr,merged_at AS mergedAt "+
        "FROM patients WHERE id=? AND organization_id=?",
        [where.id,where.organizationId]);
      return rows[0]||null;
    },
    async findMany({where,take}:{where:{
      organizationId:string;mergedIntoPatientId:{in:string[]}};
      take:number;
    }){
      const parents=where.mergedIntoPatientId.in;
      if(!parents.length)return [];
      const [rows]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT id,merged_into_patient_id AS mergedIntoPatientId,status,"+
        "patient_number AS patientNumber,full_name_en AS fullNameEn,"+
        "full_name_ar AS fullNameAr,merged_at AS mergedAt "+
        "FROM patients WHERE organization_id=? AND merged_into_patient_id IN ("+
        parents.map(()=>"?").join(",")+") ORDER BY id ASC LIMIT ?",
        [where.organizationId,...parents,take]);
      return rows;
    },
  }} as unknown as Pick<Prisma.TransactionClient,"patient">;
  async function addPatient(id:string,org:string,code:string,parent:string|null=null){
    await insert("patients",id,
      "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,status,merged_into_patient_id,merged_at,updated_at) "+
      "VALUES(?,?,?,?,?,?,?,?,NOW(3))",
      [id,org,prefix+code,"Stage73 "+code,"stage73 "+code,
        parent?"INACTIVE":"ACTIVE",parent,parent?"2026-10-09 12:00:00":null]);
  }
  async function addOrder(patientId:string,tenant:string,branch:string,actor:string,code:string){
    const id=randomUUID();
    await insert("orders",id,
      "INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) "+
      "VALUES(?,?,?,?,?,?,NOW(3))",
      [id,tenant,prefix+code,branch,patientId,actor]);
  }
  async function permittedOrders(tenant:string,patients:string[],branches:string[]){
    const [rows]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,patient_id FROM orders WHERE organization_id=? AND patient_id IN ("+
        patients.map(()=>"?").join(",")+") AND ordering_branch_id IN ("+
        branches.map(()=>"?").join(",")+") ORDER BY id",
      [tenant,...patients,...branches]);
    return rows.map(row=>String(row.patient_id));
  }
  try{
    await insert("organizations",orgA,
      "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [orgA,prefix+"OA","Stage73 Organization A"]);
    await insert("organizations",orgB,
      "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [orgB,prefix+"OB","Stage73 Organization B"]);
    for(const [id,org,code] of [[branchA,orgA,"BA"],[branchB,orgA,"BB"],[branchForeign,orgB,"BF"]]){
      await insert("branches",id,
        "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,prefix+code,"Stage73 Branch"]);
    }
    for(const [id,org,code] of [[actorA,orgA,"UA"],[actorB,orgB,"UB"]]){
      await insert("users",id,
        "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,prefix+code,"Stage73 Actor"]);
    }
    await addPatient(root,orgA,"ROOT");
    await addPatient(middle,orgA,"MIDDLE",root);
    await addPatient(oldest,orgA,"OLDEST",middle);
    await addPatient(sibling,orgA,"SIBLING",middle);
    await addPatient(foreign,orgB,"FOREIGN",middle);
    await addPatient(cycleRoot,orgA,"CYCLE_ROOT");
    await addPatient(cycleLeaf,orgA,"CYCLE_LEAF",cycleRoot);
    await addOrder(root,orgA,branchB,actorA,"ORDER-ROOT");
    await addOrder(oldest,orgA,branchA,actorA,"ORDER-OLDEST");
    await addOrder(sibling,orgA,branchA,actorA,"ORDER-SIBLING");
    await addOrder(foreign,orgB,branchForeign,actorB,"ORDER-FOREIGN");

    const lineage=await resolvePatientLineage(db,orgA,oldest);
    assert.equal(lineage?.canonicalId,root);
    assert.deepEqual(new Set(lineage?.patientIds),new Set([root,middle,oldest,sibling]));
    assert.deepEqual(new Set(await permittedOrders(orgA,lineage!.patientIds,[branchA])),
      new Set([oldest,sibling]));
    assert.deepEqual(new Set(await permittedOrders(orgA,lineage!.patientIds,[branchA,branchB])),
      new Set([root,oldest,sibling]));
    assert.deepEqual(await permittedOrders(orgB,lineage!.patientIds,[branchForeign]),[]);
    assert.equal((await resolvePatientLineage(db,orgA,root))?.patientIds.length,4);
    await assert.rejects(()=>resolvePatientLineage(db,orgB,foreign),PatientLineageIntegrityError);
    assert.equal(await resolvePatientLineage(db,orgA,foreign),null);

    // A second connection changes the stored merger graph. A multi-hop
    // cycle must be rejected instead of silently suppressing older visits.
    await writer.execute(
      "UPDATE patients SET merged_into_patient_id=?,status='INACTIVE' WHERE id=?",
      [cycleLeaf,cycleRoot]);
    await assert.rejects(()=>resolvePatientLineage(db,orgA,cycleLeaf),PatientLineageIntegrityError);
    await writer.execute(
      "UPDATE patients SET merged_into_patient_id=NULL,status='ACTIVE' WHERE id=?",
      [cycleRoot]);

    await writer.execute("UPDATE patients SET status='ACTIVE' WHERE id=?",[middle]);
    await assert.rejects(()=>resolvePatientLineage(db,orgA,oldest),PatientLineageIntegrityError);
    await writer.execute("UPDATE patients SET status='INACTIVE' WHERE id=?",[middle]);
    assert.equal((await resolvePatientLineage(db,orgA,oldest))?.patientIds.length,4);
  }finally{
    await writer.execute("UPDATE patients SET merged_into_patient_id=NULL,status='ACTIVE' WHERE id IN (?,?)",
      [cycleRoot,cycleLeaf]).catch(()=>{});
    // Foreign patients can point to a different tenant in bad legacy data:
    // unlink before removing the referenced source.
    await writer.execute("UPDATE patients SET merged_into_patient_id=NULL WHERE id=?",[foreign]).catch(()=>{});
    for(const item of cleanup)
      await writer.execute("DELETE FROM "+item.table+" WHERE id=?",[item.id]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
