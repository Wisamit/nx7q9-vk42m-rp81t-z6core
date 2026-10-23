import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {hasLiveDoctorPortalReferrer} from "../src/lib/doctor-portal-access.ts";

const doctor=()=>({
  type:"DOCTOR",organizationId:"org-a",referrerId:"ref-a",
  referrer:{id:"ref-a",organizationId:"org-a",status:"ACTIVE",type:"PHYSICIAN"},
});

test("F7 doctor requisition: current active matching same-tenant physician link is mandatory",()=>{
  assert.equal(hasLiveDoctorPortalReferrer(doctor()),true);
  assert.equal(hasLiveDoctorPortalReferrer({...doctor(),referrerId:null}),false);
  assert.equal(hasLiveDoctorPortalReferrer({...doctor(),referrer:null}),false);
  assert.equal(hasLiveDoctorPortalReferrer({...doctor(),referrer:{...doctor().referrer,id:"other"}}),false);
  assert.equal(hasLiveDoctorPortalReferrer({...doctor(),referrer:{...doctor().referrer,organizationId:"org-b"}}),false);
  assert.equal(hasLiveDoctorPortalReferrer({...doctor(),referrer:{...doctor().referrer,status:"INACTIVE"}}),false);
  assert.equal(hasLiveDoctorPortalReferrer({...doctor(),referrer:{...doctor().referrer,type:"OTHER"}}),false);
  for(const type of ["PATIENT","CORPORATE","UNKNOWN"]){
    assert.equal(hasLiveDoctorPortalReferrer({...doctor(),type}),false);
  }
});

test("F7 doctor requisition: all GET, POST and PATCH share the live referrer gate",()=>{
  const api=readFileSync("src/app/api/portal/doctor-requisitions/route.ts","utf8");
  const session=readFileSync("src/lib/portal-auth.ts","utf8");
  assert.match(api,/!hasLiveDoctorPortalReferrer\(session\.portalAccount\)/);
  assert.match(api,/new DoctorRequisitionError\("doctor_portal_unauthorized", 403\)/);
  assert.equal((api.match(/await requireDoctorPortal\(\)/g)||[]).length,3);
  assert.ok(api.indexOf("!hasLiveDoctorPortalReferrer") < api.indexOf("export async function GET"));
  assert.match(api,/organizationId: account\.organizationId, portalAccountId: account\.id/);
  assert.match(api,/canRequestOrders:true, status:"ACTIVE"/);
  assert.match(api,/AND type='PHYSICIAN'/);
  assert.match(session,/referrer: true/);
  assert.match(session,/portalAccount: \{ status: "ACTIVE", organization: \{ status: "ACTIVE" \} \}/);
});

test("F7 doctor portal: revoked physician blocks clinical dashboard and report detail before database reads",()=>{
  const page=readFileSync("src/app/portal/page.tsx","utf8");
  const detail=readFileSync("src/app/portal/reports/[versionId]/page.tsx","utf8");
  for(const source of [page,detail]) {
    const guard=source.indexOf('account.type === "DOCTOR" && !hasLiveDoctorPortalReferrer(account)');
    assert.ok(guard>0,"deny inactive referrer in server-rendered page");
    assert.ok(source.includes("notFound()"),"deny without disclosing clinical values");
    const query=source.indexOf("prisma.diagnosticReportVersion.find");
    assert.ok(query>guard,"guard must precede clinical report fetch");
    assert.match(source,/doctorAccessWhere\(\{ organizationId: account\.organizationId/);
  }
  assert.ok(page.indexOf("!hasLiveDoctorPortalReferrer(account)") <
    page.indexOf("prisma.labOrder.findMany"),"list must be blocked before querying clinical orders");
  assert.ok(detail.indexOf("!hasLiveDoctorPortalReferrer(account)") <
    detail.indexOf("const version = await prisma.diagnosticReportVersion.findUnique"));
});
