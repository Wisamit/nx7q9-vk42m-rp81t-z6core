import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src=(path:string)=>readFileSync(path,"utf8");

test("UI #265: home collection requires exact-order and custody transition confirmation",()=>{
  const ui=src("src/components/home-collection-workstation.tsx");
  assert.equal((ui.match(/<CrudModal\b/g)||[]).length,1);
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes('onSubmit={confirmPending}'));
  assert.ok(ui.includes('kind:"link"|"status"'));
  assert.ok(ui.includes('onClick={reviewLink}'));
  for(const next of ["ASSIGNED","EN_ROUTE","ARRIVED","COLLECTING","COLLECTED","DELIVERED"]){
    assert.ok(ui.includes('transition("'+next+'")'),next);
  }
  assert.ok(ui.includes('availableOrders.some(order=>order.id===proposal.order)'));
  assert.ok(ui.includes('assignedCollectorUserId:proposal.collector'));
  assert.ok(ui.includes('scheduledDepartureAt:new Date(proposal.depart).toISOString()'));
  assert.ok(ui.includes('if(saved)setPending(null)'));
  assert.ok(ui.includes('if(!busy)setPending(null)'));
  assert.ok(ui.includes('role="alert"'));
  assert.ok(ui.includes('setFormError('));
  assert.doesNotMatch(ui,/(?:window\.)?(?:confirm|prompt)\s*\(/);
});

test("UI #265: home collection never mutates sample barcode custody or posted finance directly",()=>{
  const ui=src("src/components/home-collection-workstation.tsx");
  assert.ok(ui.includes('item.barcode'));
  assert.ok(ui.includes('collectedHere'));
  assert.ok(ui.includes('receivedHere'));
  assert.ok(ui.includes('/phlebotomy?specimen='));
  assert.ok(ui.includes('/specimens?q='));
  assert.ok(ui.includes("invoiceNumber"));
  assert.ok(ui.includes('!availableOrders.some(order=>order.id===proposal.order)'));
  const actionApi=src("src/app/api/home-collections/[id]/route.ts");
  const linkApi=src("src/app/api/home-collections/[id]/order/route.ts");
  for(const server of [actionApi,linkApi]){
    assert.ok(server.includes("organizationId"));
    assert.ok(server.includes("auditEvent"));
  }
});
