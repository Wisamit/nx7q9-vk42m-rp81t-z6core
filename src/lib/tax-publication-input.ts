import { nextDateString } from "./client-accounting.ts";
import { validTaxRate } from "./tax-policy.ts";

type TaxTreatment = "STANDARD" | "ZERO_RATED" | "EXEMPT";
type TaxPriceMode = "INCLUSIVE" | "EXCLUSIVE";
export type ExactTaxPublicationInput = {
  branchId: string | null;
  serviceType: "TEST" | "PACKAGE";
  serviceId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  treatment: TaxTreatment;
  priceMode: TaxPriceMode;
  ratePercent: string;
  effectiveFrom: string;
  reason: string;
};

const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const object = (v:unknown):v is Record<string,unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const exactString = (v:unknown,max:number):string|null => {
  if(typeof v !== "string" || v.length > max || v.includes("\0"))
    return null;
  const value=v.trim();
  return value.length <= max ? value : null;
};

/**
 * Admission-only guard: never cut a clinical or financial policy field to fit
 * its database column. A long UUID, fiscal day, reason or name must be rejected
 * whole instead of silently producing a different effective policy.
 *
 * This validates SHAPE, not the jurisdiction's tax semantics. Those remain an
 * independent qualified owner/accountant decision.
 */
export function parseExactTaxPublicationInput(raw:unknown):
  {ok:true;value:ExactTaxPublicationInput} | {ok:false;error:"invalid_tax_fields"} {
  const fail = {ok:false,error:"invalid_tax_fields"} as const;
  if(!object(raw)) return fail;

  const branchIdRaw=raw.branchId;
  const branchId=branchIdRaw==null||branchIdRaw===""?null:exactString(branchIdRaw,36);
  if (branchIdRaw!=null && branchIdRaw!=="" && (!branchId || !uuid.test(branchId))) return fail;
  const serviceId=exactString(raw.serviceId,36);
  const code=exactString(raw.code,60)?.toUpperCase();
  const nameEn=exactString(raw.nameEn,200);
  const nameAr=raw.nameAr===null||raw.nameAr===undefined?"":exactString(raw.nameAr,200);
  const reason=exactString(raw.reason,1000);
  const effectiveFrom=exactString(raw.effectiveFrom,10);
  const serviceType=raw.serviceType;
  const treatment=raw.treatment;
  const priceMode=raw.priceMode;
  // A JSON number already passed through binary floating point. Never infer
  // an exact accountant-supplied DECIMAL(5,2) policy value from it.
  const ratePercent=typeof raw.ratePercent==="string"
    ? validTaxRate(raw.ratePercent) : null;
  if(!serviceId||!uuid.test(serviceId) ||
     !code||!/^[A-Z0-9_-]{2,60}$/.test(code) ||
     !nameEn||nameAr===null||!reason ||
     !effectiveFrom || !nextDateString(effectiveFrom) ||
     (serviceType!=="TEST" && serviceType!=="PACKAGE") ||
     !["STANDARD","ZERO_RATED","EXEMPT"].includes(String(treatment)) ||
     (priceMode!=="INCLUSIVE" && priceMode!=="EXCLUSIVE") ||
     ratePercent===null) return fail;

  return {ok:true,value:{
    branchId,serviceType,serviceId,code,nameEn,nameAr,
    treatment:treatment as TaxTreatment,priceMode,ratePercent,
    effectiveFrom,reason,
  }};
}
