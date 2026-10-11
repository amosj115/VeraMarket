import assert from "node:assert/strict";
import test from "node:test";
import type { ZodError } from "zod";
import {
  REGISTER_LIMITS,
  registerErrorMessage,
  registerSchema,
} from "../../src/lib/validation/auth";

function parse(input: unknown) {
  return registerSchema.safeParse(input);
}

function messageFor(input: unknown): string {
  const result = parse(input);
  assert.equal(result.success, false, `expected a validation failure for ${JSON.stringify(input)}`);
  return registerErrorMessage((result as { error: ZodError }).error);
}

const validUser = {
  displayName: "Test Person",
  username: "test_person_1",
  email: "test.person@example.test",
  password: "Passw0rdTest1",
};

test("a normal valid registration with a 16-character password is accepted", () => {
  const result = parse({ ...validUser, password: "Passw0rdTest1Abcd" }); // 16 chars
  assert.equal(result.success, true);
});

test("a username at the full 30-character maximum is accepted", () => {
  const result = parse({ ...validUser, username: "u".repeat(30) });
  assert.equal(result.success, true);
});

test("a long but valid email address is accepted", () => {
  const longEmail = `${"a".repeat(50)}+tag@subdomain.example.test`;
  assert.ok(longEmail.length <= REGISTER_LIMITS.email);
  const result = parse({ ...validUser, email: longEmail });
  assert.equal(result.success, true);
});

test("a password longer than 16 characters is accepted", () => {
  const result = parse({ ...validUser, password: "Str0ngPassphraseHere" }); // 21 chars, ASCII
  assert.equal(result.success, true);
});

test("a username that is too short is rejected with a friendly message", () => {
  const message = messageFor({ ...validUser, username: "ab" });
  assert.match(message, /Username must be between 3 and 30 characters/);
});

test("a username over 30 characters is rejected with a friendly message, never raw Zod text", () => {
  const message = messageFor({ ...validUser, username: "a".repeat(31) });
  assert.match(message, /Username must be between 3 and 30 characters/);
  assert.doesNotMatch(message, /Too big|expected string/i);
});

test("an invalid email address is rejected with a friendly message", () => {
  const message = messageFor({ ...validUser, email: "not-an-email" });
  assert.match(message, /valid email address/i);
  assert.doesNotMatch(message, /invalid_format|expected/i);
});

test("an empty password is rejected with a friendly message", () => {
  const message = messageFor({ ...validUser, password: "" });
  assert.match(message, /at least 8 characters/);
});

test("a password over the 72-character maximum is rejected", () => {
  const message = messageFor({ ...validUser, password: `Aa1${"x".repeat(72)}` });
  assert.match(message, /72 characters or fewer/);
});

test("a password over 72 UTF-8 bytes is rejected even within 72 characters (bcrypt limit)", () => {
  // 30 emoji = 30 chars but 120 bytes — bcrypt would silently truncate it.
  const emojiPassword = `Aa1${"😀".repeat(30)}`;
  assert.ok(emojiPassword.length <= REGISTER_LIMITS.passwordBytes);
  const message = messageFor({ ...validUser, password: emojiPassword });
  assert.match(message, /72 bytes or fewer/);
});

test("a username with invalid characters is rejected with a clear message", () => {
  const message = messageFor({ ...validUser, username: "has spaces!" });
  assert.match(message, /lowercase letters, numbers and underscores/);
});

test("a missing field is reported as required, not as a library error", () => {
  const withoutPassword: Record<string, unknown> = { ...validUser };
  delete withoutPassword.password;
  const message = messageFor(withoutPassword);
  assert.equal(message, "Password is required.");
  const message2 = messageFor({ ...validUser, username: undefined });
  assert.equal(message2, "Username is required.");
});

test("no validation message ever exposes raw library internals", () => {
  const cases = [
    { ...validUser, username: "a".repeat(31) },
    { ...validUser, username: "ab" },
    { ...validUser, email: "bad" },
    { ...validUser, password: "" },
    { ...validUser, password: `Aa1${"x".repeat(72)}` },
    { ...validUser, displayName: "x" },
    { ...validUser, email: undefined },
  ];
  for (const input of cases) {
    const message = messageFor(input);
    assert.doesNotMatch(message, /Too big|Too small|expected string|invalid_type|invalid_format|ZodError/i, `message leaked internals: ${message}`);
  }
});

test("duplicate-account protection inputs still parse (route handles uniqueness)", () => {
  // The schema itself is shape-only; duplicates are checked in the API route.
  // This asserts parsing succeeds so the route reaches its uniqueness check.
  assert.equal(parse(validUser).success, true);
});

test("form constraints mirror the schema limits", () => {
  assert.equal(REGISTER_LIMITS.username, 30);
  assert.equal(REGISTER_LIMITS.usernameMin, 3);
  assert.equal(REGISTER_LIMITS.displayName, 60);
  assert.equal(REGISTER_LIMITS.email, 254);
  assert.equal(REGISTER_LIMITS.passwordMin, 8);
  assert.equal(REGISTER_LIMITS.passwordBytes, 72);
  const usernameIssue = parse({ ...validUser, username: "a".repeat(31) });
  assert.equal(usernameIssue.success, false);
});
