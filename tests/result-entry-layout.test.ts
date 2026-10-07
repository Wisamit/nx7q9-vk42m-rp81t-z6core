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


test("section presentation metadata is preserved for configured groups", () => {
  const sections = [
    {
      id: "MICRO",
      code: "MICRO",
      nameEn: "Microscopy",
      nameAr: "الفحص المجهري",
      columnCount: 4,
      hintEn: "Enter counts per HPF.",
      hintAr: "أدخل العدد لكل حقل عالي القوة.",
    },
  ];
  const fields = [{ code: "WBC", resultSectionId: "MICRO" }];

  const groups = groupResultFields(fields, sections);
  assert.equal(groups[0].columnCount, 4);
  assert.equal(groups[0].hintEn, "Enter counts per HPF.");
  assert.equal(groups[0].hintAr, "أدخل العدد لكل حقل عالي القوة.");
});

test("ungrouped fields do not inherit another section presentation", () => {
  const sections = [
    {
      id: "CBC",
      code: "CBC",
      nameEn: "CBC",
      nameAr: null,
      columnCount: 4,
      hintEn: "Configured section hint",
      hintAr: null,
    },
  ];
  const fields = [{ code: "OTHER", resultSectionId: null }];

  const groups = groupResultFields(fields, sections);
  assert.equal(groups[0].id, "");
  assert.equal(groups[0].columnCount, 1);
  assert.equal(groups[0].hintEn, null);
});
