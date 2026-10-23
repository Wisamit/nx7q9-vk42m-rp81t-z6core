import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("F7 rate limiting: no non-atomic read-then-reset across the rate window boundary",()=>{
  const src=readFileSync("src/lib/rate-limit.ts","utf8");
  assert.match(src,/prisma\.\$transaction\(async tx => \{/);
  assert.match(src,/INSERT INTO request_rate_limits/);
  assert.match(src,/ON DUPLICATE KEY UPDATE/);
  assert.match(src,/count=IF\(window_start</);
  assert.match(src,/window_start=GREATEST\(window_start,/);
  assert.match(src,/SELECT count,window_start AS windowStart/);
  assert.match(src,/FOR UPDATE/);
  assert.match(src,/isolationLevel: "ReadCommitted"/);
  assert.match(src,/allowed: claimed\.count <= input\.limit/);
  assert.match(src,/remaining: Math\.max\(0, input\.limit - claimed\.count\)/);
  assert.ok(src.indexOf("ON DUPLICATE KEY UPDATE")<src.indexOf("SELECT count,window_start"),
    "read under the same transaction AFTER the atomic increment");
  assert.doesNotMatch(src,/findUnique\(/);
  assert.doesNotMatch(src,/count: \{ increment: 1 \}/,
    "do not resume unconditional read-based rollover logic");
});

test("F7 rate limiting: production CI uses a real two-connection MariaDB regression",()=>{
  const workflow=readFileSync(".github/workflows/ci.yml","utf8");
  assert.match(workflow,/Verify atomic rate limit rollover in MariaDB/);
  assert.match(workflow,/tests\/f7-rate-limit-atomic-mariadb\.integration\.test\.ts/);
  assert.match(workflow,/Verify OTP live principal revocation in MariaDB/,
    "previous live-subject OTP test must remain mandatory");
});
