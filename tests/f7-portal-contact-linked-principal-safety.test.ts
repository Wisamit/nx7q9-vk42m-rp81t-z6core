import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasLivePortalContactPrincipal } from "../src/lib/portal-contact-principal.ts";

const patient=()=>({
  type:"PATIENT",organizationId:"org-a",patientId:"patient-a",clientId:null,referrerId:null,
  patient:{id:"patient-a",organizationId:"org-a",status:"ACTIVE"},client:null,referrer:null,
});
const corporate=()=>({
  type:"CORPORATE",organizationId:"org-a",patientId:null,clientId:"client-a",referrerId:null,
  patient:null,client:{id:"client-a",organizationId:"org-a",status:"ACTIVE"},referrer:null,
});
const doctor=()=>({
  type:"DOCTOR",organizationId:"org-a",patientId:null,clientId:null,referrerId:"physician-a",
  patient:null,client:null,referrer:{id:"physician-a",organizationId:"org-a",status:"ACTIVE",type:"PHYSICIAN"},
});

test("F7 OTP: only active matching patient, client or physician in same organization may verify contact",()=>{
  assert.equal(hasLivePortalContactPrincipal(patient()),true);
  assert.equal(hasLivePortalContactPrincipal(corporate()),true);
  assert.equal(hasLivePortalContactPrincipal(doctor()),true);
  for(const invalid of [
    {...patient(),patientId:null,patient:null},
    {...patient(),patient:{...patient().patient,status:"MERGED"}},
    {...patient(),patient:{...patient().patient,organizationId:"org-b"}},
    {...patient(),patient:{...patient().patient,id:"other"}},
    {...corporate(),client:null},
    {...corporate(),client:{...corporate().client,status:"INACTIVE"}},
    {...corporate(),client:{...corporate().client,organizationId:"org-b"}},
    {...corporate(),client:{...corporate().client,id:"other"}},
    {...doctor(),referrer:null},
    {...doctor(),referrer:{...doctor().referrer,status:"INACTIVE"}},
    {...doctor(),referrer:{...doctor().referrer,type:"OTHER"}},
    {...doctor(),referrer:{...doctor().referrer,organizationId:"org-b"}},
    {...doctor(),referrer:{...doctor().referrer,id:"other"}},
    {...doctor(),type:"UNKNOWN"},
  ])assert.equal(hasLivePortalContactPrincipal(invalid),false,JSON.stringify(invalid));
});

test("F7 OTP: both request and verification check live subject before payload or challenge access",()=>{
  const routes=[
    "src/app/api/portal/auth/contact-verification/request/route.ts",
    "src/app/api/portal/auth/contact-verification/verify/route.ts",
  ];
  for(const path of routes){
    const code=readFileSync(path,"utf8");
    const guard=code.indexOf("if (!hasLivePortalContactPrincipal(account))");
    const body=code.indexOf("const body = await request.json()");
    const mutation=code.indexOf("prisma.portalOtpChallenge");
    assert.ok(guard>0 && body>guard,path+" guard must precede processing untrusted input");
    assert.ok(mutation>guard,path+" guard must precede checking or writing private OTP");
    assert.match(code,/error: "portal_unauthorized"/);
    assert.match(code,/account.mustChangePassword/);
  }
  const session=readFileSync("src/lib/portal-auth.ts","utf8");
  assert.match(session,/patient: true/);
  assert.match(session,/referrer: true/);
  assert.match(session,/client: true/);
  assert.match(session,/portalAccount: \{ status: "ACTIVE", organization: \{ status: "ACTIVE" \} \}/);
});
