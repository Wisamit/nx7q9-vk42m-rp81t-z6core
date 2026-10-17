import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { acquireCrudModalScrollLock } from "../src/lib/crud-modal-scroll-lock.ts";

test("two stacked dialogs keep scrolling locked until the final release, in either order", () => {
  const fakeBody = {style:{overflow:"auto"}};
  const releaseOuter = acquireCrudModalScrollLock(fakeBody);
  const releaseInner = acquireCrudModalScrollLock(fakeBody);
  assert.equal(fakeBody.style.overflow,"hidden");
  releaseOuter();
  assert.equal(fakeBody.style.overflow,"hidden",
    "closing the underlying dialog cannot unlock the remaining overlay");
  releaseInner();
  assert.equal(fakeBody.style.overflow,"auto");
  const first = acquireCrudModalScrollLock(fakeBody);
  const second = acquireCrudModalScrollLock(fakeBody);
  second();
  assert.equal(fakeBody.style.overflow,"hidden");
  first();
  assert.equal(fakeBody.style.overflow,"auto");
});

test("modal scroll lock supports nested reuse, empty inline values and idempotent effect cleanup", () => {
  const fakeBody={style:{overflow:""}};
  const one=acquireCrudModalScrollLock(fakeBody);
  const two=acquireCrudModalScrollLock(fakeBody);
  two();two();
  assert.equal(fakeBody.style.overflow,"hidden");
  one();one();
  assert.equal(fakeBody.style.overflow,"");
  const unrelated={style:{overflow:"scroll"}};
  const release=acquireCrudModalScrollLock(unrelated);
  assert.equal(unrelated.style.overflow,"hidden");
  assert.equal(fakeBody.style.overflow,"");
  release();
  assert.equal(unrelated.style.overflow,"scroll");
});

test("global modal overlay portals outside stacking contexts and traps keyboard and programmatic focus",()=>{
  const s=readFileSync("src/components/crud-modal.tsx","utf8");
  assert.match(s,/import \{ createPortal \} from "react-dom"/);
  assert.match(s,/setPortalRoot\(document\.body\)/);
  assert.match(s,/return createPortal\(<div className="crud-modal-backdrop"/);
  assert.match(s,/acquireCrudModalScrollLock\(document\.body\)/);
  assert.match(s,/unlockBody\(\)/);
  assert.match(s,/document\.addEventListener\("keydown", onKey, true\)/);
  assert.match(s,/document\.addEventListener\("focusin", onFocusIn, true\)/);
  assert.match(s,/document\.removeEventListener\("focusin", onFocusIn, true\)/);
  assert.match(s,/const dialogs = document\.querySelectorAll<HTMLElement>/);
  assert.match(s,/dialogs\[dialogs\.length - 1\] !== dialog/);
  assert.match(s,/const trap = discardOpenRef\.current \? discardRef\.current : dialog/);
  assert.match(s,/trap\.contains\(event\.target\)/);
  assert.match(s,/previouslyFocused\.focus\(\{ preventScroll: true \}\)/);
  assert.match(s,/requestAnimationFrame\(\(\) => \{/);
  assert.match(s,/if \(event\.key === "Escape"\)/);
  assert.match(s,/event\.key !== "Tab"/);
  assert.match(s,/if \(!portalRoot\) return null/);
});

test("new modals are compact by default, nested edits never dirty underlying form",()=>{
  const s=readFileSync("src/components/crud-modal.tsx","utf8");
  const css=readFileSync("src/app/globals.css","utf8");
  assert.match(s,/size = "compact"/);
  assert.match(s,/target\.closest\("\[data-crud-modal='true'\]"\) === dialogRef\.current/g);
  assert.match(s,/!target\.closest\("\[data-modal-ui-only\]"\)/g);
  assert.match(s,/aria-hidden=\{discardOpen \? true : undefined\}/g);
  assert.match(s,/role="alertdialog"/);
  assert.match(s,/aria-modal="true"/);
  assert.match(s,/protectUnsavedChanges = true/);
  assert.match(css,/\.crud-modal-compact\{width:min\(33\.333vw,520px\);min-width:0\}/);
  assert.match(css,/\.crud-modal-body\{padding:20px;overflow:auto/);
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(css,/\.crud-modal-full,\.crud-modal-compact\{width:100%;height:100%/);
});

test("client UI release gate remains open: passing static policy never counts as browser UAT",()=>{
  const inventory=readFileSync("scripts/ui-browser-acceptance.mjs","utf8");
  assert.match(inventory,/ISOLATED_SYNTHETIC_ONLY/);
  assert.match(inventory,/CAPTURED_UNREVIEWED/);
  assert.match(inventory,/NOT_SIGNED_OFF/);
  const routeInventory=readFileSync("tests/ux-route-form-inventory.test.ts","utf8");
  assert.match(routeInventory,/NOT_EXECUTED/);
});
