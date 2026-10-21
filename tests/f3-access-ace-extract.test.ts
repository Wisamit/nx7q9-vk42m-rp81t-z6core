import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {LEGACY_COVERAGE_SOURCES} from "../src/lib/legacy-source-coverage.ts";

test("F3: Windows Access extractor is explicitly read-only and bounded",()=>{
  const source=readFileSync("scripts/f3-access-ace-extract.ps1","utf8");
  assert.match(source,/ADODB\.Connection/);
  assert.match(source,/ADODB\.Recordset/);
  assert.match(source,/Mode = 1/);
  assert.match(source,/Mode=Read/);
  assert.match(source,/\$records\.Open\(\$query, \$connection, 0, 1\)/);
  assert.match(source,/\$query = 'SELECT '/);
  assert.match(source,/Get-FileHash -LiteralPath \$source -Algorithm SHA256/);
  assert.match(source,/\$postReadSha = \(Get-FileHash -LiteralPath \$source -Algorithm SHA256\)/);
  assert.match(source,/f3_access_source_changed_during_read/);
  assert.match(source,/sourceIdentityExternallyAttested=\$false/);
  assert.match(source,/migrated=\$false/);
  assert.match(source,/row_limit|extraction_row_limit/);
  assert.match(source,/\$total -gt 20000/);
  assert.match(source,/\$columns\.Count -gt 150/);
  const ts=readFileSync("src/lib/f3-legacy-extraction-manifest.ts","utf8");
  const shellList=source.match(/\$Blocked = @\(([^\n]*)\)/)?.[1];
  const codeList=ts.match(/const FORBIDDEN=new Set\(\[([\s\S]*?)\]\);/)?.[1];
  assert.ok(shellList&&codeList);
  const shellBlocked=[...shellList.matchAll(/'([^']+)'/g)].map(x=>x[1]).sort();
  const codeBlocked=[...codeList.matchAll(/"([^"]+)"/g)].map(x=>x[1]).sort();
  assert.deepEqual(shellBlocked,codeBlocked,
    "offline ACE and Node row manifest must block exactly the same legacy result tables");
  const listed=source.match(/\$Allowed = @\(([^\n]*)\)/)?.[1];
  assert.ok(listed);
  const shellAllowed=[...listed.matchAll(/'([^']+)'/g)].map(x=>x[1]).sort();
  assert.deepEqual(shellAllowed,LEGACY_COVERAGE_SOURCES.map(x=>x.tableName).sort(),
    "ACE query table allowlist must track all and only the 15 catalog source tables");
  assert.match(source,/\$Allowed -cnotcontains \$name/);
  assert.match(source,/f3_access_unlisted_configuration_table/);
  for(const name of ["password","id","result","culture","cbc","urine",
    "thyroid","torch","fertility","widal","zn"])
    assert.ok(shellBlocked.includes(name));
  assert.match(source,/SELECT.*\$selected -join/);
  assert.match(source,/\.Trim\(\) -ne \$value/);
  assert.match(source,/Test-Path -LiteralPath \$out/);
  assert.doesNotMatch(source,/\$connection\.Execute\(/i);
  assert.doesNotMatch(source,/\$records\.Update\(/i);
  assert.doesNotMatch(source,/\b(?:INSERT INTO|DELETE FROM|UPDATE\s+[a-z0-9_]+\s+SET)\b/i);
});

test("F3: native temporal and numeric source text is preserved without guessing UTC or money rounding",()=>{
  const source=readFileSync("scripts/f3-access-ace-extract.ps1","utf8");
  assert.match(source,/timezone-naive dates/);
  assert.match(source,/yyyy-MM-ddTHH:mm:ss\.fff/);
  assert.doesNotMatch(source,/ToUniversalTime\(/);
  assert.match(source,/System\.Globalization\.CultureInfo\]::InvariantCulture/);
  assert.match(source,/sourceFileBytesHashedLocally=\$true/);
  assert.match(source,/f3_access_binary_requires_separate_policy/);
});
