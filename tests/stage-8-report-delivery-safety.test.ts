import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalReportOrigin } from "../src/lib/report-origin.ts";

function code(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("report links require an explicit trusted HTTPS origin", () => {
  assert.equal(canonicalReportOrigin("https://lab.example.com/",true),"https://lab.example.com");
  assert.equal(canonicalReportOrigin("https://lab.example.com:8443/",true),"https://lab.example.com:8443");
  for (const malicious of [
    null,"", "http://lab.example.com", "https://evil.example/path",
    "https://lab.example.com/portal", "https://lab.example.com/?token=1",
    "https://lab.example.com/#frag", "https://user:password@lab.example.com",
    "ftp://lab.example.com","//evil.example.com","javascript:alert(1)","not a url",
  ]) assert.equal(canonicalReportOrigin(malicious,true),null, String(malicious));
  assert.equal(canonicalReportOrigin("http://localhost:3000/",false),"http://localhost:3000");
  assert.equal(canonicalReportOrigin("http://127.0.0.1:3000/",false),"http://127.0.0.1:3000");
  assert.equal(canonicalReportOrigin("http://evil.example.com",false),null);
});

test("QR and outbound secure portal URLs never derive from untrusted request host", () => {
  const outbound=code("../src/app/api/reports/[versionId]/outbound/route.ts");
  const report=code("../src/app/reports/[orderId]/page.tsx");
  for(const page of [outbound,report]) {
    assert.ok(page.includes("canonicalReportOrigin("));
    assert.ok(page.includes("process.env.NEXT_PUBLIC_APP_URL"));
    assert.ok(!page.includes('get("x-forwarded-host")'));
    assert.ok(!page.includes('get("host")'));
  }
  assert.ok(outbound.includes('error: "public_app_url_required"'));
});

test("clinical release claims an exact verified result revision before report version allocation", () => {
  const source=code("../src/app/api/results/[id]/release/route.ts");
  const tx=source.indexOf("const released = await prisma.$transaction");
  const claim=source.indexOf("tx.laboratoryResult.updateMany",tx);
  const report=source.indexOf("tx.diagnosticReport.upsert",claim);
  const parentLock=source.indexOf("FROM diagnostic_reports",report);
  const previous=source.indexOf("tx.diagnosticReportVersion.findFirst",parentLock);
  const create=source.indexOf("tx.diagnosticReportVersion.create",previous);
  assert.ok(tx>=0 && claim>tx && report>claim && parentLock>report && previous>parentLock && create>previous);
  assert.ok(source.slice(claim,report).includes('status: "VERIFIED"'));
  assert.ok(source.slice(claim,report).includes('validationStage: "COMPLETE"'));
  assert.ok(source.slice(claim,report).includes('updatedAt: result.updatedAt'));
  assert.ok(source.slice(parentLock,previous).includes("FOR UPDATE"));
  assert.ok(source.includes('error: "result_already_released_or_state_changed"'));
});

test("browser delivery audit cannot impersonate provider or portal events", () => {
  const api=code("../src/app/api/reports/[versionId]/delivery/route.ts");
  assert.ok(api.includes('body.channel !== "PRINT" && body.channel !== "DOWNLOAD"'));
  assert.ok(api.includes('body.status !== "RECORDED"'));
  assert.ok(api.includes('status: "RECORDED"'));
  assert.ok(api.includes('recipient: null'));
  assert.ok(api.includes('externalRef: null'));
  assert.ok(api.includes("verifiedRecipientDownload: false"));
  assert.ok(api.includes('input.mimeType !== "application/pdf"'));
  const pdf=code("../src/components/report-pdf-button.tsx");
  assert.ok(pdf.includes('status: "RECORDED"'));
});

test("outbound dispatcher revalidates the current report version while holding the shared report lock", () => {
  const api=code("../src/app/api/reports/[versionId]/outbound/route.ts");
  const tx=api.indexOf("const queued = await prisma.$transaction");
  const lock=api.indexOf("FROM diagnostic_reports",tx);
  const latest=api.indexOf("tx.diagnosticReportVersion.findFirst",lock);
  const duplicate=api.indexOf("tx.reportDeliveryEvent.findFirst",latest);
  const queue=api.indexOf("tx.reportDeliveryEvent.create",duplicate);
  assert.ok(tx>=0 && lock>tx && latest>lock && duplicate>latest && queue>duplicate);
  assert.ok(api.slice(duplicate,queue).includes('status: { in: ["QUEUED", "SENT", "DELIVERED"] }'));
  assert.ok(api.includes('error: "report_delivery_already_pending_or_sent"'));
  assert.ok(api.slice(lock,latest).includes("FOR UPDATE"));
  assert.ok(api.slice(latest,queue).includes('current.status === "RETRACTED"'));
  assert.ok(api.includes('error: "report_version_changed_retry"'));
});

test("portal never exposes a retracted report as a delivered clinical document", () => {
  const portal=code("../src/app/portal/reports/[versionId]/page.tsx");
  const block=portal.indexOf('if (version.status === "RETRACTED")');
  const record=portal.indexOf("prisma.reportDeliveryEvent.create",block);
  assert.ok(block>0 && record>block);
  assert.ok(portal.slice(block,record).includes("PORTAL_RETRACTED_REPORT_VIEW_BLOCKED"));
  assert.ok(portal.includes('version.report.currentVersion !== version.version'));
  const verify=code("../src/app/verify/report/[token]/page.tsx");
  assert.ok(verify.includes('version.status !== "RETRACTED"'));
  assert.ok(verify.includes('version.version === version.report.currentVersion'));
  assert.ok(verify.includes("snapshot.patient?.patientNumber"));
  assert.ok(!verify.includes("order.patient.patientNumber"));
});

test("queued report notifications are not dispatched after amendment or retraction", () => {
  const dispatcher = code("../src/lib/notifications.ts");
  const start = dispatcher.indexOf("async function dispatchPendingNotifications");
  const claim = dispatcher.indexOf("const claim = await db.notificationDelivery.updateMany",start);
  const report = dispatcher.indexOf("const version = await db.diagnosticReportVersion.findFirst",claim);
  const stop = dispatcher.indexOf("const config = gatewayConfig",report);
  const post = dispatcher.indexOf("await fetch(config.url",stop);
  assert.ok(claim>start && report>claim && stop>report && post>stop);
  const gated=dispatcher.slice(report,stop);
  assert.ok(gated.includes('version.status === "RETRACTED"'));
  assert.ok(gated.includes("version.version !== version.report.currentVersion"));
  assert.ok(gated.includes("NotificationDeliveryStatus.SKIPPED"));
  assert.ok(gated.includes("report_version_superseded_or_retracted"));
  assert.ok(gated.includes("nextAttemptAt: null"));
});

test("released report patient sex and age derive only from immutable order demographic context", () => {
  const source=code("../src/lib/report-snapshot.ts");
  assert.ok(source.includes("order.patientDobSnapshot"));
  assert.ok(source.includes('order.patientSexSnapshot || "UNKNOWN"'));
  assert.ok(source.includes("order.patientAgeValueSnapshot"));
  assert.ok(source.includes("order.patientAgeUnitSnapshot"));
  assert.ok(!source.includes("order.patient.dateOfBirth?.toISOString()"));
  assert.ok(!source.includes("sexAtBirth: order.patient.sexAtBirth"));
});
