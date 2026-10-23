import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("F7 portal login rejects duplicate or cross-field identities rather than findFirst",()=>{
  const source=readFileSync("src/app/api/portal/auth/login/route.ts","utf8");
  assert.match(source,/portalAccount\.findMany\(\{/);
  assert.match(source,/organization: \{ code: organizationCode, status: "ACTIVE" \}/);
  assert.match(source,/OR: \[\{ normalizedEmail: login \}, \{ normalizedPhone: login \} \]/);
  assert.match(source,/take: 2/);
  assert.match(source,/matches\.length === 1 \? matches\[0\] : null/);
  assert.doesNotMatch(source,/portalAccount\.findFirst\(/);
  assert.ok(source.indexOf("matches.length === 1") < source.indexOf("compare(password, account.passwordHash)"),
    "ambiguous identities must be rejected before bcrypt or session creation");
  assert.match(source,/return NextResponse\.json\(\{ error: "invalid_credentials" \}, \{ status: 401 \}\)/);
  assert.match(source,/portalSession\.create\(/);
  assert.match(source,/SELECT id FROM portal_accounts/);
});

test("F7 login ambiguity is not resolved by choosing an active account over a disabled one",()=>{
  const source=readFileSync("src/app/api/portal/auth/login/route.ts","utf8");
  const start=source.indexOf("const matches = await prisma.portalAccount.findMany");
  const end=source.indexOf("const account = matches.length",start);
  const query=source.slice(start,end);
  assert.ok(start>0 && end>start);
  assert.doesNotMatch(query,/status:\s*"ACTIVE"\s*[,}]/,
    "individual account statuses must not be used to make duplicate identity collisions appear unique");
  assert.match(source,/account\.status === "DISABLED"/);
});
