import assert from "node:assert/strict";
import test from "node:test";
import { encodeTrendingCursor, parseTrendingCursor } from "../../src/lib/trending-cursor";

test("Trending cursors round-trip listing timestamps and ids", () => {
  const cursor = { createdAt: new Date("2026-04-15T12:34:56.789Z"), id: "cm123abc_456" };
  const parsed = parseTrendingCursor(encodeTrendingCursor(cursor));

  assert.deepEqual(parsed, cursor);
});

test("Trending cursor parsing rejects malformed values", () => {
  for (const value of ["", "|listing", "123|", "not-a-time|listing", "9999999999999999|listing", "123|bad/id", "1|" + "a".repeat(65)]) {
    assert.equal(parseTrendingCursor(value), null, `expected ${value} to be rejected`);
  }
});
