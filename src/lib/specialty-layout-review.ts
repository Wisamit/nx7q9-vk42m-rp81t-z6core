import { createHash } from "node:crypto";

export type SpecialtyLayoutMode = "STANDARD" | "SECTIONED" | "COMPACT_GRID";
export type SpecialtyFieldWidth = "AUTO" | "NARROW" | "STANDARD" | "WIDE" | "FULL";
export type SpecialtySection = {
  code:string; nameEn:string; nameAr:string|null; displayOrder:number;
  columnCount:number; hintEn:string|null; hintAr:string|null;
};
export type SpecialtyComponent = {
  code:string; sectionCode:string|null; entryWidth:SpecialtyFieldWidth;
  entryHintEn:string|null; entryHintAr:string|null;
};
export type SpecialtyLayoutPlan = {
  layout:SpecialtyLayoutMode; sections:SpecialtySection[]; components:SpecialtyComponent[];
};
export type SpecialtySnapshot = {
  layout:string; testUpdatedAt:string;
  sections:Array<SpecialtySection & {id:string;status:string;updatedAt:string;reportVisible:boolean;reportDisplayOrder:number|null}>;
  components:Array<SpecialtyComponent & {id:string;status:string;updatedAt:string;resultSectionId:string|null;
    reportNameEn:string|null;reportNameAr:string|null;reportVisible:boolean;reportDisplayOrder:number|null}>;
};
export class SpecialtyPlanError extends Error {
  readonly code:string;
  constructor(code:string){super(code);this.code=code;}
}
const layouts = new Set(["STANDARD","SECTIONED","COMPACT_GRID"]);
const widths = new Set(["AUTO","NARROW","STANDARD","WIDE","FULL"]);
const clean=(v:unknown,max:number,required=false):string|null=>{
  if(v===null||v===undefined) return required?null:"";
  if(typeof v!=="string") return null;
  const s=v.trim();
  if(s.length>max||(required&&!s)||/[\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
};
const code=(v:unknown):string|null=>{
  if(typeof v!=="string")return null;
  const s=v.trim().toUpperCase();
  return /^[A-Z0-9._-]{1,80}$/.test(s)?s:null;
};
const nonnegative=(v:unknown,max=10000)=>typeof v==="number"&&Number.isInteger(v)&&v>=0&&v<=max;
const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);

export function parseSpecialtyLayoutPlan(raw:unknown, snapshot:SpecialtySnapshot):SpecialtyLayoutPlan {
  if(!isRecord(raw)||!layouts.has(String(raw.layout))||!Array.isArray(raw.sections)||!Array.isArray(raw.components)
    ||raw.sections.length>80||raw.components.length>500||snapshot.components.filter(c=>c.status==="ACTIVE").length===0)
    throw new SpecialtyPlanError("invalid_specialty_layout_plan");
  if(raw.sections.length===0 && raw.layout!=="STANDARD") throw new SpecialtyPlanError("sections_required_for_specialized_layout");
  const seenSections=new Set<string>(),seenComponents=new Set<string>();
  const sections:SpecialtySection[]=raw.sections.map((candidate:unknown)=>{
    if(!isRecord(candidate)) throw new SpecialtyPlanError("invalid_section");
    const identifier=code(candidate.code),nameEn=clean(candidate.nameEn,200,true);
    const nameAr=clean(candidate.nameAr,200),hintEn=clean(candidate.hintEn,500),hintAr=clean(candidate.hintAr,500);
    if(!identifier||!nameEn||nameAr===null||hintEn===null||hintAr===null
      ||!nonnegative(candidate.displayOrder)||!nonnegative(candidate.columnCount,4)
      ||Number(candidate.columnCount)<1||seenSections.has(identifier))
      throw new SpecialtyPlanError("invalid_or_duplicate_section");
    seenSections.add(identifier);
    return {code:identifier,nameEn,nameAr:nameAr||null,displayOrder:Number(candidate.displayOrder),
      columnCount:Number(candidate.columnCount),hintEn:hintEn||null,hintAr:hintAr||null};
  });
  const existingCodes=new Map(snapshot.sections.map(s=>[s.code,s]));
  for(const section of sections){
    const existing=existingCodes.get(section.code);
    if(existing&&existing.status!=="ACTIVE") throw new SpecialtyPlanError("inactive_section_code_collision");
  }
  const activeComponents=snapshot.components.filter(c=>c.status==="ACTIVE");
  if(raw.components.length!==activeComponents.length) throw new SpecialtyPlanError("every_active_component_must_be_present_once");
  const actualCodes=new Set(activeComponents.map(c=>c.code));
  const components:SpecialtyComponent[]=raw.components.map((candidate:unknown)=>{
    if(!isRecord(candidate)) throw new SpecialtyPlanError("invalid_component");
    const identifier=clean(candidate.code,80,true);
    const sectionCode=candidate.sectionCode===null?null:code(candidate.sectionCode);
    const width=candidate.entryWidth;
    const hintEn=clean(candidate.entryHintEn,500),hintAr=clean(candidate.entryHintAr,500);
    if(!identifier||!/^[A-Za-z0-9._-]{1,80}$/.test(identifier)||!actualCodes.has(identifier)||seenComponents.has(identifier)
      ||(candidate.sectionCode!==null&&(!sectionCode||!seenSections.has(sectionCode)))
      ||!widths.has(String(width))||hintEn===null||hintAr===null)
      throw new SpecialtyPlanError("invalid_or_duplicate_component_assignment");
    seenComponents.add(identifier);
    return {code:identifier,sectionCode,entryWidth:width as SpecialtyFieldWidth,
      entryHintEn:hintEn||null,entryHintAr:hintAr||null};
  });
  return {layout:raw.layout as SpecialtyLayoutMode,sections,components};
}
export function specialtySnapshotDigest(snapshot:SpecialtySnapshot){
  return createHash("sha256").update(JSON.stringify({
    layout:snapshot.layout,testUpdatedAt:snapshot.testUpdatedAt,
    sections:[...snapshot.sections].sort((a,b)=>a.code.localeCompare(b.code)),
    components:[...snapshot.components].sort((a,b)=>a.code.localeCompare(b.code)),
  })).digest("hex");
}
export function specialtyPlanPreview(snapshot:SpecialtySnapshot,plan:SpecialtyLayoutPlan){
  const currentSections=new Map(snapshot.sections.map(s=>[s.code,s]));
  const sectionsCreated=plan.sections.filter(s=>!currentSections.has(s.code)).map(s=>s.code);
  const sectionsUpdated=plan.sections.filter(s=>{
    const old=currentSections.get(s.code);
    return old&&(["nameEn","nameAr","displayOrder","columnCount","hintEn","hintAr"] as const)
      .some(key=>old[key]!==s[key]);
  }).map(s=>s.code);
  const idToSection=new Map(snapshot.sections.map(s=>[s.id,s.code]));
  const currentComponents=new Map(snapshot.components.map(c=>[c.code,c]));
  const componentsUpdated=plan.components.filter(c=>{
    const old=currentComponents.get(c.code);
    return !old||old.entryWidth!==c.entryWidth||old.entryHintEn!==c.entryHintEn
      ||old.entryHintAr!==c.entryHintAr||(old.resultSectionId?idToSection.get(old.resultSectionId)||null:null)!==c.sectionCode;
  }).map(c=>c.code);
  const unchangedActiveSections=snapshot.sections.filter(s=>s.status==="ACTIVE"&&!plan.sections.some(n=>n.code===s.code))
    .map(s=>s.code);
  return {
    layoutChanged:snapshot.layout!==plan.layout,
    sectionsCreated,sectionsUpdated,componentsUpdated,unchangedActiveSections,
    affected:sectionsCreated.length+sectionsUpdated.length+componentsUpdated.length+(snapshot.layout!==plan.layout?1:0),
    warnings:[
      "Existing report names, reference intervals, clinical rules and released results are untouched.",
      ...(unchangedActiveSections.length?["Existing sections absent from this plan remain active and unchanged."]:[]),
      ...(sectionsCreated.length?["New result sections can affect grouping of future report snapshots. Previously released reports are unchanged."]:[]),
    ],
  };
}
export function specialtyReviewToken(snapshotDigest:string,plan:SpecialtyLayoutPlan) {
  return createHash("sha256").update(JSON.stringify({snapshotDigest,plan})).digest("hex");
}
