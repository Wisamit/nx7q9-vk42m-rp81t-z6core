import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parsePromisedReportDelivery} from "../src/lib/order-promised-delivery.ts";
const earlier=new Date("2026-10-13T00:00:00.000Z");

test("Stage 112: delivery commitment is optional, never synthesized from TAT",()=>{
  assert.deepEqual(parsePromisedReportDelivery(null,"Asia/Dubai",earlier),{ok:true,snapshot:null});
  assert.deepEqual(parsePromisedReportDelivery("","Asia/Dubai",earlier),{ok:true,snapshot:null});
  assert.deepEqual(parsePromisedReportDelivery(undefined,"Asia/Dubai",earlier),{ok:true,snapshot:null});
  const value=parsePromisedReportDelivery("2026-10-14T10:15","Asia/Dubai",earlier);
  assert.equal(value.ok,true);
  if(!value.ok||!value.snapshot)throw Error("valid promise missing");
  assert.equal(value.snapshot.promisedReportDeliveryAtUtc.toISOString(),"2026-10-14T06:15:00.000Z");
  assert.equal(value.snapshot.promisedReportDeliveryLocal,"2026-10-14T10:15");
  assert.equal(value.snapshot.promisedReportDeliveryTimezone,"Asia/Dubai");
  const istanbul=parsePromisedReportDelivery("2026-10-14T10:15","Europe/Istanbul",earlier);
  assert.equal(istanbul.ok,true);
  if(!istanbul.ok||!istanbul.snapshot)throw Error("valid Istanbul promise missing");
  assert.equal(istanbul.snapshot.promisedReportDeliveryAtUtc.toISOString(),"2026-10-14T07:15:00.000Z");
});

test("Stage 112: reject malformed, nonexistent, stale, wrong-zone and ambiguous local deadlines",()=>{
  for(const input of [123,false,{},[], "2026-10-14",
    "2026-10-14T10:15:00","2026-02-30T12:00","2026-13-01T00:00",
    "2026-10-14T25:00","2026-10-14T10:99","2026-10-14T10:15Z",
    "2026-10-14T10:15\n"]){
    assert.equal(parsePromisedReportDelivery(input,"Asia/Dubai",earlier).ok,false,String(input));
  }
  assert.deepEqual(parsePromisedReportDelivery("2026-10-14T10:15","Unknown/Zone",earlier),
    {ok:false,error:"invalid_ordering_branch_timezone"});
  assert.deepEqual(parsePromisedReportDelivery("2026-10-12T10:15","Asia/Dubai",earlier),
    {ok:false,error:"promised_report_delivery_in_past"});
  assert.equal(parsePromisedReportDelivery("2026-03-08T02:30","America/New_York",
    new Date("2026-01-01T00:00:00Z")).ok,false);
  assert.deepEqual(parsePromisedReportDelivery("2026-11-01T01:30","America/New_York",
    earlier),{ok:false,error:"ambiguous_promised_report_delivery"});
  assert.equal(parsePromisedReportDelivery("2026-11-01T03:30","America/New_York",earlier).ok,true);
});

test("Stage 112: branch-local promise is validated before posting and saved with audit",()=>{
  const api=readFileSync("src/app/api/orders/route.ts","utf8");
  const schema=readFileSync("prisma/schema.prisma","utf8");
  const migration=readFileSync("prisma/migrations/20261013184000_order_promised_report_delivery_snapshot/migration.sql","utf8");
  const ui=readFileSync("src/components/order-create-form.tsx","utf8");
  const details=readFileSync("src/app/orders/[id]/page.tsx","utf8");
  assert.match(api,/parsePromisedReportDelivery\(\s*body.promisedReportDeliveryLocal, orderingBranch.timezone/);
  assert.ok(api.indexOf("const promisedDelivery = parsePromisedReportDelivery") <
    api.indexOf("await tx.labOrder.create"));
  assert.match(api,/timezone: orderingBranch.timezone/);
  assert.match(api,/promisedReportDeliveryAtUtc: promisedDeliverySnapshot\?\.promisedReportDeliveryAtUtc/);
  assert.match(api,/promisedReportDeliveryLocal: promisedDeliverySnapshot\?\.promisedReportDeliveryLocal/);
  assert.match(api,/promisedReportDeliveryTimezone: promisedDeliverySnapshot\?\.promisedReportDeliveryTimezone/);
  assert.match(api,/origin: "STAFF_ENTERED_AT_REGISTRATION"/);
  assert.match(api,/action: "ORDER_REGISTERED"/);
  assert.match(schema,/promisedReportDeliveryAtUtc DateTime\?/);
  assert.match(schema,/promisedReportDeliveryTimezone String\?/);
  assert.match(migration,/ADD COLUMN .promised_report_delivery_at_utc. DATETIME\(3\) NULL/);
  assert.match(migration,/ADD COLUMN .promised_report_delivery_local. VARCHAR\(16\) NULL/);
  assert.match(migration,/ADD COLUMN .promised_report_delivery_timezone. VARCHAR\(64\) NULL/);
  assert.match(ui,/name="promisedReportDeliveryLocal"/);
  assert.match(ui,/type="datetime-local"/);
  assert.match(details,/order.promisedReportDeliveryTimezone/);
  assert.match(details,/order.promisedReportDeliveryAtUtc\?\.toISOString\(\)/);
  assert.doesNotMatch(api,/promisedReportDeliveryLocal:\s*.*tatDueAt/);
});
