import test from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import {validateReferenceRangeDecimals} from "../src/lib/reference-interval-draft-decimals.ts";

test("F8 MariaDB: reference interval draft decimals match persisted schema exactly",{
  timeout:90000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const connection=await mysql.createConnection({
    host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1),
    decimalNumbers:false,
  });
  try {
    const expected:{
      [field:string]:string
    }={
      age_from:"decimal(10,3)",age_to:"decimal(10,3)",
      gestational_age_from_weeks:"decimal(6,2)",
      gestational_age_to_weeks:"decimal(6,2)",
      low_value:"decimal(18,6)",high_value:"decimal(18,6)",
      critical_low:"decimal(18,6)",critical_high:"decimal(18,6)",
    };
    const [cols]=await connection.execute<mysql.RowDataPacket[]>(
      "SELECT COLUMN_NAME,COLUMN_TYPE FROM information_schema.COLUMNS "+
      "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='reference_intervals' "+
      "AND COLUMN_NAME IN ("+Object.keys(expected).map(()=>"?").join(",")+")",
      Object.keys(expected),
    );
    assert.equal(cols.length,Object.keys(expected).length);
    for(const row of cols)
      assert.equal(String(row.COLUMN_TYPE).toLowerCase(),
        expected[String(row.COLUMN_NAME)],String(row.COLUMN_NAME));
    const admitted=validateReferenceRangeDecimals({
      lowValue:"999999999999.000001",highValue:"999999999999.000002",
      criticalLow:"-999999999999.999999",criticalHigh:"0.000001",
      ageFrom:"0.001",ageTo:"9999999.999",
      gestationalAgeFromWeeks:"0.01",gestationalAgeToWeeks:"9999.99",
    });
    assert.equal(admitted.ok,true);
    if(!admitted.ok)return;
    const [rows]=await connection.execute<mysql.RowDataPacket[]>(
      "SELECT CAST(? AS DECIMAL(18,6)) AS low_exact, "+
      "CAST(? AS DECIMAL(18,6)) AS high_exact, "+
      "CAST(? AS DECIMAL(18,6)) AS critical_exact, "+
      "CAST(? AS DECIMAL(10,3)) AS age_exact, "+
      "CAST(? AS DECIMAL(6,2)) AS gestational_exact",
      [admitted.values.lowValue,admitted.values.highValue,
       admitted.values.criticalLow,admitted.values.ageTo,
       admitted.values.gestationalAgeToWeeks]
    );
    assert.equal(rows[0].low_exact,"999999999999.000001");
    assert.equal(rows[0].high_exact,"999999999999.000002");
    assert.equal(rows[0].critical_exact,"-999999999999.999999");
    assert.equal(rows[0].age_exact,"9999999.999");
    assert.equal(rows[0].gestational_exact,"9999.99");
  }finally{await connection.end();}
});
