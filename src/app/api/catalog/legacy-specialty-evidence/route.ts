import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  buildSpecialtyEvidenceReview, LEGACY_SPECIALTY_EVIDENCE_MAX_BYTES,
  LegacySpecialtyEvidenceError, parseSpecialtyEvidence,
} from "@/lib/legacy-specialty-evidence";

function fail(error:string,status:number){return NextResponse.json({error},{status,headers:{"Cache-Control":"no-store"}});}

/**
 * An ephemeral, read-only review endpoint. It neither stages legacy range values
 * nor creates/changes reference intervals, test components, or clinical history.
 * Upload bytes and observations are never persisted.
 */
export async function POST(request:Request){
  const session=await requirePermission("catalog.manage");
  if(!session.activeBranchId||!canAccessBranch(session,session.activeBranchId))
    return fail("active_branch_scope_required",403);
  const type=request.headers.get("content-type")||"";
  if(!/^application\/json(?:\s*;|$)/i.test(type))return fail("json_required",415);
  const length=Number(request.headers.get("content-length")||"0");
  if(!Number.isFinite(length)||length<0||length>LEGACY_SPECIALTY_EVIDENCE_MAX_BYTES)
    return fail("specialty_evidence_too_large",413);
  const rawText=await request.text();
  if(Buffer.byteLength(rawText,"utf8")>LEGACY_SPECIALTY_EVIDENCE_MAX_BYTES)
    return fail("specialty_evidence_too_large",413);
  let body:unknown;
  try{body=JSON.parse(rawText);}catch{return fail("invalid_json",400);}
  if(!body||typeof body!=="object"||Array.isArray(body))return fail("invalid_request",400);
  const data=body as Record<string,unknown>;
  const testId=typeof data.testId==="string"?data.testId:"";
  if(!/^[a-f0-9-]{36}$/i.test(testId))return fail("invalid_test_id",400);
  const test=await prisma.labTest.findFirst({
    where:{id:testId,organizationId:session.user.organizationId,status:"ACTIVE"},
    select:{id:true,code:true,components:{
      where:{status:"ACTIVE"},
      select:{id:true,code:true,nameEn:true,nameAr:true},
      orderBy:[{displayOrder:"asc"},{code:"asc"}],
    }},
  });
  if(!test)return fail("active_test_not_found",404);
  try{
    const evidence=parseSpecialtyEvidence(data.evidence);
    const review=buildSpecialtyEvidenceReview(evidence,test.components);
    return NextResponse.json({status:"review_only",
      testCode:test.code,...review,
      warnings:[
        "This upload is structural, deidentified evidence; the source SHA256 was supplied by the local exporter and cannot be independently verified by this endpoint.",
        "Matching an exact component code is not clinical approval or an accepted reference interval.",
        "All candidate range bounds, units, sex, age constraints and methods require controlled independent laboratory review before clinical use.",
        "No catalog record, reference interval, result, or historical report was created or changed.",
      ],
    },{headers:{"Cache-Control":"no-store"}});
  }catch(e){
    return fail(e instanceof LegacySpecialtyEvidenceError?e.code:"specialty_evidence_review_failed",400);
  }
}
