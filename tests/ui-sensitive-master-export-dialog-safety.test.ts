import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("UI #265: authorized sensitive master data export requires an explicit privacy review dialog",()=>{
 const ui=readFileSync("src/components/legacy-master-configuration-export.tsx","utf8");
 assert.ok(ui.includes('import { CrudModal } from "@/components/crud-modal";'));
 assert.ok(ui.includes("open={confirmOpen}"));
 assert.ok(ui.includes('size="compact"'));
 assert.ok(ui.includes('setConfirmOpen(true)'));
 assert.ok(ui.includes('setConfirmOpen(false)'));
 assert.ok(ui.includes("tr(labels[kind][0],labels[kind][1])"));
 assert.ok(ui.includes('client')||ui.includes('clients'));
 assert.ok(ui.includes("business contact details"));
 assert.ok(ui.includes('onClick={()=>void exportMaster()}'));
 assert.doesNotMatch(ui,/\bconfirm\s*\(/);
 assert.ok(ui.includes("cache:\"no-store\""));
 assert.ok(ui.includes('method:"GET"'));
 assert.ok(ui.includes("archive.integritySha256"));
 assert.ok(ui.includes("download(part.csv"));
});
