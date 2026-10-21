import {randomUUID} from "node:crypto";
import type mysql from "mysql2/promise";

/**
 * MariaDB transaction test driver for the exact Prisma methods used by F2.
 * Uses a REAL isolated MySQL transaction without loading Next/Prisma's
 * bundler-generated TS client in the plain Node test runner.
 * This test-only boundary must not be imported by production code.
 */
type SqlValue=string|number|Date|null|boolean;
type Row=Record<string,unknown>;
type Where=Record<string,unknown>;
const rec=(value:unknown):Row=>{
  if(!value||typeof value!=="object"||Array.isArray(value))
    throw Error("f2_mariadb_test_invalid_record");
  return value as Row;
};
const names:Readonly<Record<string,string>>={
  id:"id",organizationId:"organization_id",branchId:"branch_id",
  actorUserId:"actor_user_id",entityType:"entity_type",
  entityId:"entity_id",action:"action",newValues:"new_values",
  priceListId:"price_list_id",testId:"test_id",packageId:"package_id",
  unitPrice:"unit_price",effectiveFrom:"effective_from",
  effectiveTo:"effective_to",status:"status",
  deactivatedAt:"deactivated_at",componentId:"component_id",
  methodId:"method_id",analyzerId:"analyzer_id",
  specimenTypeId:"specimen_type_id",sex:"sex",
  ageFrom:"age_from",ageTo:"age_to",ageUnit:"age_unit",
  pregnancyStatus:"pregnancy_status",gestationalAgeFromWeeks:"gestational_age_from_weeks",
  gestationalAgeToWeeks:"gestational_age_to_weeks",
  populationCode:"population_code",lowValue:"low_value",highValue:"high_value",
  normalTextEn:"normal_text_en",normalTextAr:"normal_text_ar",
  criticalLow:"critical_low",criticalHigh:"critical_high",
  source:"source",notes:"notes",approvalStatus:"approval_status",
  createdByUserId:"created_by_user_id",approvedByUserId:"approved_by_user_id",
  approvedAt:"approved_at",retiredAt:"retired_at",retiredByUserId:"retired_by_user_id",
  retirementReason:"retirement_reason",
};
const column=(key:string):string=>{
  const name=names[key];
  if(!name)throw Error("f2_mariadb_test_unknown_column_"+key);
  return "`"+name+"`";
};
const scalar=(x:unknown):SqlValue=>{
  if(x===null||typeof x==="string"||typeof x==="number"||
     typeof x==="boolean"||x instanceof Date)return x as SqlValue;
  throw Error("f2_mariadb_test_invalid_scalar");
};
const predicates=(where:Where)=>{
  const parts:string[]=[],args:SqlValue[]=[];
  for(const [key,value]of Object.entries(where)){
    const col=column(key);
    if(value===null)parts.push(col+" IS NULL");
    else if(value&&typeof value==="object"&&"in"in value){
      const list=rec(value).in;
      if(!Array.isArray(list)||!list.length)throw Error("f2_mariadb_test_empty_in");
      parts.push(col+" IN ("+list.map(()=>"?").join(",")+")");
      args.push(...list.map(scalar));
    }else{
      parts.push(col+" = ?");
      args.push(scalar(value));
    }
  }
  if(!parts.length)throw Error("f2_mariadb_test_unscoped_where");
  return {sql:parts.join(" AND "),args};
};

export function f2MysqlTransactionalTestClient(db:mysql.Connection){
  const read=async(table:string,where:Where,limit:number)=>{
    const pred=predicates(where);
    const [raw]=await db.query<mysql.RowDataPacket[]>(
      "SELECT * FROM `"+table+"` WHERE "+pred.sql+" LIMIT ?",
      [...pred.args,limit]);
    return raw;
  };
  const insert=async(table:string,values:Row)=>{
    const data={id:randomUUID(),...values};
    const keys=Object.keys(data),cols=keys.map(column);
    const params=keys.map(key=>
      key==="newValues"?JSON.stringify(data[key]):scalar(data[key]));
    await db.execute("INSERT INTO `"+table+"` ("+cols.join(",")+
      ") VALUES ("+keys.map(()=>"?").join(",")+")",params);
    return {id:data.id};
  };
  const update=async(table:string,where:Where,data:Row)=>{
    const fields=Object.keys(data);
    if(!fields.length)throw Error("f2_mariadb_test_empty_update");
    const pred=predicates(where);
    const [out]=await db.execute<mysql.ResultSetHeader>(
      "UPDATE `"+table+"` SET "+fields.map(key=>column(key)+"=?").join(",")+
      " WHERE "+pred.sql,
      [...fields.map(key=>scalar(data[key])),...pred.args]);
    return {count:out.affectedRows};
  };
  const table=(name:string)=>({
    findMany:async(opts:{where:Where;take?:number})=>{
      const values=await read(name,opts.where,opts.take??5000);
      return values.map(row=>({
        ...Object.fromEntries(Object.entries(row).map(([key,value])=>
          [Object.entries(names).find(([,v])=>v===key)?.[0]||key,value])),
        newValues:typeof row.new_values==="string"?
          JSON.parse(row.new_values):row.new_values,
      }));
    },
    create:async(opts:{data:Row})=>insert(name,opts.data),
    updateMany:async(opts:{where:Where;data:Row})=>update(name,opts.where,opts.data),
  });
  const audit=table("audit_events");
  const price=table("price_list_items"),packagePrice=table("price_list_package_items");
  const range=table("reference_intervals");
  return {
    auditEvent:audit,
    priceListItem:{
      ...price,
      findFirst:async(opts:{where:Where})=>{
        const data=rec(opts.where);
        if(!data.orderItems)return null;
        const [rows]=await db.execute<mysql.RowDataPacket[]>(
          "SELECT id FROM order_items WHERE price_list_item_id=? LIMIT 1",
          [scalar(data.id)]);
        return rows[0]??null;
      },
    },
    priceListPackageItem:{
      ...packagePrice,
      findFirst:async(opts:{where:Where})=>{
        const data=rec(opts.where);
        if(!data.orderPackages)return null;
        const [rows]=await db.execute<mysql.RowDataPacket[]>(
          "SELECT id FROM order_packages WHERE price_list_package_item_id=? LIMIT 1",
          [scalar(data.id)]);
        return rows[0]??null;
      },
    },
    referenceInterval:{
      ...range,
      findFirst:async(opts:{where:Where})=>{
        const data=rec(opts.where);
        if(!data.resultValues)return null;
        const [rows]=await db.execute<mysql.RowDataPacket[]>(
          "SELECT id FROM laboratory_result_values WHERE reference_interval_id=? LIMIT 1",
          [scalar(data.id)]);
        return rows[0]??null;
      },
    },
  };
}
