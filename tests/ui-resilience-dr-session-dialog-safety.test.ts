import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source=(path:string)=>readFileSync(path,"utf8");

test("UI #265: all five continuity, backup evidence, DR and retention editors use guarded bilingual compact dialogs",()=>{
  const ui=source("src/components/resilience-manager.tsx");
  assert.equal((ui.match(/<CrudModal\b/g)||[]).length,6);
  assert.equal((ui.match(/<form\b/g)||[]).length,6);
  for (const fn of ["continuity","edgeNode","backup","drill","retention"]){
    assert.ok(ui.includes('onSubmit={'+fn+'}'),"Old request/fields retained for "+fn);
  }
  for(const key of ["continuity","edge","backup","drill","retention"]){
    assert.ok(ui.includes('uiEditor==="'+key+'"'),"Missing editor "+key);
  }
  assert.ok(ui.includes("if(!busy)setUiEditor(\"\")"));
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes("setFormError("));
  assert.ok(ui.includes("finally {"));
  assert.ok(ui.includes("role=\"alert\""));
  assert.ok(ui.includes("does not create or verify a real backup/restore"));
  assert.ok(ui.includes("does not perform an actual drill"));
});

test("UI #265: session purge requires explicit typed authorization and never purges clinical history",()=>{
  const ui=source("src/components/resilience-manager.tsx");
  assert.ok(ui.includes('open={purgePolicy!==null}'));
  assert.ok(ui.includes('onSubmit={purge}'));
  assert.ok(ui.includes('policy.enabled'));
  assert.ok(ui.includes('policy.action !== "PURGE"'));
  assert.ok(ui.includes('["USER_SESSIONS","PORTAL_SESSIONS"].includes(policy.dataClass)'));
  assert.ok(ui.includes('confirm: "PURGE_EXPIRED_SESSIONS"'));
  assert.ok(ui.includes('if(!busy)setPurgePolicy(null)'));
  assert.doesNotMatch(ui,/(?:window\.)?(?:confirm|prompt)\s*\(/);
  const api=source("src/app/api/resilience/retention/execute/route.ts");
  assert.ok(api.includes("PURGE_EXPIRED_SESSIONS"));
  assert.ok(api.includes("auditEvent"));
  assert.ok(api.includes("organizationId"));
});

test("UI #265: disaster-recovery form records evidence but does not claim actual restoration",()=>{
  const ui=source("src/components/resilience-manager.tsx");
  for(const endpoint of ["/api/resilience/continuity","/api/resilience/edge-nodes",
    "/api/resilience/backups","/api/resilience/drills","/api/resilience/retention"]) {
    assert.ok(ui.includes(endpoint));
  }
  for(const apiFile of ["continuity","edge-nodes","backups","drills","retention"]){
    const api=source("src/app/api/resilience/"+apiFile+"/route.ts");
    assert.ok(api.includes("auditEvent"));
    assert.ok(api.includes("organizationId"));
  }
  assert.ok(ui.includes('field(f,"restoreDurationMinutes")'));
  assert.ok(ui.includes('field(f,"evidenceReference")'));
  assert.ok(ui.includes('field(f,"actualRpoMinutes")'));
  assert.ok(ui.includes('field(f,"actualRtoMinutes")'));
});
