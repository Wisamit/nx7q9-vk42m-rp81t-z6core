import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {hasLiveStaffWorkspace, type StaffSessionWorkspace} from "../src/lib/live-session-workspace.ts";

const workspace=():StaffSessionWorkspace=>({
  activeBranchId:"branch-a",
  activeBranch:{id:"branch-a",organizationId:"org-a",status:"ACTIVE"},
  user:{
    organizationId:"org-a",
    organization:{status:"ACTIVE"},
    branchScopes:[
      {branchId:"branch-a",branch:{organizationId:"org-a",status:"ACTIVE"}},
      {branchId:"branch-b",branch:{organizationId:"org-a",status:"ACTIVE"}},
    ],
  },
});
const change=(fn:(s:StaffSessionWorkspace)=>void)=>{
  const value=workspace();
  fn(value);
  return hasLiveStaffWorkspace(value);
};

test("F7 session revocation: only an active tenant and an actively scoped branch can authorize an existing staff workspace",()=>{
  assert.equal(hasLiveStaffWorkspace(workspace()),true);
  assert.equal(change(s=>{s.user.organization.status="INACTIVE";}),false);
  assert.equal(change(s=>{s.activeBranchId=null;}),false);
  assert.equal(change(s=>{s.activeBranch=null;}),false);
  assert.equal(change(s=>{s.activeBranch!.status="INACTIVE";}),false);
  assert.equal(change(s=>{s.activeBranch!.id="branch-b";}),false);
  assert.equal(change(s=>{s.activeBranch!.organizationId="org-b";}),false);
  assert.equal(change(s=>{s.user.branchScopes=[];}),false);
  assert.equal(change(s=>{s.user.branchScopes=s.user.branchScopes.filter(x=>x.branchId==="branch-b");}),false,
    "having an active scope at another branch does not implicitly authorize the old branch");
  assert.equal(change(s=>{s.user.branchScopes[0].branch.status="INACTIVE";}),false);
  assert.equal(change(s=>{s.user.branchScopes[0].branch.organizationId="org-b";}),false);
  assert.equal(change(s=>{s.user.branchScopes[0].branchId="branch-b";}),false);
});

test("F7 session revocation: branch switching is allowed only when the new active branch is truly scoped",()=>{
  assert.equal(change(s=>{
    s.activeBranchId="branch-b";
    s.activeBranch={id:"branch-b",organizationId:"org-a",status:"ACTIVE"};
  }),true);
  assert.equal(change(s=>{
    s.activeBranchId="branch-b";
    s.activeBranch={id:"branch-b",organizationId:"org-a",status:"INACTIVE"};
  }),false);
  assert.equal(change(s=>{
    s.activeBranchId="branch-b";
    s.activeBranch={id:"branch-b",organizationId:"org-a",status:"ACTIVE"};
    s.user.branchScopes=s.user.branchScopes.filter(x=>x.branchId==="branch-a");
  }),false);
});

test("F7 session revocation: all staff server routes share guarded session source",()=>{
  const staff=readFileSync("src/lib/auth.ts","utf8");
  const login=readFileSync("src/app/api/auth/login/route.ts","utf8");
  const branch=readFileSync("src/app/api/session/active-branch/route.ts","utf8");
  assert.ok(staff.includes('user: { status: "ACTIVE", organization: { status: "ACTIVE" } }'),
    "active employee without an active organization must never retain a staff session");
  assert.ok(staff.includes('hasLiveStaffWorkspace(session)'),
    "organization and branch-scoped workspaces must be verified on each authenticated request");
  assert.ok(staff.includes('if (!session || !hasLiveStaffWorkspace(session)) return null'));
  assert.ok(staff.includes('const session = await prisma.userSession.findFirst('));
  assert.ok(login.includes('where: { username, status: "ACTIVE", organization: { status: "ACTIVE" } }'),
    "new staff logins also require an active organization");
  assert.ok(login.includes('scope.branch.organizationId === user.organizationId'),
    "new staff sessions may only pick their own organization's branch");
  assert.ok(branch.includes('canAccessBranch(session, branchId)'),
    "existing branch-switch API must enforce branch-scope authority");
});

test("F7 session revocation: portal session checks active portal account AND active organization on each request",()=>{
  const portal=readFileSync("src/lib/portal-auth.ts","utf8");
  const login=readFileSync("src/app/api/portal/auth/login/route.ts","utf8");
  const root=readFileSync("src/app/layout.tsx","utf8");
  assert.ok(portal.includes('portalAccount: { status: "ACTIVE", organization: { status: "ACTIVE" } }'),
    "a portal account alone cannot authorize a session after tenant deactivation");
  assert.ok(portal.includes('revokedAt: null'));
  assert.ok(portal.includes('expiresAt: { gt: new Date() }'));
  assert.ok(login.includes('organization: { code: organizationCode, status: "ACTIVE" }'),
    "portal login already refuses a deactivated organization");
  assert.ok(root.includes('const portalSession = session ? null : await getCurrentPortalSession()'),
    "public/root portal presentation must not reuse a retired organization's cookie");
});

test("F7 session revocation: existing session boundaries are still fail closed",()=>{
  const staff=readFileSync("src/lib/auth.ts","utf8");
  const portal=readFileSync("src/lib/portal-auth.ts","utf8");
  assert.ok(staff.includes('expiresAt: { gt: new Date() }'));
  assert.ok(staff.includes('revokedAt: null'));
  assert.ok(staff.includes('user: { status: "ACTIVE"'));
  assert.ok(portal.includes('portalAccount: { status: "ACTIVE"'));
  assert.ok(staff.includes('if (!session) redirect("/login")'));
  assert.ok(portal.includes('if (!session) redirect("/portal/login")'));
});
