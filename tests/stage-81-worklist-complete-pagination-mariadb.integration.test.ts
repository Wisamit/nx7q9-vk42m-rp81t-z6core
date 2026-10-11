import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  worklistPage, decodeWorklistCursor, type WorklistFilterState,
  type WorklistCursorPosition,
} from "../src/lib/worklist-pagination.ts";

test("Stage 81 MariaDB: all 315 authorized worklist items remain accessible past prior 300 cap and filters stay branch/department scoped",{
  timeout:120000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),
    user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),outsideOrg=randomUUID(),allowedBranch=randomUUID(),hiddenBranch=randomUUID(),
    outsideBranch=randomUUID(),staff=randomUUID(),outsideStaff=randomUUID(),patient=randomUUID(),
    outsidePatient=randomUUID(),department=randomUUID(),hiddenDepartment=randomUUID(),
    outsideDepartment=randomUUID(),testId=randomUUID(),hiddenTest=randomUUID(),outsideTest=randomUUID();
  const prefix="S81"+org.slice(0,8);
  const cleanup:Array<{table:string,id:string}>=[];
  const cases:Array<{
    orderId:string;itemId:string;specimenId:string;
    tenant:string;branch:string;dep:string;createdAt:Date;priority:"STAT"|"ROUTINE";
  }>=[];
  async function put(table:string,id:string,sql:string,parameters:(string|number|Date|null)[]){
    await writer.execute(sql,parameters);
    cleanup.unshift({table,id});
  }
  async function batch(prefixSql:string,records:(string|number|Date|null)[][]){
    for(let i=0;i<records.length;i+=55){
      const chunk=records.slice(i,i+55);
      const ph=chunk.map(row=>"("+row.map(()=>"?").join(",")+")").join(",");
      await writer.execute(prefixSql+ph,chunk.flat());
    }
  }
  const filters:WorklistFilterState={q:"",status:"",branch:allowedBranch,department,
    priority:"",specimenStatus:"RECEIVED",due:"",analyzer:""};
  async function selectPage(cursor:WorklistCursorPosition|null,priority:"STAT"|"ROUTINE"|null){
    const where=[
      "o.organization_id=?","s.current_branch_id=?","s.status='RECEIVED'",
      "link.status='ACTIVE'","oi.status<>'CANCELLED'","t.department_id=?",
    ];
    const args:(string|number|Date|null)[]=[org,allowedBranch,department];
    if(priority){where.push("o.priority=?");args.push(priority);}
    if(cursor){
      where.push("(oi.created_at>? OR (oi.created_at=? AND oi.id>?))");
      args.push(cursor.createdAt,cursor.createdAt,cursor.id);
    }
    const [rows]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT oi.id,oi.created_at,o.organization_id,o.priority,"+
      "s.current_branch_id,t.department_id FROM order_items oi "+
      "JOIN orders o ON o.id=oi.order_id JOIN lab_tests t ON t.id=oi.test_id "+
      "JOIN specimen_order_items link ON link.order_item_id=oi.id "+
      "JOIN specimens s ON s.id=link.specimen_id "+
      "WHERE "+where.join(" AND ")+" "+
      "ORDER BY oi.created_at ASC,oi.id ASC LIMIT 51",args);
    return rows.map(row=>({
      id:String(row.id),createdAt:new Date(row.created_at),
      org:String(row.organization_id),branch:String(row.current_branch_id),
      department:String(row.department_id),priority:String(row.priority),
    }));
  }
  try {
    for(const [id,code] of [[org,"A"],[outsideOrg,"X"]]){
      await put("organizations",id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,prefix+code,"Stage81 Tenant"]);
    }
    for(const [id,tenant,code] of [
      [allowedBranch,org,"A"],[hiddenBranch,org,"B"],[outsideBranch,outsideOrg,"X"],
    ]){
      await put("branches",id,
        "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,tenant,prefix+code,"Stage81 Branch"]);
    }
    for(const [id,tenant,code] of [[staff,org,"A"],[outsideStaff,outsideOrg,"X"]]){
      await put("users",id,
        "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,tenant,prefix+code,"Stage81 User"]);
    }
    for(const [id,tenant,code] of [[patient,org,"A"],[outsidePatient,outsideOrg,"X"]]){
      await put("patients",id,
        "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) "+
        "VALUES(?,?,?,?,?,NOW(3))",[id,tenant,prefix+code,"Stage81 Patient","stage81 patient"]);
    }
    for(const [id,tenant,code] of [
      [department,org,"A"],[hiddenDepartment,org,"B"],[outsideDepartment,outsideOrg,"X"],
    ]){
      await put("departments",id,
        "INSERT INTO departments(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,tenant,prefix+code,"Stage81 Department"]);
    }
    for(const [id,tenant,code,dept] of [
      [testId,org,"A",department],[hiddenTest,org,"B",hiddenDepartment],
      [outsideTest,outsideOrg,"X",outsideDepartment],
    ]){
      await put("lab_tests",id,
        "INSERT INTO lab_tests(id,organization_id,code,name_en,department_id,updated_at) "+
        "VALUES(?,?,?,?,?,NOW(3))",[id,tenant,prefix+code,"Stage81 Test",dept]);
    }
    for(let i=0;i<331;i++){
      const tenant=i<326?org:outsideOrg;
      const branch=i<315?allowedBranch:i<321?hiddenBranch:i<326?allowedBranch:outsideBranch;
      const dep=i<321?department:i<326?hiddenDepartment:outsideDepartment;
      const createdAt=new Date(Date.UTC(2026,9,10,8,Math.floor(i/6),0,0));
      cases.push({orderId:randomUUID(),itemId:randomUUID(),specimenId:randomUUID(),
        tenant,branch,dep,createdAt,priority:i%3===0?"STAT":"ROUTINE"});
    }
    await batch(
      "INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,"+
      "created_by_user_id,priority,ordered_at,updated_at) VALUES ",
      cases.map((c,i)=>[c.orderId,c.tenant,prefix+"-A-"+i,c.branch,
        c.tenant===org?patient:outsidePatient,c.tenant===org?staff:outsideStaff,c.priority,
        c.createdAt,c.createdAt]));
    await batch(
      "INSERT INTO order_items(id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,"+
      "currency,created_at,updated_at) VALUES ",
      cases.map(c=>[c.itemId,c.orderId,c.tenant===outsideOrg?outsideTest:
        c.dep===hiddenDepartment?hiddenTest:testId,"BLOOD","Stage81 Test","AED",c.createdAt,c.createdAt]));
    await batch(
      "INSERT INTO specimens(id,organization_id,order_id,barcode,sequence_number,status,"+
      "current_branch_id,created_at,updated_at) VALUES ",
      cases.map((c,i)=>[c.specimenId,c.tenant,c.orderId,prefix+"-BC-"+i,1,"RECEIVED",
        c.branch,c.createdAt,c.createdAt]));
    await batch(
      "INSERT INTO specimen_order_items(specimen_id,order_item_id,status) VALUES ",
      cases.map(c=>[c.specimenId,c.itemId,"ACTIVE"]));
    const eligible=cases.slice(0,315);
    const allowedIds=new Set(eligible.map(c=>c.itemId));
    for(const selectedPriority of [null,"STAT"] as Array<"STAT"|null>){
      const scopedFilters={...filters,priority:selectedPriority||""};
      const expected=eligible.filter(c=>!selectedPriority||c.priority===selectedPriority).length;
      const visited=new Set<string>();
      let after:WorklistCursorPosition|null=null;
      let pages=0;
      while(true){
        const rows=await selectPage(after,selectedPriority);
        const p=worklistPage(rows,scopedFilters);
        assert.ok(p.rows.length<=50);
        for(const row of p.rows){
          assert.ok(allowedIds.has(row.id),"restricted or foreign item disclosed");
          assert.equal(row.org,org);assert.equal(row.branch,allowedBranch);
          assert.equal(row.department,department);
          assert.equal(visited.has(row.id),false,"duplicate across pages");
          visited.add(row.id);
        }
        pages++;
        if(!p.hasNext){assert.equal(p.nextCursor,null);break;}
        assert.ok(p.nextCursor);
        after=decodeWorklistCursor(p.nextCursor,scopedFilters);
        assert.ok(after,"cursor must decode on next page");
        assert.ok(pages<11,"cursor should make forward progress");
      }
      assert.equal(visited.size,expected);
      if(!selectedPriority)assert.ok(pages>=7,"must reach beyond the old 300-item cap");
      assert.equal(visited.has(cases[315].itemId),false);
      assert.equal(visited.has(cases[325].itemId),false);
      assert.equal(visited.has(cases[330].itemId),false);
    }
  }finally{
    const scopedOrders="(SELECT id FROM orders WHERE accession_number LIKE ?)";
    const marker=prefix+"-A-%";
    await writer.execute("DELETE FROM specimen_order_items WHERE order_item_id IN "+
      "(SELECT id FROM order_items WHERE order_id IN "+scopedOrders+")",[marker]).catch(()=>{});
    await writer.execute("DELETE FROM specimens WHERE order_id IN "+scopedOrders,[marker]).catch(()=>{});
    await writer.execute("DELETE FROM order_items WHERE order_id IN "+scopedOrders,[marker]).catch(()=>{});
    await writer.execute("DELETE FROM orders WHERE accession_number LIKE ?",[marker]).catch(()=>{});
    for(const row of cleanup)
      await writer.execute("DELETE FROM "+row.table+" WHERE id=?",[row.id]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
