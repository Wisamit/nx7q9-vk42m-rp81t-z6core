import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {Prisma} from "../generated/prisma/client.ts";
import {prisma} from "../src/lib/db.ts";
import {evaluateDelta} from "../src/lib/delta-check.ts";

test("Stage 124 MariaDB: never compare a historical value with a different legacy code, method, or unit",
  {timeout:90000},async()=>{
    if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
    const u=new URL(process.env.DATABASE_URL);
    const cfg={host:u.hostname,port:Number(u.port||3306),
      user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
      database:u.pathname.slice(1)};
    const [writer,rival]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
    const org=randomUUID(),branch=randomUUID(),user=randomUUID(),patient=randomUUID(),
      testId=randomUUID(),methodA=randomUUID(),methodB=randomUUID(),unitA=randomUUID(),
      unitB=randomUUID(),ruleId=randomUUID(),suffix=org.slice(0,8);
    const undo:Array<{table:string;id:string}>=[];
    async function put(table:string,id:string,sql:string,args:(string|number|null)[]){
      await writer.execute(sql,args);undo.unshift({table,id});
    }
    const anchor=new Date(),day=86_400_000;
    const datetime=(days:number)=>new Date(anchor.getTime()-days*day).toISOString()
      .slice(0,23).replace("T"," ");
    async function releasedValue(opts:{
      code:string;days:number;method:string|null;unitId:string|null;
      unitText:string|null;value:string;
    }){
      const orderId=randomUUID(),itemId=randomUUID(),resultId=randomUUID(),valueId=randomUUID();
      await put("orders",orderId,
        "INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
        [orderId,org,"S124"+suffix+orderId.slice(0,8),branch,patient,user]);
      await put("order_items",itemId,
        "INSERT INTO order_items(id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) VALUES(?,?,?,?,?,'AED',NOW(3))",
        [itemId,orderId,testId,"S124"+suffix,"Synthetic test"]);
      await put("laboratory_results",resultId,
        "INSERT INTO laboratory_results(id,organization_id,order_item_id,performing_branch_id,method_id,entered_by_user_id,status,released_at,updated_at) VALUES(?,?,?,?,?,?,'RELEASED',?,NOW(3))",
        [resultId,org,itemId,branch,opts.method,user,datetime(opts.days)]);
      await put("laboratory_result_values",valueId,
        "INSERT INTO laboratory_result_values(id,result_id,component_code_snapshot,component_name_en_snapshot,result_type_snapshot,value_numeric,display_value,unit_id,unit_snapshot,updated_at) VALUES(?,?,?,'Synthetic numeric','NUMERIC',?,?,?,?,NOW(3))",
        [valueId,resultId,opts.code,opts.value,opts.value,opts.unitId,opts.unitText]);
      return resultId;
    }
    try{
      await put("organizations",org,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [org,"S124"+suffix,"Stage 124 synthetic"]);
      await put("branches",branch,
        "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [branch,org,"S124"+suffix,"Synthetic branch"]);
      await put("users",user,
        "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [user,org,"s124"+suffix,"Synthetic user"]);
      await put("patients",patient,
        "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [patient,org,"S124"+suffix,"Synthetic patient","synthetic patient"]);
      await put("lab_tests",testId,
        "INSERT INTO lab_tests(id,organization_id,code,name_en,result_type,updated_at) VALUES(?,?,?,?,'NUMERIC',NOW(3))",
        [testId,org,"S124"+suffix,"Synthetic test"]);
      for(const [id,code]of [[methodA,"A"],[methodB,"B"]]){
        await put("methods",id,
          "INSERT INTO methods(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
          [id,org,"S124"+suffix+code,"Synthetic method"]);
      }
      for(const [id,code]of [[unitA,"A"],[unitB,"B"]]){
        await put("units",id,
          "INSERT INTO units(id,organization_id,code,symbol,updated_at) VALUES(?,?,?,?,NOW(3))",
          [id,org,"S124"+suffix+code,code==="A"?"mIU/L":"IU/L"]);
      }
      await put("delta_rules",ruleId,
        "INSERT INTO delta_rules(id,organization_id,test_id,method_id,absolute_limit,lookback_days,effective_from,status,updated_at) VALUES(?,?,?,?,3,365,?,'ACTIVE',NOW(3))",
        [ruleId,org,testId,methodA,datetime(30)]);

      const comparable=await releasedValue({
        code:"TSH",days:15,method:methodA,unitId:unitA,unitText:"mIU/L",value:"10.00000000"});
      await releasedValue({
        code:"UNRELATED",days:3,method:methodA,unitId:unitA,unitText:"mIU/L",value:"99.00000000"});
      await releasedValue({
        code:"TSH",days:4,method:methodB,unitId:unitA,unitText:"mIU/L",value:"88.00000000"});
      await releasedValue({
        code:"TSH",days:5,method:methodA,unitId:unitB,unitText:"IU/L",value:"77.00000000"});
      await releasedValue({
        code:"TSH",days:6,method:methodA,unitId:unitA,unitText:"old-mIU/L",value:"66.00000000"});
      const input={
        organizationId:org,patientId:patient,testId,componentId:null,
        componentCode:"TSH",unitId:unitA,unitSnapshot:"mIU/L",
        performingBranchId:branch,methodId:methodA,
        currentValue:new Prisma.Decimal("20.00000000"),at:anchor,
      };
      const comparison=await evaluateDelta(prisma,input);
      assert.equal(comparison.ruleId,ruleId);
      assert.equal(comparison.evaluation,"EXCEEDED");
      assert.equal(comparison.previousValue?.toString(),"10");
      assert.equal(comparison.deltaAbsolute?.toString(),"10");
      assert.equal(comparison.lookbackDays,365);

      // Any other test-code observation under the same TEST must never be
      // treated as a prior reading when componentId is null.
      const other=await evaluateDelta(prisma,{...input,componentCode:"NOT_A_TSH"});
      assert.equal(other.evaluation,"NO_PREVIOUS_RESULT");
      assert.equal(other.previousValue,null);

      // A second connection amends the ONLY comparable result. Wrong-code,
      // wrong-method and wrong-unit observations cannot take its place.
      await rival.execute("UPDATE laboratory_results SET status='AMENDED' WHERE id=?",
        [comparable]);
      const noHistory=await evaluateDelta(prisma,input);
      assert.equal(noHistory.evaluation,"NO_PREVIOUS_RESULT");
      assert.equal(noHistory.previousValue,null);
    }finally{
      await Promise.all([writer.rollback().catch(()=>{}),rival.rollback().catch(()=>{})]);
      for(const {table,id}of undo)await writer.execute(
        "DELETE FROM "+table+" WHERE id=?",[id]).catch(()=>{});
      await Promise.all([writer.end(),rival.end()]);
    }
  });
