import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {Prisma,PrismaClient} from "../generated/prisma/client.ts";
import {PrismaMariaDb} from "@prisma/adapter-mariadb";
import {evaluateDelta} from "../src/lib/delta-check.ts";
import {evaluateAutoverification} from "../src/lib/autoverification.ts";
import {automatedTechnicalReviewOutcome,snapshotValidationPolicy} from "../src/lib/result-validation.ts";

test("Stage 125 MariaDB: non-comparable historical Delta blocks auto technical approval until real comparable baseline exists",
  {timeout:90000},async()=>{
    if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
    const u=new URL(process.env.DATABASE_URL);
    const cfg={host:u.hostname,port:Number(u.port||3306),
      user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
      database:u.pathname.slice(1)};
    const [writer,rival]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
    const prisma=new PrismaClient({adapter:new PrismaMariaDb({...cfg,connectionLimit:3})});
    const org=randomUUID(),branch=randomUUID(),user=randomUUID(),patient=randomUUID(),
      testId=randomUUID(),method=randomUUID(),otherMethod=randomUUID(),unit=randomUUID(),
      policyId=randomUUID(),ruleId=randomUUID(),suffix=org.slice(0,8);
    const cleanup:Array<{table:string;id:string}>=[];
    async function put(conn:mysql.Connection,table:string,id:string,sql:string,args:(string|number|null)[]){
      await conn.execute(sql,args);cleanup.unshift({table,id});
    }
    const now=new Date(),day=86400000;
    const dt=(n:number)=>new Date(now.getTime()-n*day).toISOString().slice(0,23).replace("T"," ");
    async function previous(conn:mysql.Connection,methodId:string,ageDays:number){
      const order=randomUUID(),item=randomUUID(),result=randomUUID(),value=randomUUID();
      await put(conn,"orders",order,
        "INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
        [order,org,"S125"+suffix+order.slice(0,8),branch,patient,user]);
      await put(conn,"order_items",item,
        "INSERT INTO order_items(id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) VALUES(?,?,?,?,?,'AED',NOW(3))",
        [item,order,testId,"S125"+suffix,"Synthetic analyte"]);
      await put(conn,"laboratory_results",result,
        "INSERT INTO laboratory_results(id,organization_id,order_item_id,performing_branch_id,method_id,entered_by_user_id,status,released_at,updated_at) VALUES(?,?,?,?,?,?,'RELEASED',?,NOW(3))",
        [result,org,item,branch,methodId,user,dt(ageDays)]);
      await put(conn,"laboratory_result_values",value,
        "INSERT INTO laboratory_result_values(id,result_id,component_code_snapshot,component_name_en_snapshot,result_type_snapshot,value_numeric,display_value,unit_id,unit_snapshot,updated_at) VALUES(?,?,?,'Synthetic','NUMERIC',?,?,?,?,NOW(3))",
        [value,result,"TSH","5.00000000","5.00000000",unit,"mIU/L"]);
    }
    try{
      await put(writer,"organizations",org,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [org,"S125"+suffix,"Synthetic clinical organization"]);
      await put(writer,"branches",branch,
        "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [branch,org,"S125"+suffix,"Synthetic branch"]);
      await put(writer,"users",user,
        "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [user,org,"s125"+suffix,"Synthetic author"]);
      await put(writer,"patients",patient,
        "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [patient,org,"S125"+suffix,"Synthetic","synthetic"]);
      await put(writer,"lab_tests",testId,
        "INSERT INTO lab_tests(id,organization_id,code,name_en,result_type,updated_at) VALUES(?,?,?,?,'NUMERIC',NOW(3))",
        [testId,org,"S125"+suffix,"Synthetic analyte"]);
      for(const [id,x]of [[method,"A"],[otherMethod,"B"]]){
        await put(writer,"methods",id,
          "INSERT INTO methods(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
          [id,org,"S125"+suffix+x,"Synthetic method"]);
      }
      await put(writer,"units",unit,
        "INSERT INTO units(id,organization_id,code,symbol,updated_at) VALUES(?,?,?,?,NOW(3))",
        [unit,org,"S125"+suffix,"mIU/L"]);
      await put(writer,"delta_rules",ruleId,
        "INSERT INTO delta_rules(id,organization_id,test_id,method_id,absolute_limit,lookback_days,effective_from,status,updated_at) VALUES(?,?,?,?,5,365,?,'ACTIVE',NOW(3))",
        [ruleId,org,testId,method,dt(40)]);
      await put(writer,"autoverification_policies",policyId,
        "INSERT INTO autoverification_policies(id,organization_id,test_id,branch_id,enabled,allow_manual,allow_analyzer,require_no_critical,require_delta_within_limit,require_no_pending_reflex,require_no_blocking_holds,effective_from,status,updated_at) "+
        "VALUES(?,?,?,?,1,1,1,1,1,1,1,?,'ACTIVE',NOW(3))",
        [policyId,org,testId,branch,dt(40)]);
      // Historical observation exists, but a different method makes it
      // invalid evidence for the configured analyte's Delta comparison.
      await previous(writer,otherMethod,12);
      const input={organizationId:org,patientId:patient,testId,componentId:null,
        componentCode:"TSH",unitId:unit,unitSnapshot:"mIU/L",
        performingBranchId:branch,methodId:method,currentValue:new Prisma.Decimal("6"),
        at:now};
      const configured=await prisma.autoverificationPolicy.findUniqueOrThrow({
        where:{id:policyId},
      });
      assert.equal(configured.status,"ACTIVE");
      assert.equal(configured.requireDeltaWithinLimit,true);
      const policy={id:configured.id,enabled:configured.enabled,
        allowManual:configured.allowManual,allowAnalyzer:configured.allowAnalyzer,
        allowImport:configured.allowImport,
        requireNoCritical:configured.requireNoCritical,
        requireDeltaWithinLimit:configured.requireDeltaWithinLimit,
        requireNoPendingReflex:configured.requireNoPendingReflex,
        requireNoBlockingHolds:configured.requireNoBlockingHolds,
        requireAllFlagsNormal:configured.requireAllFlagsNormal};
      async function decision(){
        const delta=await evaluateDelta(prisma,input);
        const reviewed=evaluateAutoverification({
          policy,source:"ANALYZER",complete:true,
          values:[{flag:"NORMAL",isAbnormal:false,isCritical:false,
            deltaEvaluation:delta.evaluation}],
          pendingReflexCount:0,blockingHoldCount:0,
          qcGate:{status:"PASS",reasons:[]},
        });
        const technical=automatedTechnicalReviewOutcome(snapshotValidationPolicy(null),
          {eligible:reviewed.eligible,complete:true});
        return {delta,reviewed,technical};
      }
      const refused=await decision();
      assert.equal(refused.delta.ruleId,ruleId);
      assert.equal(refused.delta.evaluation,"NO_PREVIOUS_RESULT");
      assert.equal(refused.delta.previousValue,null);
      assert.deepEqual(refused.reviewed.reasons,["DELTA_COMPARABLE_BASELINE_REQUIRED"]);
      assert.equal(refused.reviewed.eligible,false);
      assert.equal(refused.technical.validationStage,"TECHNICAL_REVIEW");
      assert.equal(refused.technical.resultStatus,"ENTERED");

      // A separate DB connection adds a genuinely comparable released
      // observation: never modify an existing released clinical record.
      await previous(rival,method,8);
      const permitted=await decision();
      assert.equal(permitted.delta.evaluation,"WITHIN_LIMIT");
      assert.equal(permitted.delta.previousValue?.toString(),"5");
      assert.equal(permitted.reviewed.eligible,true);
      assert.deepEqual(permitted.reviewed.reasons,[]);
      assert.equal(permitted.technical.validationStage,"COMPLETE");
      assert.equal(permitted.technical.resultStatus,"VERIFIED");
    }finally{
      await Promise.all([writer.rollback().catch(()=>{}),rival.rollback().catch(()=>{})]);
      for(const {table,id}of cleanup)await writer.execute(
        "DELETE FROM "+table+" WHERE id=?",[id]).catch(()=>{});
      await Promise.all([writer.end(),rival.end(),prisma.$disconnect()]);
    }
  });
