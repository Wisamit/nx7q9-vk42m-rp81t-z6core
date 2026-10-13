import {NextResponse} from "next/server";
import {Prisma} from "../../../../../../generated/prisma/client";
import {canAccessBranch,requirePermission,requestContext} from "@/lib/auth";
import {prisma} from "@/lib/db";
import {
  parseStaffReportHandover,reportSnapshotPatientNumber,reportHandoverFingerprint,
} from "@/lib/report-handover";

class HandoverStateChanged extends Error {}

export async function POST(request:Request,{params}:{params:Promise<{versionId:string}>}){
  const session=await requirePermission("reports.deliver");
  const ctx=await requestContext();
  const {versionId}=await params;
  const parsed=parseStaffReportHandover(await request.json().catch(()=>null));
  if(!parsed.ok)return NextResponse.json({error:parsed.error},{status:400});
  const input=parsed.value;
  const organizationId=session.user.organizationId;

  const version=await prisma.diagnosticReportVersion.findFirst({
    where:{id:versionId,report:{organizationId}},
    include:{report:{include:{order:{select:{
      id:true,organizationId:true,orderingBranchId:true,
    }}}}},
  });
  if(!version || version.report.order.organizationId!==organizationId)
    return NextResponse.json({error:"report_version_not_found"},{status:404});
  const orderingBranchId=version.report.order.orderingBranchId;
  if(!canAccessBranch(session,orderingBranchId) ||
      session.activeBranchId!==orderingBranchId)
    return NextResponse.json({error:"handover_requires_active_ordering_branch"},{status:403});
  if(version.version!==version.report.currentVersion ||
      (version.status!=="FINAL" && version.status!=="AMENDED"))
    return NextResponse.json({error:"report_not_current_and_final"},{status:409});

  const patientNumber=reportSnapshotPatientNumber(version.contentSnapshot);
  if(!patientNumber)
    return NextResponse.json({error:"missing_immutable_patient_identity"},{status:409});
  if(input.patientNumber!==patientNumber)
    return NextResponse.json({error:"patient_identifiers_do_not_match_report"},{status:409});

  const fingerprint=reportHandoverFingerprint(versionId,input);
  const sameEvent=(event:{
    reportVersionId:string;performedByUserId:string|null;details:unknown;
  })=>{
    if(event.reportVersionId!==version.id||event.performedByUserId!==session.user.id)
      return false;
    if(!event.details||typeof event.details!=="object"||Array.isArray(event.details))
      return false;
    const metadata=event.details as Record<string,unknown>;
    return metadata.evidenceType==="STAFF_ATTESTED_IN_PERSON_HANDOVER_V1" &&
      metadata.requestFingerprint===fingerprint;
  };

  try{
    const result=await prisma.$transaction(async tx=>{
      // Serialize issuance/retraction against a handover of the CURRENT report.
      const locked=await tx.$queryRaw<Array<{currentVersion:number}>>`
        SELECT current_version AS currentVersion FROM diagnostic_reports
        WHERE id=${version.reportId} AND organization_id=${organizationId}
        FOR UPDATE
      `;
      if(locked.length!==1 || locked[0].currentVersion!==version.version)
        throw new HandoverStateChanged();

      const stillCurrent=await tx.diagnosticReportVersion.findUnique({
        where:{id:version.id},select:{status:true,reportId:true,contentSnapshot:true},
      });
      if(!stillCurrent || stillCurrent.reportId!==version.reportId ||
          !["FINAL","AMENDED"].includes(stillCurrent.status) ||
          reportSnapshotPatientNumber(stillCurrent.contentSnapshot)!==input.patientNumber)
        throw new HandoverStateChanged();

      const existing=await tx.reportDeliveryEvent.findUnique({
        where:{handoverRequestId:input.handoverRequestId},
      });
      if(existing){
        if(!sameEvent(existing))throw new HandoverStateChanged();
        return {id:existing.id,replayed:true};
      }
      const delivery=await tx.reportDeliveryEvent.create({data:{
        reportVersionId:version.id,
        channel:"OTHER",
        status:"RECORDED",
        recipient:"PATIENT",
        performedByUserId:session.user.id,
        handoverRequestId:input.handoverRequestId,
        details:{
          evidenceType:"STAFF_ATTESTED_IN_PERSON_HANDOVER_V1",
          handoverLocationBranchId:orderingBranchId,
          recipientType:"PATIENT",
          staffAttestedInPersonHandover:true,
          identityCheck:input.verificationMethod,
          patientNumberMatchedImmutableReport:true,
          requestFingerprint:fingerprint,
          independentPatientAcknowledgement:false,
          physicalDeliveryIndependentlyVerified:false,
        },
      }});
      await tx.auditEvent.create({data:{
        organizationId,branchId:orderingBranchId,
        actorUserId:session.user.id,
        action:"REPORT_IN_PERSON_HANDOVER_STAFF_ATTESTED",
        entityType:"DiagnosticReportVersion",entityId:version.id,
        newValues:{
          reportId:version.reportId,reportVersion:version.version,
          deliveryEventId:delivery.id,
          handoverLocationBranchId:orderingBranchId,
          recipientType:"PATIENT",
          identityCheck:input.verificationMethod,
          staffAttested:true,independentPatientAcknowledgement:false,
        },
        ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
      }});
      return {id:delivery.id,replayed:false};
    },{timeout:30000});

    return NextResponse.json({
      status:"STAFF_ATTESTED",handoverEventId:result.id,
      replayed:result.replayed,independentlyVerified:false,
    },{status:result.replayed?200:201});
  }catch(err){
    if(err instanceof HandoverStateChanged)
      return NextResponse.json({error:"handover_conflict_or_version_changed"},{status:409});
    if(err instanceof Prisma.PrismaClientKnownRequestError&&err.code==="P2002"){
      // Another concurrent retry won the unique key. A different payload
      // must never become a successful replay.
      const event=await prisma.reportDeliveryEvent.findUnique({
        where:{handoverRequestId:input.handoverRequestId},
      });
      if(event && sameEvent(event)){
        return NextResponse.json({
          status:"STAFF_ATTESTED",handoverEventId:event.id,
          replayed:true,independentlyVerified:false,
        },{status:200});
      }
      return NextResponse.json({error:"handover_request_id_conflict"},{status:409});
    }
    throw err;
  }
}
