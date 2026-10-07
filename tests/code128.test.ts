import test from "node:test";
import assert from "node:assert/strict";
import { code128BBars, code128BSymbols, specimenLabelPrintError, specimenLabelSize } from "../src/lib/code128.ts";

test("Code 128 B encodes printable specimen barcodes with the standard checksum", () => {
  assert.deepEqual(code128BSymbols("ABC"), [104, 33, 34, 35, 1, 106]);
  assert.deepEqual(code128BSymbols("123"), [104, 17, 18, 19, 8, 106]);
  assert.equal(code128BSymbols(""), null);
  assert.equal(code128BSymbols("ABC\n"), null);
});

test("Code 128 B bar geometry keeps quiet zones around the encoded symbol", () => {
  const encoded = code128BBars("ACC-2026-01", 10);
  assert.ok(encoded);
  assert.equal(encoded.symbols.at(-1), 106);
  assert.equal(encoded.bars[0].x, 10);
  assert.ok(encoded.widthModules > encoded.bars.at(-1)!.x + encoded.bars.at(-1)!.width);
  assert.equal(code128BBars("ABC", -1), null);
});

test("specimen labels only accept supported printer presets", () => {
  assert.equal(specimenLabelSize("50x30"), "50x30");
  assert.equal(specimenLabelSize("50x25"), "50x25");
  assert.equal(specimenLabelSize("40x25"), "40x25");
  assert.equal(specimenLabelSize("unknown"), "50x30");
  assert.equal(specimenLabelSize(null), "50x30");
});


test("planned labels require finalized requirements and reprints require a reason", () => {
  assert.equal(specimenLabelPrintError({
    status: "PLANNED", requirementsFinalized: false, priorPrintCount: 0, reason: "",
  }), "specimen_requirements_not_finalized");
  assert.equal(specimenLabelPrintError({
    status: "PLANNED", requirementsFinalized: true, priorPrintCount: 0, reason: "",
  }), null);
  assert.equal(specimenLabelPrintError({
    status: "COLLECTED", requirementsFinalized: true, priorPrintCount: 1, reason: "",
  }), "reprint_reason_required");
  assert.equal(specimenLabelPrintError({
    status: "COLLECTED", requirementsFinalized: true, priorPrintCount: 1, reason: "Damaged label",
  }), null);
});
