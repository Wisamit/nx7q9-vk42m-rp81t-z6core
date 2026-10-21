import type {Prisma} from "../../generated/prisma/client";
import type {F3LineageDecision} from "./f3-legacy-source-reconciliation.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES=[
  "TEST","COMPONENT","PANEL","PACKAGE","UNIT","CONTAINER",
  "REFERENCE_INTERVAL","PRICE_LIST","PRICE_LIST_ITEM",
  "PRICE_LIST_PACKAGE_ITEM","CONTRACT","REFERRER","SOURCE",
  "CLIENT","ORGANISM","ANTIBIOTIC","COMMENT_TEMPLATE",
] as const;
type Type=typeof TYPES[number];
const KNOWN=new Set<string>(TYPES);
/**
 * Tenant-locked bulk existence check of all proposed legacy row target IDs,
 * after the operator's whole-organization access has been reauthenticated.
 *
 * A historical classification does not grant current access or guarantee
 * that a target still belongs to the claimed organization. Never discover a
 * cross-tenant target by name, code or raw Access value.
 */
export async function f3LiveLineageTargetsVisible(
  tx:Prisma.TransactionClient,input:{
    organizationId:string;
    lineage:readonly F3LineageDecision[];
    currentOrganizationScopeVerified:true;
  },
):Promise<boolean>{
  if(input.currentOrganizationScopeVerified!==true||
     !UUID.test(input.organizationId)||input.lineage.length>20000)
    return false;
  const ids=new Map<Type,Set<string>>();
  for(const row of input.lineage){
    if(row.organizationId!==input.organizationId)return false;
    if(row.classification!=="MAPPED"&&
       row.classification!=="APPROVED_MAPPING")continue;
    if(!row.targetType||!KNOWN.has(row.targetType)||
       !row.targetId||!UUID.test(row.targetId))
      return false;
    const kind=row.targetType as Type;
    const bucket=ids.get(kind)||new Set<string>();
    bucket.add(row.targetId.toLowerCase());
    ids.set(kind,bucket);
  }
  for(const [type,items] of ids){
    const filter={id:{in:[...items]}};
    const org=input.organizationId;
    let rows:Array<{id:string}>;
    switch(type){
      case "TEST":
        rows=await tx.labTest.findMany({
          where:{...filter,organizationId:org},select:{id:true}});
        break;
      case "COMPONENT":
        rows=await tx.testComponent.findMany({
          where:{...filter,test:{organizationId:org}},select:{id:true}});
        break;
      case "PANEL":
        rows=await tx.testPanel.findMany({
          where:{...filter,organizationId:org},select:{id:true}});
        break;
      case "PACKAGE":
        rows=await tx.commercialPackage.findMany({
          where:{...filter,organizationId:org},select:{id:true}});
        break;
      case "UNIT":
        rows=await tx.unit.findMany({
          where:{...filter,organizationId:org},select:{id:true}});
        break;
      case "CONTAINER":
        rows=await tx.container.findMany({
          where:{...filter,organizationId:org},select:{id:true}});
        break;
      case "REFERENCE_INTERVAL":
        rows=await tx.referenceInterval.findMany({
          where:{...filter,component:{test:{organizationId:org}}},
          select:{id:true}});
        break;
      case "PRICE_LIST":
        rows=await tx.priceList.findMany({
          where:{...filter,organizationId:org},select:{id:true}});
        break;
      case "PRICE_LIST_ITEM":
        rows=await tx.priceListItem.findMany({
          where:{...filter,priceList:{organizationId:org},
            test:{organizationId:org}},select:{id:true}});
        break;
      case "PRICE_LIST_PACKAGE_ITEM":
        rows=await tx.priceListPackageItem.findMany({
          where:{...filter,priceList:{organizationId:org},
            package:{organizationId:org}},select:{id:true}});
        break;
      case "CONTRACT":
        rows=await tx.contract.findMany({
          where:{...filter,organizationId:org,
            client:{organizationId:org}},select:{id:true}});
        break;
      case "REFERRER":
        rows=await tx.referrer.findMany({
          where:{...filter,organizationId:org},select:{id:true}});
        break;
      case "SOURCE":
        rows=await tx.orderSource.findMany({
          where:{...filter,organizationId:org},select:{id:true}});
        break;
      case "CLIENT":
        rows=await tx.client.findMany({
          where:{...filter,organizationId:org},select:{id:true}});
        break;
      case "ORGANISM":
        rows=await tx.organism.findMany({
          where:{...filter,organizationId:org},select:{id:true}});
        break;
      case "ANTIBIOTIC":
        rows=await tx.antibiotic.findMany({
          where:{...filter,organizationId:org},select:{id:true}});
        break;
      case "COMMENT_TEMPLATE":
        rows=await tx.resultCommentTemplate.findMany({
          where:{...filter,organizationId:org},select:{id:true}});
        break;
    }
    if(rows.length!==items.size ||
       new Set(rows.map(row=>row.id.toLowerCase())).size!==items.size||
       rows.some(row=>!items.has(row.id.toLowerCase())))
      return false;
  }
  return true;
}
