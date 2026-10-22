import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolveRootInterfaceContext} from "../src/lib/root-interface-context.ts";

test("F7 root document: portal-only sessions choose that account's organization and language",()=>{
  const portal={organizationId:"portal-org",preferredLocale:"ar"};
  const result=resolveRootInterfaceContext(null,portal);
  assert.deepEqual(result,{organizationId:"portal-org",preferredLocale:"ar",source:"portal"});
  assert.deepEqual(resolveRootInterfaceContext(null,{...portal,preferredLocale:"en"}),
    {organizationId:"portal-org",preferredLocale:"en",source:"portal"});
});

test("F7 root document: staff session cannot be impersonated or overridden by portal cookie",()=>{
  const staff={organizationId:"staff-org",preferredLocale:"en"};
  const portal={organizationId:"portal-org",preferredLocale:"ar"};
  assert.deepEqual(resolveRootInterfaceContext(staff,portal),
    {organizationId:"staff-org",preferredLocale:"en",source:"staff"});
  assert.deepEqual(resolveRootInterfaceContext(staff,null),
    {organizationId:"staff-org",preferredLocale:"en",source:"staff"});
  assert.deepEqual(resolveRootInterfaceContext(
    {organizationId:"staff-org",preferredLocale:"ar"},portal),
    {organizationId:"staff-org",preferredLocale:"ar",source:"staff"});
});

test("F7 root document: anonymous fallback keeps original organization-default locale",()=>{
  assert.deepEqual(resolveRootInterfaceContext(null,null),
    {organizationId:null,preferredLocale:null,source:"public"});
  assert.equal(resolveRootInterfaceContext(null,{
    organizationId:"test-org",preferredLocale:"fr",
  }).preferredLocale,"en","unsupported locale must never change HTML to an arbitrary value");
});

test("F7 root DOM: locale, direction, theme and branding come from scoped session",()=>{
  const root=readFileSync("src/app/layout.tsx","utf8");
  const portal=readFileSync("src/app/portal/page.tsx","utf8");
  const auth=readFileSync("src/lib/portal-auth.ts","utf8");
  assert.ok(root.includes('import { getCurrentPortalSession } from "@/lib/portal-auth"'));
  assert.ok(root.includes("const portalSession = session ? null : await getCurrentPortalSession()"),
    "staff sessions retain precedence and cannot be replaced by portal identity");
  assert.ok(root.includes("resolveRootInterfaceContext("));
  assert.ok(root.includes("portalSession.portalAccount.organizationId"));
  assert.ok(root.includes("portalSession.portalAccount.preferredLocale"));
  assert.ok(root.includes("context.organizationId"));
  assert.ok(root.includes("await getOrganizationSystemSettings(context.organizationId)"));
  assert.ok(root.includes("const locale = context.preferredLocale"));
  assert.ok(root.includes('lang={locale}'));
  assert.ok(root.includes('dir={direction}'));
  assert.ok(root.includes("settings?.defaultLocale"),
    "anonymous users must still honor organization default locale");
  assert.ok(auth.includes('portalAccount: { status: "ACTIVE", organization: { status: "ACTIVE" } }'),
    "document context must require both an active account and an active organization");
  assert.ok(portal.includes("getUiLocale(account.preferredLocale)"),
    "portal page content must stay tied to the portal account's language");
});
