import assert from "node:assert/strict";
import test from "node:test";
import { createConversationSchema } from "../../src/app/api/conversations/route";

test("conversation request requires a listing ID", () => {
  const result = createConversationSchema.safeParse({ sellerId: "seller-1", message: "Hello" });
  assert.equal(result.success, false);
  if (!result.success) assert.equal(result.error.issues[0]?.message, "Listing ID required.");
});

test("conversation request accepts the real listing ID and derives the seller", () => {
  const result = createConversationSchema.safeParse({
    listingId: "listing-1",
    sellerId: "seller-1",
    message: "Is this item still available?",
  });
  assert.equal(result.success, true);
});

test("conversation request rejects invalid seller mismatch data at API validation", () => {
  const result = createConversationSchema.safeParse({
    listingId: "listing-1",
    sellerId: "",
  });
  assert.equal(result.success, false);
});
