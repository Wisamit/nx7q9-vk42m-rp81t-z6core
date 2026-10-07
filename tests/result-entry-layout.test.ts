import test from "node:test";
import assert from "node:assert/strict";
import { groupResultFields } from "../src/lib/result-entry-layout.ts";

test("result fields follow configured section order", () => {
  const sections = [
    { id: "S1", code: "PRIMARY", nameEn: "Primary", nameAr: null },
    { id: "S2", code: "SECONDARY", nameEn: "Secondary", nameAr: null },
  ];
  const fields = [
    { code: "A", resultSectionId: "S2" },
    { code: "B", resultSectionId: "S1" },
    { code: "C", resultSectionId: "S1" },
  ];

  const groups = groupResultFields(fields, sections);
  assert.deepEqual(groups.map(group => [group.code, group.fields.map(field => field.code)]), [
    ["PRIMARY", ["B", "C"]],
    ["SECONDARY", ["A"]],
  ]);
});

test("unassigned and inactive-section fields remain visible", () => {
  const sections = [
    { id: "ACTIVE", code: "ACTIVE", nameEn: "Active", nameAr: null },
  ];
  const fields = [
    { code: "A", resultSectionId: "ACTIVE" },
    { code: "B", resultSectionId: null },
    { code: "C", resultSectionId: "INACTIVE" },
  ];

  const groups = groupResultFields(fields, sections);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].code, "ACTIVE");
  assert.deepEqual(groups[1].fields.map(field => field.code), ["B", "C"]);
});

test("empty configured sections are omitted from result entry", () => {
  const sections = [
    { id: "EMPTY", code: "EMPTY", nameEn: "Empty", nameAr: null },
  ];
  const fields = [{ code: "A", resultSectionId: null }];

  const groups = groupResultFields(fields, sections);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, "");
  assert.deepEqual(groups[0].fields.map(field => field.code), ["A"]);
});
