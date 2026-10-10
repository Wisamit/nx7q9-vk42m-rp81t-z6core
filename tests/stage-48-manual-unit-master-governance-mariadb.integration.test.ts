import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { manualUnitIdentityError } from "../src/lib/catalog-manual-unit-governance.ts";

test("Stage 48 MariaDB: separate manual/import writers serialize tenant unit aliases without affecting another tenant",
  {timeout:45000},async()=>{
    if(!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
    const url=new URL(process.env.DATABASE_URL);
    const cfg={host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),
      password:decodeURIComponent(url.password),database:url.pathname.slice(1)};
    const [writer,competing]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
    const org=randomUUID(),foreign=randomUUID(),branch=randomUUID(),actor=randomUUID();
    const inactive=randomUUID(),created=randomUUID(),foreignUnit=randomUUID();
    const prefix="S48"+org.slice(0,8);
    const exec=(sql:string,args:(string|number|null)[])=>writer.execute(sql,args);
    try {
      for(const [id,code] of [[org,prefix],[foreign,"F"+prefix]]){
        await exec("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
          [id,code,"Stage 48 Unit Governance"]);
      }
      await exec("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [branch,org,prefix+"B","Stage 48 Active Branch"]);
      await exec("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [actor,org,prefix,"Stage 48 Operator"]);
      await exec("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES (?,?)",[actor,branch]);
      await exec("INSERT INTO units(id,organization_id,code,symbol,status,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [inactive,org,prefix+"OLD","mg/dL","INACTIVE"]);
      await exec("INSERT INTO units(id,organization_id,code,symbol,status,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [foreignUnit,foreign,prefix+"F","mmol/L","ACTIVE"]);

      await writer.beginTransaction();
      const [owner]=await writer.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
      assert.equal(owner.length,1);
      const [grant]=await writer.execute<mysql.RowDataPacket[]>(
        "SELECT user_id FROM user_branch_scopes WHERE user_id=? AND branch_id=?",[actor,branch]);
      assert.equal(grant.length,1);
      const [before]=await writer.execute<mysql.RowDataPacket[]>(
        "SELECT id,code,symbol,status FROM units WHERE organization_id=?",[org]);
      assert.equal(manualUnitIdentityError(before.map(r=>({
        id:String(r.id),code:String(r.code),symbol:String(r.symbol),status:String(r.status),
      })),{code:prefix+"NEW",symbol:" mg PER dL. "}),"unit_alias_conflict");
      assert.equal(manualUnitIdentityError(before.map(r=>({
        id:String(r.id),code:String(r.code),symbol:String(r.symbol),status:String(r.status),
      })),{code:prefix+"NEW",symbol:"mmol/L"}),null,
       "foreign tenant cannot reserve unit symbols within the current organization");

      await competing.beginTransaction();
      const waiting=competing.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
      await writer.execute(
        "INSERT INTO units(id,organization_id,code,symbol,status,updated_at) VALUES(?,?,?,?,'ACTIVE',NOW(3))",
        [created,org,prefix+"U","µg/mL"]);
      await writer.commit();
      const [locked]=await waiting;
      assert.equal(locked.length,1);
      const [latest]=await competing.execute<mysql.RowDataPacket[]>(
        "SELECT id,code,symbol,status FROM units WHERE organization_id=?",[org]);
      assert.equal(latest.length,2);
      const relevant=latest.map(r=>({
        id:String(r.id),code:String(r.code),symbol:String(r.symbol),status:String(r.status),
      }));
      assert.equal(manualUnitIdentityError(relevant,{code:prefix+"ANOTHER",symbol:"μg/mL"}),"unit_alias_conflict");
      assert.equal(manualUnitIdentityError(relevant,{code:prefix+"U",symbol:"new-symbol"}),"unit_alias_conflict");
      await competing.commit();

      const [count]=await writer.execute<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS total FROM units WHERE organization_id=? AND symbol IN (?,?)",
        [org,"µg/mL","μg/mL"]);
      assert.equal(Number(count[0].total),1);
    } finally {
      await writer.rollback().catch(()=>{});
      await competing.rollback().catch(()=>{});
      await exec("DELETE FROM units WHERE id IN (?,?,?)",[inactive,created,foreignUnit]).catch(()=>{});
      await exec("DELETE FROM user_branch_scopes WHERE user_id=?",[actor]).catch(()=>{});
      await exec("DELETE FROM users WHERE id=?",[actor]).catch(()=>{});
      await exec("DELETE FROM branches WHERE id=?",[branch]).catch(()=>{});
      await exec("DELETE FROM organizations WHERE id IN (?,?)",[org,foreign]).catch(()=>{});
      await Promise.all([writer.end(),competing.end()]);
    }
  });
