import assert from "node:assert/strict";
import test from "node:test";
import { escCsv } from "./reporting.service.js";

test("CSV export neutralizes spreadsheet formula prefixes", () => {
  assert.equal(escCsv("=1+1"), "'=1+1");
  assert.equal(escCsv("+SUM(1,2)"), "\"'+SUM(1,2)\"");
  assert.equal(escCsv("@malicious"), "'@malicious");
  assert.equal(escCsv("-CMD"), "'-CMD");
});

test("CSV export still escapes commas, quotes and newlines", () => {
  assert.equal(escCsv('A,"B"'), '"A,""B"""');
  assert.equal(escCsv("line1\nline2"), '"line1\nline2"');
  assert.equal(escCsv("Phòng 101"), "Phòng 101");
});
