import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { currentReportRecipientAuthorized } from "../src/lib/report-outbound-authorization.ts";

const org = "ORG",patient = "PAT",client = "CLIENT",accountId = "ACCOUNT";
type Fixture = {status?:string; email?:string; phone?:string; verified?:boolean; grant?:boolean; owner?:string};
function fixture(input: Fixture = {}) {
  const calls:string[]=[];
  const acct = {
    id:accountId,status:input.status??"ACTIVE",email:input.email??"patient@example.com",
    phone:input.phone??"+971500001111",preferredLocale:"ar",
  };
  const getLocked = () => ({
    ...acct,type:"PATIENT",patientId:input.owner??patient,
    referrerId:null,clientId:null,
  });
  const contacts=()=>[{
    channel:"EMAIL" as const,destinationSnapshot:"patient@example.com",
    revokedAt:input.verified===false?new Date("2026-10-19T10:00:00Z"):null,
  }];
  const db = {
    portalAccount: {findFirst: async()=>{calls.push("read-account");return acct}},
    portalContactVerification:{findMany:async()=>{calls.push("read-contacts");return contacts().filter(x=>x.revokedAt===null)}},
    corporatePortalPatientAccess:{findFirst:async()=>{calls.push("read-grant");return input.grant===false?null:{id:"grant"}}},
    $queryRaw:async(parts:TemplateStringsArray)=> {
      const query=parts.join("?");
      if(query.includes("FROM portal_accounts")){calls.push("lock-account");return [getLocked()]}
      if(query.includes("FROM portal_contact_verifications")){calls.push("lock-contacts");return contacts()}
      if(query.includes("FROM corporate_portal_patient_access")){calls.push("lock-grant");return input.grant===false?[]:[{id:"grant"}]}
      throw Error("Unexpected query: "+query);
    },
  };
  return {db:db as never,calls};
}
const request={organizationId:org,recipientType:"PATIENT" as const,recipientId:patient,
  patientId:patient,channel:"EMAIL" as const,destination:"patient@example.com",
  expectedPortalAccountId:accountId};

test("Queue-time authorization holds portal account and verification locks before approval",async()=>{
  const {db,calls}=fixture();
  assert.equal(await currentReportRecipientAuthorized(db,request,true),true);
  assert.deepEqual(calls,["read-account","lock-account","lock-contacts"]);
});
test("Disabled portal account or revoked contact never authorizes queue or provider dispatch",async()=>{
  for(const changes of [{status:"LOCKED"},{status:"DISABLED"},{verified:false}]) {
    for(const locked of [true,false]) {
      const {db}=fixture(changes);
      assert.equal(await currentReportRecipientAuthorized(db,request,locked),false,JSON.stringify({changes,locked}));
    }
  }
});
test("Recipient reassignment and changed destination cannot reuse old verification",async()=>{
  assert.equal(await currentReportRecipientAuthorized(fixture({owner:"OTHER"}).db,request,true),false);
  for(const locked of [true,false]) {
    assert.equal(await currentReportRecipientAuthorized(fixture({email:"changed@example.com"}).db,request,locked),false);
    assert.equal(await currentReportRecipientAuthorized(fixture().db,{...request,destination:"other@example.com"},locked),false);
  }
});
test("Corporate report access is checked both when queued and immediately before sending",async()=>{
  const opts={...request,recipientType:"CLIENT" as const,recipientId:client};
  const active=fixture();
  assert.equal(await currentReportRecipientAuthorized(active.db,opts,true),false,"patient portal cannot represent client");
  // Fixture with corporate account and correct reference.
  function corporate(granted:boolean) {
    const calls:string[]=[];
    const acct={id:accountId,status:"ACTIVE",email:"patient@example.com",
      phone:null,preferredLocale:"en"};
    const contacts=[{channel:"EMAIL" as const,destinationSnapshot:"patient@example.com",revokedAt:null}];
    const db={
      portalAccount:{findFirst:async()=>acct},
      portalContactVerification:{findMany:async()=>contacts},
      corporatePortalPatientAccess:{findFirst:async()=>granted?{id:"grant"}:null},
      $queryRaw:async(strings:TemplateStringsArray)=>{
        const sql=strings.join("?");
        if(sql.includes("FROM portal_accounts")){calls.push("account");return [{...acct,type:"CORPORATE",clientId:client,patientId:null,referrerId:null}]}
        if(sql.includes("FROM portal_contact_verifications")){calls.push("verified");return contacts}
        if(sql.includes("FROM corporate_portal_patient_access")){calls.push("grant");return granted?[{id:"grant"}]:[]}
        throw Error(sql);
      },
    };
    return {db:db as never,calls};
  }
  assert.equal(await currentReportRecipientAuthorized(corporate(true).db,opts,true),true);
  assert.equal(await currentReportRecipientAuthorized(corporate(true).db,opts,false),true);
  assert.equal(await currentReportRecipientAuthorized(corporate(false).db,opts,true),false);
  assert.equal(await currentReportRecipientAuthorized(corporate(false).db,opts,false),false);
});
test("Clinical outbound API rechecks current destination under row locks before enqueue/audit",()=>{
  const src=readFileSync("src/app/api/reports/[versionId]/outbound/route.ts","utf8");
  const tx=src.indexOf("const queued = await prisma.$transaction");
  const parent=src.indexOf("FROM diagnostic_reports",tx);
  const check=src.indexOf("await currentReportRecipientAuthorized(tx",parent);
  const event=src.indexOf("tx.reportDeliveryEvent.create",check);
  const enqueue=src.indexOf("enqueueNotification(tx",event);
  assert.ok(tx>=0&&parent>tx&&check>parent&&event>check&&enqueue>event);
  assert.ok(src.includes('error: "report_recipient_authorization_changed"'));
});
test("Provider dispatcher denies revoked recipient before fetch and settles SKIPPED",()=>{
  const src=readFileSync("src/lib/notifications.ts","utf8");
  const dispatcher=src.indexOf("async function dispatchPendingNotifications");
  const version=src.indexOf("const version = await db.diagnosticReportVersion.findFirst",dispatcher);
  const auth=src.indexOf("await currentReportRecipientAuthorized(db",version);
  const skip=src.indexOf('lastError: "report_recipient_authorization_revoked_or_changed"',auth);
  const send=src.indexOf("await fetch(safeOutboundUrl(config.url)",skip);
  assert.ok(dispatcher>=0&&version>dispatcher&&auth>version&&skip>auth&&send>skip);
  assert.ok(src.slice(auth,send).includes("NotificationDeliveryStatus.SKIPPED"));
  assert.ok(src.includes("version!.report.order.patientId"));
});
