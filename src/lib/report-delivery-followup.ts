/**
 * Read-only follow-up of promises entered by staff at registration.
 * A current FINAL/AMENDED report is "issued", NEVER "delivered".
 * Values are bound; only fixed SQL clauses and authorized placeholder counts
 * can be interpolated. All comparisons use preserved UTC snapshots.
 */
export const DELIVERY_QUEUE_PAGE_SIZE=50;
export type DeliveryFollowupStatus =
  "PENDING"|"OVERDUE"|"DUE_SOON"|"FUTURE"|"CURRENT_ISSUED"|"ALL";
export type DeliveryFollowupFilters={
  branchId:string; accession:string; status:DeliveryFollowupStatus; page:number;
};
type SqlQuery={sql:string;params:Array<string|number>};
const STATUSES=new Set<DeliveryFollowupStatus>([
  "PENDING","OVERDUE","DUE_SOON","FUTURE","CURRENT_ISSUED","ALL",
]);
function scalar(x:string|string[]|undefined){
  return x===undefined||typeof x==="string"?x:null;
}
export function parseDeliveryFollowupFilters(
  values:Record<string,string|string[]|undefined>,
  allowedBranches:readonly string[],
):{ok:true;value:DeliveryFollowupFilters}|{ok:false;error:string}{
  const p=["branchId","accession","status","page"].map(k=>scalar(values[k]));
  if(p.includes(null))return {ok:false,error:"duplicate_query_parameter"};
  const [branchId="",rawAccession="",rawStatus="PENDING",rawPage="1"]=p as string[];
  if(branchId&&!allowedBranches.includes(branchId))
    return {ok:false,error:"branch_forbidden"};
  if(!STATUSES.has(rawStatus as DeliveryFollowupStatus))
    return {ok:false,error:"invalid_delivery_filter"};
  if(!/^[1-9]\d{0,6}$/.test(rawPage))
    return {ok:false,error:"invalid_page"};
  const accession=rawAccession.trim();
  if(accession.length>50||/[\x00-\x1F\x7F]/.test(accession))
    return {ok:false,error:"invalid_accession"};
  return {ok:true,value:{
    branchId,accession,status:rawStatus as DeliveryFollowupStatus,
    page:Math.min(Number(rawPage),100000),
  }};
}

function asDatabaseUtc(now:Date){
  if(!Number.isFinite(now.valueOf()))throw Error("INVALID_DELIVERY_QUEUE_CLOCK");
  return now.toISOString().slice(0,23).replace("T"," ");
}
export function buildDeliveryFollowupQueries(input:{
  organizationId:string;
  branchIds:readonly string[];
  filters:DeliveryFollowupFilters;
  nowUtc:Date;
}):{count:SqlQuery;ids:SqlQuery}{
  const branches=[...new Set(input.branchIds)];
  if(!branches.length)throw Error("DELIVERY_QUEUE_NO_BRANCH_ACCESS");
  if(input.filters.branchId&&!branches.includes(input.filters.branchId))
    throw Error("DELIVERY_QUEUE_BRANCH_FORBIDDEN");
  const base=" FROM orders o"+
    " LEFT JOIN diagnostic_reports r ON r.order_id=o.id AND r.organization_id=o.organization_id"+
    " LEFT JOIN diagnostic_report_versions v ON v.report_id=r.id AND v.version=r.current_version";
  const where=[
    "o.organization_id = ?",
    "o.ordering_branch_id IN ("+branches.map(()=>"?").join(",")+")",
    "o.promised_report_delivery_at_utc IS NOT NULL",
    "o.status NOT IN ('CANCELLED','DRAFT')",
  ];
  const args:Array<string|number>=[input.organizationId,...branches];
  const f=input.filters;
  if(f.branchId){where.push("o.ordering_branch_id = ?");args.push(f.branchId)}
  if(f.accession){where.push("o.accession_number = ?");args.push(f.accession)}
  const currentIssued="v.status IN ('FINAL','AMENDED')";
  const pending="(v.id IS NULL OR v.status NOT IN ('FINAL','AMENDED'))";
  const nowMs=input.nowUtc.getTime();
  if(!Number.isFinite(nowMs))throw Error("INVALID_DELIVERY_QUEUE_CLOCK");
  const now=asDatabaseUtc(input.nowUtc);
  const plus24=asDatabaseUtc(new Date(nowMs+24*60*60*1000));
  switch(f.status){
    case "ALL":break;
    case "CURRENT_ISSUED":where.push(currentIssued);break;
    case "PENDING":where.push(pending);break;
    case "OVERDUE":
      where.push(pending,"o.promised_report_delivery_at_utc < ?");
      args.push(now);break;
    case "DUE_SOON":
      where.push(pending,"o.promised_report_delivery_at_utc >= ?",
        "o.promised_report_delivery_at_utc <= ?");
      args.push(now,plus24);break;
    case "FUTURE":
      where.push(pending,"o.promised_report_delivery_at_utc > ?");
      args.push(plus24);break;
  }
  const suffix=base+" WHERE "+where.join(" AND ");
  return {
    count:{sql:"SELECT COUNT(*) AS total"+suffix,params:[...args]},
    ids:{
      sql:"SELECT o.id AS orderId, o.accession_number AS accessionNumber, "+
        "o.ordering_branch_id AS orderingBranchId, o.status AS orderStatus, "+
        "o.promised_report_delivery_at_utc AS promisedUtc, "+
        "o.promised_report_delivery_local AS promisedLocal, "+
        "o.promised_report_delivery_timezone AS promisedTimezone, "+
        "v.status AS currentReportStatus, v.issued_at AS reportIssuedAt"+suffix+
        " ORDER BY o.promised_report_delivery_at_utc ASC,o.id ASC LIMIT ? OFFSET ?",
      params:[...args,DELIVERY_QUEUE_PAGE_SIZE,(f.page-1)*DELIVERY_QUEUE_PAGE_SIZE],
    },
  };
}
export function deliveryFollowupHref(f:DeliveryFollowupFilters,page:number){
  const q=new URLSearchParams();
  if(f.branchId)q.set("branchId",f.branchId);
  if(f.accession)q.set("accession",f.accession);
  q.set("status",f.status);
  q.set("page",String(page));
  return "/orders/delivery-queue?"+q.toString();
}
export function classifyDeliveryPromise(input:{
  utc:Date; now:Date; currentReportStatus:string|null;
}):"CURRENT_ISSUED"|"OVERDUE"|"DUE_SOON"|"FUTURE"{
  if(input.currentReportStatus==="FINAL"||input.currentReportStatus==="AMENDED")
    return "CURRENT_ISSUED";
  if(input.utc.getTime()<input.now.getTime())return "OVERDUE";
  if(input.utc.getTime()<=input.now.getTime()+24*60*60*1000)return "DUE_SOON";
  return "FUTURE";
}
