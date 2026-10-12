import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validLotResponse,lotResponseNote} from "../src/lib/inventory-lot-branch-response.ts";

test("Stage 99: exact response codes, clear 20-1000-character evidence",()=>{
 for(const a of ["NOTICE_RECEIVED","STOCK_ISOLATED","ESCALATED_TO_QUALITY"])assert.equal(validLotResponse(a),true);
 for(const a of ["RELEASE","CONFIRM_CLINICAL_EXPOSURE","__proto__",""] )assert.equal(validLotResponse(a),false);
 assert.equal(lotResponseNote("Containment recorded by local operator"),"Containment recorded by local operator");
 assert.equal(lotResponseNote("not enough"),null);
 assert.equal(lotResponseNote("x".repeat(1001)),null);
 assert.equal(lotResponseNote("Contains unsafe\u0000control"),null);
 assert.equal(lotResponseNote(" Leading whitespace is not allowed"),null);
});
test("Stage 99: current-event lock, branch-only history, status containment and no patient inference",()=>{
 const api=readFileSync("src/app/api/inventory/lot-responses/route.ts","utf8");
 const page=readFileSync("src/app/inventory/lot-impact/[lotId]/page.tsx","utf8");
 const schema=readFileSync("prisma/schema.prisma","utf8");
 const sql=readFileSync("prisma/migrations/20261012230000_inventory_lot_branch_responses/migration.sql","utf8");
 assert.match(api,/permissionSet\(session\).has\("inventory.manage"\)/);
 assert.match(api,/lockLotsForSafety\(tx,org,\[lotId\]\)/);
 assert.match(api,/latest.id!==safetyEventId/);
 assert.match(api,/lot.safety_status/);
 assert.match(api,/branch_not_affected_by_lot/);
 assert.match(api,/tx.userBranchScope.findUnique/);
 assert.match(api,/tx.inventoryLotBranchResponse.create/);
 assert.match(api,/INVENTORY_LOT_BRANCH_RESPONSE_RECORDED/);
 assert.match(api,/isolationLevel:"Serializable"/);
 assert.match(api,/stockReleased:false/);
 assert.match(api,/clinicalExposure:"NOT_DETERMINED"/);
 assert.doesNotMatch(api,/tx\.laboratoryResult\.(update|delete)|tx\.patient\.(update|delete)/);
 assert.match(page,/branchId:activeBranchId/);
 assert.match(page,/safetyEventId:latestSafetyEvent/);
 assert.match(page,/InventoryLotBranchResponse/);
 assert.match(schema,/model InventoryLotBranchResponse \{/);
 assert.match(sql,/UNIQUE INDEX `ilbr_unique_response_action`/);
 assert.match(sql,/ON DELETE RESTRICT/);
});
