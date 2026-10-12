import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {lotSafetyNext,lotSafetyReason,lotSafetyImpact} from "../src/lib/inventory-lot-safety.ts";

const src=(p:string)=>readFileSync(p,"utf8");
test("Stage 97: legal transitions never reactivate a permanently recalled lot",()=>{
 assert.equal(lotSafetyNext("AVAILABLE","QUARANTINE"),"QUARANTINED");
 assert.equal(lotSafetyNext("AVAILABLE","RECALL"),"RECALLED");
 assert.equal(lotSafetyNext("QUARANTINED","RECALL"),"RECALLED");
 assert.equal(lotSafetyNext("QUARANTINED","RELEASE"),"AVAILABLE");
 for(const a of ["QUARANTINE","RECALL","RELEASE"] as const){
   assert.equal(lotSafetyNext("RECALLED",a),null);
 }
 assert.equal(lotSafetyNext("AVAILABLE","RELEASE"),null);
 assert.equal(lotSafetyNext("QUARANTINED","QUARANTINE"),null);
});
test("Stage 97: explanations must be meaningful, bounded and immutable evidence structured",()=>{
 assert.equal(lotSafetyReason("urgent"),null);
 assert.equal(lotSafetyReason("a".repeat(1001)),null);
 assert.equal(lotSafetyReason("lot recalled due to QC failure"),
   "lot recalled due to QC failure");
 assert.equal(lotSafetyReason("documented safety\u0001 issue"),null);
 const impact=lotSafetyImpact([
   {branchId:"b",quantityOnHand:{toString:()=>"25.0000"},reservedQty:{toString:()=>"2.0000"}},
   {branchId:"a",quantityOnHand:{toString:()=>"1.0000"},reservedQty:{toString:()=>"0.0000"}},
 ]);
 assert.deepEqual(impact.map(i=>i.branchId),["a","b"]);
 assert.equal(impact[1].reserved,"2.0000");
});
test("Stage 97: safety lock is enforced server side at consumption, transfer, receipt, adjust and QC paths",()=>{
 const paths=[
   "src/app/api/inventory/consumption/route.ts",
   "src/app/api/inventory/transfers/[id]/approve/route.ts",
   "src/app/api/inventory/transfers/[id]/dispatch/route.ts",
   "src/app/api/inventory/adjustments/route.ts",
   "src/app/api/inventory/receipts/[id]/post/route.ts",
   "src/app/api/inventory/transfers/[id]/receive/route.ts",
   "src/app/api/qc/runs/route.ts",
 ];
 for(const path of paths){
   const source=src(path);
   assert.match(source,/lockLotsForSafety\(tx,/i,path+" must share row lock");
 }
 const consum=src(paths[0]);
 assert.match(consum,/row.safety_status!=="AVAILABLE"/);
 const approval=src(paths[1]),dispatch=src(paths[2]);
 assert.match(approval,/assertLotUsable\(safeLots,line.lotId\)/);
 assert.match(dispatch,/assertLotUsable\(safeLots,line.lotId\)/);
 assert.match(src(paths[3]),/movementType==="ADJUSTMENT_IN"/);
 assert.match(src(paths[4]),/assertLotUsable\(locked,lot.id\)/);
 assert.match(src(paths[5]),/Physical custody of an already shipped recalled lot/);
 assert.match(src(paths[6]),/assertLotUsable\(inventorySafety,linkedId\)/);
});
test("Stage 97: safety decisions are tenant safe and create new history, not delete movements",()=>{
 const api=src("src/app/api/inventory/lot-safety/route.ts");
 const migration=src("prisma/migrations/20261012211500_inventory_lot_safety/migration.sql");
 const schema=src("prisma/schema.prisma");
 const page=src("src/app/inventory/operations/page.tsx");
 assert.match(schema,/model InventoryLotSafetyEvent \{/);
 assert.match(migration,/DEFAULT 'AVAILABLE'/);
 assert.match(migration,/FOREIGN KEY\(`lot_id`\)/);
 assert.match(api,/permissionSet\(session\).has\("inventory.manage"\)/);
 assert.match(api,/tx.userBranchScope.findUnique/);
 assert.match(api,/lockLotsForSafety\(tx,org,\[lotId\]\)/);
 assert.match(api,/tx.inventoryLotSafetyEvent.create/);
 assert.match(api,/independent_lot_release_review_required/);
 assert.match(api,/all_affected_branch_scopes_required/);
 assert.match(api,/pending_lot_transfers_require_resolution/);
 assert.match(api,/INVENTORY_LOT_RECALLED/);
 assert.match(api,/isolationLevel:"Serializable"/);
 assert.doesNotMatch(api,/stockMovement.delete|inventoryLotStock.delete|inventoryLot.delete/);
 assert.match(page,/InventoryLotSafetyManager/);
});
