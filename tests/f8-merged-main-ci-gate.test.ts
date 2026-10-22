import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("F8: completed PR can trigger independent exact-merge main validation",()=>{
  const workflow=readFileSync(".github/workflows/ci.yml","utf8");
  assert.match(workflow, /pull_request:\s*\n\s*branches: \[main\]\s*\n\s*#[^\n]*\n\s*types: \[opened, synchronize, reopened, closed\]/);
  assert.match(workflow, /event\.action != 'closed' \|\| github\.event\.pull_request\.merged == true/);
  assert.match(workflow, /pull_request\.merge_commit_sha \|\| github\.sha/);
  assert.match(workflow, /name: Verify exact merged main revision/);
  assert.match(workflow, /EXPECTED_MERGE_SHA:/);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$EXPECTED_MERGE_SHA"/);
  assert.match(workflow, /test "\$\{\{ github\.event\.pull_request\.base\.ref \}\}" = "main"/);
  assert.match(workflow, /Verify concurrent portal booking idempotency in MariaDB/);
  assert.match(workflow, /run: npm run test:safety/);
  assert.match(workflow, /run: npx next build/);
});
