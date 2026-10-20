import { catalogExportTypes, type CatalogExportType } from "./catalog-configuration-export.ts";
import { f2GovernedReadinessPreview, type F2GovernedReadiness } from "./catalog-f2-governed-readiness.ts";
import { BUNDLE_REVIEW_MAX_ROWS } from "./catalog-bundle-review.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const obj=(v:unknown):Record<string,unknown>|null=>
  v!==null&&typeof v==="object"&&!Array.isArray(v) ? v as Record<string,unknown> : null;

export type F2ReconciliationRow={
  rowNumber:number;entityType:string;
  sourceData:unknown;normalizedData:unknown;scopedLiveData:unknown;
};
export type F2ReconciliationClass={
  entityType:CatalogExportType;rows:number;changedRows:number;
  changedFields:readonly string[];mappingRequiredRows:number;
};
export type F2BatchReconciliation={
  state:"TEN_CLASS_EVIDENCE_ONLY";
  status:"BLOCKED_EXTERNAL";
  totalRows:number;unchangedRows:number;changedRows:number;
  mappingRequiredRows:number;
  classes:readonly F2ReconciliationClass[];
  sourceInstallationProven:false;approved:false;
  clinicalSignoffVerified:false;financeSignoffVerified:false;
  approvedRoundTripVerified:false;atomicApplyEnabled:false;
  correctiveReversalEnabled:false;liveWrites:false;reviewOnly:true;
};

/**
 * Aggregate a bounded, *already scoped and authenticated* full DRAFT stage.
 * Caller must supply real source/live JSON from the same locked transaction,
 * and only after separate, current ten-class grants + v2 stage verification.
 * This reducer neither signs evidence nor queries, mutates or applies masters.
 *
 * Never infer foreign-to-local authority from equality of UUID/code; the
 * observed identity is a diagnostic even when every field is unchanged.
 */
export function f2ReadOnlyBatchReconciliation(input:{
  rows:readonly F2ReconciliationRow[];
  wholeStageHmacVerified:true;currentTenClassScopeVerified:true;
  currentLiveSnapshotVerified:true;
}):F2BatchReconciliation|null {
  if(input.wholeStageHmacVerified!==true ||
     input.currentTenClassScopeVerified!==true ||
     input.currentLiveSnapshotVerified!==true ||
     input.rows.length<10 || input.rows.length>BUNDLE_REVIEW_MAX_ROWS)return null;
  const classes=new Map<CatalogExportType,{
    rows:number;changedRows:number;fields:Set<string>;mappingRequiredRows:number;
  }>();
  const identities=new Set<string>();
  let unchanged=0,changed=0,needsMapping=0;
  for(const [i,row] of input.rows.entries()){
    if(!Number.isSafeInteger(row.rowNumber)||row.rowNumber!==i+1 ||
       !catalogExportTypes.has(row.entityType as CatalogExportType))return null;
    const source=obj(row.sourceData),normalized=obj(row.normalizedData),live=obj(row.scopedLiveData);
    if(!source||!normalized||!live ||
       typeof normalized.id!=="string"||!UUID.test(normalized.id) ||
       source.id!==normalized.id||live.id!==normalized.id)return null;
    const type=row.entityType as CatalogExportType;
    const identity=type+":"+normalized.id.toLowerCase();
    if(identities.has(identity))return null;
    identities.add(identity);
    const analysis:F2GovernedReadiness|null=f2GovernedReadinessPreview({
      entityType:type,sourceData:source,scopedLiveData:live,
      signedStageVerified:true,liveFieldObservationRevalidated:true,
    });
    if(!analysis)return null;
    const entry=classes.get(type)||{rows:0,changedRows:0,
      fields:new Set<string>(),mappingRequiredRows:0};
    entry.rows++;
    if(analysis.phaseOne.changedFieldCount){
      entry.changedRows++;changed++;
      for(const field of analysis.phaseOne.changedFields)entry.fields.add(field);
    }else unchanged++;
    if(analysis.phaseOne.identityObservation==="MAPPING_REQUIRED"){
      entry.mappingRequiredRows++;needsMapping++;
    }
    classes.set(type,entry);
  }
  if(classes.size!==catalogExportTypes.size)return null;
  return {
    state:"TEN_CLASS_EVIDENCE_ONLY",status:"BLOCKED_EXTERNAL",
    totalRows:input.rows.length,unchangedRows:unchanged,changedRows:changed,
    mappingRequiredRows:needsMapping,
    classes:[...catalogExportTypes].map(entityType=>{
      const entry=classes.get(entityType)!;
      return {entityType,rows:entry.rows,changedRows:entry.changedRows,
        changedFields:[...entry.fields].sort(),
        mappingRequiredRows:entry.mappingRequiredRows};
    }),
    sourceInstallationProven:false,approved:false,
    clinicalSignoffVerified:false,financeSignoffVerified:false,
    approvedRoundTripVerified:false,atomicApplyEnabled:false,
    correctiveReversalEnabled:false,liveWrites:false,reviewOnly:true,
  };
}
