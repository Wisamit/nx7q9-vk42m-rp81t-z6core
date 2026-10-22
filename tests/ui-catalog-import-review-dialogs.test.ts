import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read=(p:string)=>readFileSync(p,"utf8");
const modal=read("src/components/review-file-upload-dialog.tsx");

test("review uploads use one-third, accessible dialog and explicit staging confirmation, not implicit file selection",()=>{
  assert.match(modal,/<CrudModal open=\{open\} onClose=\{close\} size="compact"/);
  assert.match(modal,/onStage: \(file: File\) => Promise<boolean>/);
  assert.match(modal,/const \[file, setFile\] = useState<File \| null>\(null\)/);
  assert.match(modal,/onChange=\{event => \{ setFile\(event\.currentTarget\.files\?\.\[0\] \?\? null\)/);
  assert.match(modal,/protectUnsavedChanges title=\{title\}/);
  assert.match(modal,/onResetError: \(\) => void/);
  assert.match(modal,/onResetError\(\)/);
  assert.match(modal,/setSubmissionError\(\"\"\)/);
  assert.match(modal,/catch \{/);
  assert.match(modal,/disabled=\{busy \|\| retryBlocked \|\| !file\} onClick=\{\(\) => void stageSelectedFile\(\)\}/);
  assert.match(modal,/if \(!file \|\| busy \|\| retryBlocked \|\| submitting\.current\) return/);
  assert.match(modal,/if \(busy \|\| submitting\.current\) return/);
  assert.match(modal,/if \(succeeded\) \{/);
  assert.match(modal,/retryBlocked\?: boolean/);
  assert.match(modal,/Re-upload blocked: a batch may already exist/);
  assert.match(modal,/setOpen\(false\)/);
  assert.match(modal,/role="alert"/);
  assert.match(modal,/htmlFor=\{fieldId\}/);
  assert.match(modal,/type="file" accept=\{accept\}/);
  assert.match(modal,/Staging does not approve prices or reference intervals or release clinical results/);
  assert.match(modal,/التجهيز لا يعتمد الأسعار أو الحدود المرجعية/);
  assert.doesNotMatch(modal,/onChange=\{[^}]*onStage\(/);
});

test("all three catalog-source upload actions moved inside the reusable modal",()=>{
  for(const file of [
    "src/components/legacy-import-batches.tsx",
    "src/components/catalog-csv-review-staging.tsx",
    "src/components/catalog-bundle-review-staging.tsx",
  ]){
    const source=read(file);
    assert.match(source,/<ReviewFileUploadDialog/);
    assert.match(source,/onStage=\{stage\}/);
    assert.match(source,/onResetError=\{\(\) => set(?:Error|Message)\(""\)\}/);
    assert.match(source,/Promise<boolean>/);
    assert.match(source,/return true/);
    assert.match(source,/return false/);
    assert.doesNotMatch(source,/\.current\?\.click\(\)/);
    assert.doesNotMatch(source,/onChange=\{[^}]*void stage\(/);
  }
  assert.match(read("src/components/legacy-import-batches.tsx"),/router\.refresh\(\)/);
  assert.match(read("src/components/catalog-csv-review-staging.tsx"),/router\.push\("\/catalog\/imports\/"/);
  assert.match(read("src/components/catalog-bundle-review-staging.tsx"),/body\.reviewOnly !== true/);
  assert.match(read("src/components/catalog-csv-review-staging.tsx"),/2 \* 1024 \* 1024/);
  assert.match(read("src/components/catalog-bundle-review-staging.tsx"),/const MAX_BYTES = 4 \* 1024 \* 1024/);
  assert.match(read("src/components/legacy-import-batches.tsx"),/32\*1024\*1024/);
});

test("modal base still has focus/escape/discard safeguards; compact CSS is RTL-safe and responsive",()=>{
  const base=read("src/components/crud-modal.tsx"),css=read("src/app/globals.css");
  assert.match(base,/aria-modal="true"/);
  assert.match(base,/aria-labelledby=\{headingId\}/);
  assert.match(base,/aria-describedby=\{description \? descriptionId : undefined\}/);
  assert.match(base,/if \(event\.key === "Escape"\)/);
  assert.match(base,/event\.key !== "Tab"/);
  assert.match(base,/previouslyFocused\.focus/);
  assert.match(base,/protectUnsavedChanges/);
  assert.match(css,/\.crud-modal-compact\{width:min\(33\.333vw,520px\)/);
  assert.match(css,/\.crud-modal-body\{[^}]*overflow:auto/);
  assert.match(css,/@media\(max-width:760px\)/);
});

test("existing canonical TypeScript AST inventory covers every route without claiming UI acceptance",()=>{
  const manifest=JSON.parse(read("docs/UI_ROUTE_MANIFEST.json"));
  assert.equal(manifest.schemaVersion,1);
  assert.equal(manifest.expectedRouteCount,81);
  assert.equal(manifest.routes.length,81);
  const routes=new Set<string>();
  for(const entry of manifest.routes as Array<Record<string,unknown>>){
    assert.equal(typeof entry.route,"string");
    assert.equal(typeof entry.file,"string");
    assert.ok((entry.file as string).endsWith("/page.tsx"));
    assert.ok(!routes.has(entry.route as string));
    routes.add(entry.route as string);
  }
  for(const route of ["/catalog","/security","/settings","/specimens",
    "/billing","/worklists","/portal"])assert.ok(
    [...routes].some(item=>item===route||item.startsWith(route+"/")),route);
  const script=read("scripts/ui-route-form-inventory.mjs");
  assert.match(script,/ts\.createSourceFile/);
  assert.match(script,/possibleInlineMutationCount/);
  assert.match(script,/assertManifestMatchesInventory/);
  assert.match(script,/browserReviewStatus: "NOT_EXECUTED"/);
  assert.match(script,/mobileReviewStatus: "NOT_EXECUTED"/);
  assert.match(script,/arEnReviewStatus: "NOT_EXECUTED"/);
  assert.match(script,/roleBranchReviewStatus: "NOT_EXECUTED"/);
  assert.match(read(".github/workflows/ci.yml"),/ui-route-form-inventory\.mjs --markdown/);
});
