import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  submitStaffSignIn, submitPortalSignIn, submitPortalPasswordChange,
} from "../src/lib/auth-form-transport.ts";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{"content-type":"application/json"},
});
const staffPayload={username:"test_user",password:"synthetic_password",code:"123456"};
const portalPayload={organizationCode:"SYNTHETIC",login:"sample@example.test",password:"synthetic_password"};

test("F7 staff login recognizes only exact HTTP 200 authenticated receipt",async()=>{
  const actual=await submitStaffSignIn(staffPayload,false,async(url,opts)=>{
    assert.equal(url,"/api/auth/login");
    assert.equal(opts.method,"POST");
    assert.deepEqual(JSON.parse(opts.body as string),
      {username:"test_user",password:"synthetic_password"});
    return json({status:"ok"});
  });
  assert.deepEqual(actual,{kind:"authenticated"});
  for(const response of [
    json({status:"ok"},202),
    json({status:"pending"}),
    json({status:"ok"},500),
    json({mfaRequired:false}),
    new Response("not-json",{status:200}),
  ]){
    assert.deepEqual(await submitStaffSignIn(staffPayload,false,async()=>response),
      {kind:"uncertain"});
  }
});

test("F7 staff MFA requires explicitly attested challenge and final response",async()=>{
  const challenge=await submitStaffSignIn(staffPayload,false,async()=>
    json({status:"mfa_required",mfaRequired:true},202));
  assert.deepEqual(challenge,{kind:"mfa_required"});
  const mfa=await submitStaffSignIn(staffPayload,true,async(url,opts)=>{
    assert.equal(url,"/api/auth/mfa/verify");
    assert.deepEqual(JSON.parse(opts.body as string),{code:"123456"});
    return json({status:"ok"});
  });
  assert.deepEqual(mfa,{kind:"authenticated"});
  const invalid=await submitStaffSignIn(staffPayload,true,async()=>
    json({status:"mfa_required",mfaRequired:true},202));
  assert.deepEqual(invalid,{kind:"uncertain"},
    "MFA verify must not accept a second challenge as completion");
  assert.deepEqual(await submitStaffSignIn(staffPayload,false,async()=>
    json({status:"mfa_required",mfaRequired:false},202)),{kind:"uncertain"});
});

test("F7 portal login only routes after explicit authenticated receipt with boolean password requirement",async()=>{
  for(const required of [true,false]){
    const outcome=await submitPortalSignIn(portalPayload,async(url,opts)=>{
      assert.equal(url,"/api/portal/auth/login");
      assert.deepEqual(JSON.parse(opts.body as string),portalPayload);
      return json({status:"ok",mustChangePassword:required});
    });
    assert.deepEqual(outcome,{kind:"authenticated",mustChangePassword:required});
  }
  for(const response of [
    json({status:"ok"}),
    json({status:"ok",mustChangePassword:"false"}),
    json({status:"ok",mustChangePassword:true},202),
    json({status:"pending",mustChangePassword:false}),
    json({status:"ok",mustChangePassword:false},503),
    new Response("not-json",{status:200}),
  ]){
    assert.deepEqual(await submitPortalSignIn(portalPayload,async()=>response),
      {kind:"uncertain"});
  }
});

test("F7 portal password change only confirms exact HTTP 200 status ok",async()=>{
  const success=await submitPortalPasswordChange("synthetic-long-password",async(url,opts)=>{
    assert.equal(url,"/api/portal/auth/change-password");
    assert.deepEqual(JSON.parse(opts.body as string),{password:"synthetic-long-password"});
    return json({status:"ok"});
  });
  assert.deepEqual(success,{kind:"changed"});
  for(const response of [
    json({status:"ok"},202),
    json({status:"ok"},500),
    json({status:"pending"}),
    new Response("malformed",{status:200}),
  ]){
    assert.deepEqual(await submitPortalPasswordChange("synthetic-long-password",async()=>response),
      {kind:"uncertain"});
  }
});

test("F7 auth forms recognize explicit 4xx rejection without revealing raw transport errors",async()=>{
  assert.deepEqual(await submitStaffSignIn(staffPayload,false,async()=>
    json({error:"account_temporarily_locked"},423)),
    {kind:"rejected",error:"account_temporarily_locked"});
  assert.deepEqual(await submitPortalSignIn(portalPayload,async()=>
    json({error:"rate_limited"},429)),{kind:"rejected",error:"rate_limited"});
  assert.deepEqual(await submitPortalPasswordChange("synthetic-long-password",async()=>
    json({error:"password_too_short"},400)),
    {kind:"rejected",error:"password_too_short"});
  assert.deepEqual(await submitStaffSignIn(staffPayload,true,async()=>
    new Response("not-json",{status:401})),{kind:"rejected",error:"unknown"});
});

test("F7 auth forms never automatically replay an uncertain authentication mutation",async()=>{
  let count=0;
  const disconnected=async():Promise<Response>=>{
    count++;
    throw Error("synthetic secret network diagnostic");
  };
  assert.deepEqual(await submitStaffSignIn(staffPayload,false,disconnected),
    {kind:"uncertain"});
  assert.equal(count,1);
  assert.deepEqual(await submitStaffSignIn(staffPayload,true,disconnected),
    {kind:"uncertain"});
  assert.equal(count,2);
  assert.deepEqual(await submitPortalSignIn(portalPayload,disconnected),
    {kind:"uncertain"});
  assert.equal(count,3);
  assert.deepEqual(await submitPortalPasswordChange("synthetic-long-password",disconnected),
    {kind:"uncertain"});
  assert.equal(count,4);
});

test("F7: neither staff nor portal logout navigates without an acknowledged revocation",async()=>{
  for(const [audience,expected] of [
    ["staff","/api/auth/logout"],["portal","/api/portal/auth/logout"],
  ] as const){
    const ok=await import("../src/lib/auth-form-transport.ts").then(
      ({submitSignOut})=>submitSignOut(audience,async(url,init)=>{
        assert.equal(url,expected);
        assert.equal(init.method,"POST");
        return json({status:"ok"});
      }),
    );
    assert.deepEqual(ok,{kind:"signed_out"},audience);
  }
  const {submitSignOut}=await import("../src/lib/auth-form-transport.ts");
  for(const result of [
    json({status:"pending"}),
    json({status:"ok"},202),
    json({status:"ok"},500),
    new Response("not-json",{status:200}),
  ]) {
    assert.deepEqual(await submitSignOut("portal",async()=>result),{kind:"uncertain"});
  }
  let calls=0;
  const lost=async():Promise<Response>=>{calls++;throw Error("network failure");};
  assert.deepEqual(await submitSignOut("staff",lost),{kind:"uncertain"});
  assert.equal(calls,1,"logout failure must not trigger an automatic retry");
});

test("F7 logout UI retains page and displays a bilingual warning if the session may still exist",()=>{
  for(const path of [
    "src/components/logout-button.tsx",
    "src/components/portal-logout-button.tsx",
  ]){
    const s=readFileSync(path,"utf8");
    assert.match(s,/submitSignOut\("(?:staff|portal)"\)/);
    assert.match(s,/kind === "signed_out"/);
    assert.match(s,/inFlight\.current/);
    assert.match(s,/finally \{[\s\S]*?set(?:Loading|Busy)\(false\)/);
    assert.match(s,/role="alert"/);
    assert.doesNotMatch(s,/await fetch\(/,path);
    assert.ok(s.indexOf('kind === "signed_out"')<s.indexOf('router.replace('),
      "navigation must happen only after the server confirms session revocation");
  }
  const shell=readFileSync("src/components/system-shell.tsx","utf8");
  assert.ok(shell.includes('locale={locale}'),
    "staff logout warning must use the active session language");
});

test("F7 UI source gates: busy never locks permanently, uncertain outcomes require reload and no double submits",()=>{
  for(const path of [
    "src/components/staff-login-form.tsx",
    "src/components/portal-login-form.tsx",
    "src/components/portal-change-password-form.tsx",
  ]){
    const s=readFileSync(path,"utf8");
    assert.match(s,/const inFlight = useRef\(false\)/,path);
    assert.match(s,/const uncertain = useRef\(false\)/,path);
    assert.match(s,/inFlight\.current \|\| uncertain\.current/,path);
    assert.match(s,/setRequiresReconciliation\(true\)/,path);
    assert.match(s,/finally \{[\s\S]*?inFlight\.current = false/,path);
    assert.match(s,/disabled=\{(?:busy|loading) \|\| requiresReconciliation\}/,path);
    assert.match(s,/role="alert"/,path);
    assert.doesNotMatch(s,/await fetch\(/,path);
  }
});
