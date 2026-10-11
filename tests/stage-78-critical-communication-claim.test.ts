import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { claimCriticalCommunication, type CriticalCommunicationClaim } from "../src/lib/critical-communication-claim.ts";

const old=new Date("2026-10-11T08:00:00.001Z");
const base=():CriticalCommunicationClaim=>({
  eventId:"EV1",resultId:"R1",organizationId:"ORG1",performingBranchId:"BR1",
  observedEscalationLevel:1,observedUpdatedAt:old,
  outcome:"NO_ANSWER",communicatedAt:new Date("2026-10-11T08:00:00.001Z"),
  communicatorId:"U1",nextEscalationDueAt:new Date("2026-10-11T09:00:00.000Z"),
});
async function probe(input:CriticalCommunicationClaim,count:number){
  let condition:Record<string,unknown>|null=null;
  let changed:Record<string,unknown>|null=null;
  const fake={criticalResultEvent:{updateMany:async(args:{
    where:Record<string,unknown>;data:Record<string,unknown>;
  })=>{condition=args.where;changed=args.data;return {count};}}};
  const accepted=await claimCriticalCommunication(fake as never,input);
  return {accepted,condition:condition!,changed:changed!};
}

test("Stage 78: stale/missing open event is never claimed and all outcomes require optimistic source version",async()=>{
  const failed=await probe(base(),0);
  assert.equal(failed.accepted,false);
  const accepted=await probe(base(),1);
  assert.equal(accepted.accepted,true);
  assert.equal(accepted.condition.status,"OPEN");
  assert.equal(accepted.condition.resultId,"R1");
  assert.equal(accepted.condition.updatedAt,old);
  assert.equal(accepted.condition.escalationLevel,1);
  const relation=accepted.condition.result as Record<string,unknown>;
  assert.equal(relation.organizationId,"ORG1");
  assert.equal(relation.performingBranchId,"BR1");
  assert.deepEqual(relation.OR,[
    {status:{in:["VERIFIED","RELEASED"]}},
    {status:"ENTERED",validationStage:"MEDICAL_VALIDATION"},
  ]);
  assert.equal((accepted.changed.updatedAt as Date).getTime(),old.getTime()+1);
});

test("Stage 78: ACK records validator, clears due time; ESCALATED increments only once; missed calls still advance version",async()=>{
  const ack=await probe({...base(),outcome:"ACKNOWLEDGED"},1);
  assert.equal(ack.changed.status,"ACKNOWLEDGED");
  assert.equal(ack.changed.acknowledgedByUserId,"U1");
  assert.equal(ack.changed.acknowledgedAt?.toString(),base().communicatedAt.toString());
  assert.equal(ack.changed.nextEscalationDueAt,null);
  const escalated=await probe({...base(),outcome:"ESCALATED"},1);
  assert.deepEqual(escalated.changed.escalationLevel,{increment:1});
  assert.equal(escalated.changed.nextEscalationDueAt?.toString(),base().nextEscalationDueAt?.toString());
  for(const outcome of ["NO_ANSWER","FAILED","LEFT_MESSAGE"] as const){
    const c=await probe({...base(),outcome},1);
    assert.equal(c.changed.status,undefined);
    assert.equal(c.changed.escalationLevel,undefined);
    assert.ok(c.changed.updatedAt instanceof Date);
  }
});

test("Stage 78: communication and audit run strictly AFTER atomic claim in a single transaction",()=>{
  const route=readFileSync("src/app/api/results/[id]/critical-communications/route.ts","utf8");
  const helper=readFileSync("src/lib/critical-communication-claim.ts","utf8");
  assert.match(route,/await prisma\.\$transaction\(async \(tx\) => \{/);
  assert.match(route,/const claimed = await claimCriticalCommunication\(tx,/);
  assert.match(route,/if \(!claimed\) return null;/);
  const first=route.indexOf("const claimed = await claimCriticalCommunication");
  const create=route.indexOf("await tx.criticalResultCommunication.create");
  const audit=route.indexOf("await tx.auditEvent.create");
  assert.ok(first>0 && first<create && create<audit);
  assert.match(route,/critical_event_state_changed_reload/);
  assert.match(route,/event.status !== "OPEN"/);
  assert.match(route,/read_back_confirmation_required/);
  assert.match(route,/critical_escalation_limit_reached/);
  assert.doesNotMatch(route,/tx\.criticalResultEvent\.update\(/);
  assert.match(helper,/updateMany\(\{/);
  assert.match(helper,/status: "OPEN"/);
  assert.match(helper,/observedUpdatedAt\.getTime\(\) \+ 1/);
});
