import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const src=readFileSync("src/components/result-entry-form.tsx","utf8");
const save=src.slice(src.indexOf("  async function save("),src.indexOf("  async function verify()"));
const verify=src.slice(src.indexOf("  async function verify()"),src.indexOf("  const statusLocked"));

test("F5: ambiguous result POST must not claim clinical save and must block duplicate submission",()=>{
  assert.match(save,/saveUncertainRef\.current\) return/);
  assert.match(save,/response = await fetch\("\/api\/results"/);
  assert.match(save,/catch \{[\s\S]*?saveUncertainRef\.current = true;/);
  assert.match(save,/setSaveUncertain\(true\);/);
  assert.match(save,/Do not submit again/);
  assert.match(save,/لا تعِد الإرسال/);
  assert.match(save,/setBusy\(""\);/);
});

test("F5: malformed successful server response is not enough to present a save as completed",()=>{
  assert.match(save,/response\.json\(\)\.catch\(\(\) => null\)/);
  assert.match(save,/response\.ok && \(!body \|\| typeof body !== "object"/);
  assert.match(save,/typeof body\.result\.id !== "string"/);
  assert.match(save,/typeof body\.result\.status !== "string"/);
  assert.match(save,/typeof body\.complete !== "boolean"/);
  assert.match(save,/const receipt = body && typeof body === "object" \? body : \{\}/);
  assert.ok(save.indexOf("if (response.ok &&")<save.indexOf("if (response.ok) {"));
});

test("F5: ambiguous server outcome gates both save and technical review until page reload",()=>{
  assert.match(src,/const saveUncertainRef = useRef\(false\)/);
  assert.match(src,/const \[saveUncertain, setSaveUncertain\] = useState\(false\)/);
  assert.match(verify,/saveUncertainRef\.current\) return;/);
  assert.match(src,/disabled=\{busy !== "" \|\| saveUncertain\}/);
  assert.match(src,/Saving and technical review are blocked in this session/);
  assert.match(src,/form-warning" role="alert"/);
});
