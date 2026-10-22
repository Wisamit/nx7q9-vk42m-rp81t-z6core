import type {Prisma} from "../../generated/prisma/client";
import {legacyLineageMappingAllowed} from "./catalog-legacy-row-lineage.ts";
import type {F3LineageDecision} from "./f3-legacy-source-reconciliation.ts";

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CHUNK=250;
const mapped=new Set(["MAPPED","APPROVED_MAPPING"]);

/**
 * Recheck every already-mapped legacy row against CURRENT tenant-local SQL
 * identities (and all ACTIVE operator branch scopes) before reporting any
 * row as a reconciled target. Fingerprint equality does not prove a target
 * still exists, belongs to this organization, or remains authorized.
 *
 * Runs under the same organization FOR UPDATE / RepeatableRead transaction
 * as the F3 report. Batch by target class to avoid 20k per-row SQL calls.
 */
export async function f3MappedTargetsCurrentlyScoped(
  tx:Prisma.TransactionClient,
  input:{organizationId:string;activeBranchIds:readonly string[];
    lineage:readonly F3LineageDecision[]},
):Promise<boolean>{
  const {organizationId,activeBranchIds,lineage}=input;
  if(!UUID.test(organizationId)||activeBranchIds.length<1||
     activeBranchIds.length>2000||
     activeBranchIds.some(id=>!UUID.test(id))||
     new Set(activeBranchIds.map(id=>id.toLowerCase())).size!==activeBranchIds.length||
     lineage.length>20000)return false;
  const byType=new Map<string,Set<string>>();
  for(const row of lineage){
    if(!mapped.has(row.classification))continue;
    if(row.organizationId!==organizationId||
       !row.targetType||!row.targetId||!UUID.test(row.targetId)||
       !legacyLineageMappingAllowed(row.sourceTable,row.targetType))
      return false;
    const ids=byType.get(row.targetType)??new Set<string>();
    ids.add(row.targetId.toLowerCase());
    byType.set(row.targetType,ids);
  }
  const branchScopedTariff={organizationId,OR:[
    {scopeType:"ORGANIZATION" as const,branchId:null},
    {scopeType:"BRANCH" as const,branchId:{in:[...activeBranchIds]}},
  ]};
  async function existing(type:string,ids:string[]){
    const whereIds={id:{in:ids}};
    switch(type){
      case "TEST":return tx.labTest.findMany({where:{
        ...whereIds,organizationId,status:"ACTIVE"},select:{id:true}});
      case "COMPONENT":return tx.testComponent.findMany({where:{
        ...whereIds,status:"ACTIVE",
        test:{organizationId,status:"ACTIVE"}},select:{id:true}});
      case "PANEL":return tx.testPanel.findMany({where:{
        ...whereIds,organizationId,status:"ACTIVE",items:{some:{}}},
        select:{id:true}});
      case "PACKAGE":return tx.commercialPackage.findMany({where:{
        ...whereIds,organizationId,status:"ACTIVE",items:{some:{}}},
        select:{id:true}});
      case "UNIT":return tx.unit.findMany({where:{
        ...whereIds,organizationId,status:"ACTIVE"},select:{id:true}});
      case "CONTAINER":return tx.container.findMany({where:{
        ...whereIds,organizationId,status:"ACTIVE"},select:{id:true}});
      case "REFERENCE_INTERVAL":return tx.referenceInterval.findMany({
        where:{...whereIds,component:{test:{organizationId}}},
        select:{id:true}});
      case "PRICE_LIST_ITEM":return tx.priceListItem.findMany({
        where:{...whereIds,test:{organizationId},
          priceList:branchScopedTariff},select:{id:true}});
      case "PRICE_LIST_PACKAGE_ITEM":return tx.priceListPackageItem.findMany({
        where:{...whereIds,package:{organizationId},
          priceList:branchScopedTariff},select:{id:true}});
      case "PRICE_LIST":return tx.priceList.findMany({
        where:{...whereIds,organizationId,OR:[
          {scopeType:"ORGANIZATION",branchId:null},
          {scopeType:"BRANCH",branchId:{in:[...activeBranchIds]}},
          {scopeType:"CLIENT"},{scopeType:"CONTRACT"},
        ]},select:{id:true}});
      case "CONTRACT":return tx.contract.findMany({where:{
        ...whereIds,organizationId,client:{organizationId}},
        select:{id:true}});
      case "REFERRER":return tx.referrer.findMany({where:{
        ...whereIds,organizationId},select:{id:true}});
      case "CLIENT":return tx.client.findMany({where:{
        ...whereIds,organizationId},select:{id:true}});
      case "SOURCE":return tx.orderSource.findMany({where:{
        ...whereIds,organizationId},select:{id:true}});
      case "ORGANISM":return tx.organism.findMany({where:{
        ...whereIds,organizationId},select:{id:true}});
      case "ANTIBIOTIC":return tx.antibiotic.findMany({where:{
        ...whereIds,organizationId},select:{id:true}});
      case "COMMENT_TEMPLATE":return tx.resultCommentTemplate.findMany({where:{
        ...whereIds,organizationId},select:{id:true}});
      default:return null;
    }
  }
  for(const [type,all] of byType){
    const ids=[...all];
    for(let start=0;start<ids.length;start+=CHUNK){
      const group=ids.slice(start,start+CHUNK);
      const found=await existing(type,group);
      if(!found||found.length!==group.length)return false;
      const requested=new Set(group);
      const valid=new Set<string>();
      for(const item of found){
        if(typeof item.id!=="string"||!UUID.test(item.id)||
           !requested.has(item.id.toLowerCase())||
           valid.has(item.id.toLowerCase()))return false;
        valid.add(item.id.toLowerCase());
      }
      if(valid.size!==requested.size)return false;
    }
  }
  return true;
}
