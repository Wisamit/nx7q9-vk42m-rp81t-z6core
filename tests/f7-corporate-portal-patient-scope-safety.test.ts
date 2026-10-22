import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { corporatePortalPatientScopes } from "../src/lib/corporate-portal-patient-scopes.ts";

test("F7 corporate portal: booking grant never grants clinical order or report visibility",()=>{
  const scopes=corporatePortalPatientScopes([
    {patientId:"booking-only",canBook:true,canViewReports:false},
    {patientId:"clinical-only",canBook:false,canViewReports:true},
    {patientId:"both",canBook:true,canViewReports:true},
    {patientId:"neither",canBook:false,canViewReports:false},
    {patientId:"booking-only",canBook:true,canViewReports:false},
  ]);
  assert.deepEqual(scopes.bookingPatientIds,["booking-only","both"]);
  assert.deepEqual(scopes.reportPatientIds,["clinical-only","both"]);
  assert.deepEqual(scopes.appointmentPatientIds,["booking-only","both","clinical-only"]);
  assert.ok(!scopes.reportPatientIds.includes("booking-only"));
  assert.ok(!scopes.reportPatientIds.includes("neither"));
  assert.deepEqual(corporatePortalPatientScopes([]),{
    bookingPatientIds:[],reportPatientIds:[],appointmentPatientIds:[],
  });
});

test("F7 corporate portal page applies active/effective grants and clinical read scope to orders",()=>{
  const source=readFileSync("src/app/portal/page.tsx","utf8");
  assert.match(source,/prisma\.corporatePortalPatientAccess\.findMany\(\{/);
  assert.match(source,/status: "ACTIVE"/);
  assert.match(source,/effectiveFrom: \{ lte: now \}/);
  assert.match(source,/OR: \[\{ effectiveTo: null \}, \{ effectiveTo: \{ gte: now \} \}\]/);
  assert.match(source,/const scopes = corporatePortalPatientScopes\(access\)/);
  assert.match(source,/reportPatientIds = scopes\.reportPatientIds/);
  assert.match(source,/bookingPatientIds = scopes\.bookingPatientIds/);
  const orders=source.slice(source.indexOf("const orderWhere"),source.indexOf("const reportOrderWhere"));
  assert.match(orders,/patientId: \{ in: reportPatientIds \}/,
    "corporate clinical orders require report-view permission, not canBook");
  assert.doesNotMatch(orders,/patientId: \{ in: allowedPatientIds \}/);
  const appointments=source.slice(source.indexOf("const appointmentWhere"),source.indexOf("const [orders"));
  assert.match(appointments,/portalAccountId: account\.id/);
  assert.match(appointments,/patientId: \{ in: allowedPatientIds \}/,
    "booking visibility continues to be restricted to this portal account");
  assert.match(source,/id: \{ in: bookingPatientIds \}/,
    "booking form must retain authorized appointment-creation patients");
});
