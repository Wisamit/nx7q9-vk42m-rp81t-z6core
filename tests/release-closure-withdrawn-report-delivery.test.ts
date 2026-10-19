import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Manual browser print/PDF delivery requires the exact current unretracted report inside transaction",()=>{
  const src=readFileSync("src/app/api/reports/[versionId]/delivery/route.ts","utf8");
  const tx=src.indexOf("const event = await prisma.$transaction");
  const reportLock=src.indexOf("FROM diagnostic_reports",tx);
  const versionLock=src.indexOf("FROM diagnostic_report_versions",reportLock);
  const delivery=src.indexOf("tx.reportDeliveryEvent.create",versionLock);
  const audit=src.indexOf("tx.auditEvent.create",delivery);
  assert.ok(tx>=0 && reportLock>tx && versionLock>reportLock && delivery>versionLock && audit>delivery);
  assert.ok(src.slice(reportLock,versionLock).includes("FOR UPDATE"));
  assert.ok(src.slice(versionLock,delivery).includes("FOR UPDATE"));
  assert.ok(src.slice(reportLock,versionLock).includes("currentReport[0].currentVersion !== version.version"));
  assert.ok(src.slice(versionLock,delivery).includes('["PARTIAL", "FINAL", "AMENDED"]'));
  assert.ok(src.includes('error: "report_version_not_current_or_retracted"'));
  assert.ok(src.includes("if (error instanceof ReportDeliveryStateChanged) return null"));
  assert.ok(src.includes('body.channel !== "PRINT" && body.channel !== "DOWNLOAD"'),
    "Browser must never impersonate trusted provider delivery");
});
test("Retracted clinical report remains visible as withdrawn history but cannot be printed or queued",()=>{
  const src=readFileSync("src/app/reports/[orderId]/page.tsx","utf8");
  assert.ok(src.includes('const currentReportDeliverable = latest.version === report.currentVersion'));
  assert.ok(src.includes('["PARTIAL", "FINAL", "AMENDED"].includes(latest.status)'));
  assert.ok(src.includes('permissions.has("reports.deliver") && currentReportDeliverable && <>'));
  assert.ok(src.includes('permissions.has("reports.deliver") && currentReportDeliverable && <ReportOutboundDelivery'));
  assert.ok(src.includes('latest.status === "RETRACTED" && <div role="alert"'));
  assert.ok(src.includes("تقرير مسحوب — غير صالح للاستخدام السريري"));
  assert.ok(src.includes('latest.status === "RETRACTED" && <section'),
    "Past withdrawn versions remain identifiable in the staff audit view");
});
