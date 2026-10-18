import assert from "node:assert/strict";
import test from "node:test";
import { accountHoldStatusError, shouldRestoreAfterHoldLift } from "../../src/lib/account-lifecycle";

test("only an active account can enter the ordinary hold workflow", () => {
  assert.equal(accountHoldStatusError("ACTIVE"), null);
  assert.match(accountHoldStatusError("SUSPENDED") ?? "", /already suspended/i);
  assert.match(accountHoldStatusError("BANNED") ?? "", /banned/i);
  assert.match(accountHoldStatusError("DEACTIVATED") ?? "", /deleted/i);
});

test("hold lifting restores content only for an eligible account after its final hold", () => {
  assert.equal(shouldRestoreAfterHoldLift("SUSPENDED", 0), true);
  assert.equal(shouldRestoreAfterHoldLift("ACTIVE", 0), true);
  assert.equal(shouldRestoreAfterHoldLift("SUSPENDED", 1), false);
  assert.equal(shouldRestoreAfterHoldLift("BANNED", 0), false);
  assert.equal(shouldRestoreAfterHoldLift("DEACTIVATED", 0), false);
});
