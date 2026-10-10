import assert from "node:assert/strict";
import test from "node:test";
import { photoFileTooLargeMessage, photoUploadErrorMessage } from "../../src/lib/client-image";

test("network and timeout failures explain the connection problem and offer retry", () => {
  assert.match(photoUploadErrorMessage({ status: 0, body: null, kind: "network" }), /connection/i);
  assert.match(photoUploadErrorMessage({ status: 0, body: null, kind: "network" }), /retry/i);
  assert.match(photoUploadErrorMessage({ status: 0, body: null, kind: "timeout" }), /took too long/i);
});

test("platform 413 (the Vercel request-body page) maps to a size message", () => {
  const message = photoUploadErrorMessage({ status: 413, body: "<html>FUNCTION_PAYLOAD_TOO_LARGE</html>", kind: "response" });
  assert.match(message, /too large/i);
  assert.match(message, /4MB/);
});

test("expired sessions and rate limits get their own messages", () => {
  assert.match(photoUploadErrorMessage({ status: 401, body: {}, kind: "response" }), /session has expired/i);
  assert.match(photoUploadErrorMessage({ status: 429, body: {}, kind: "response" }), /wait a minute/i);
});

test("server-provided error strings pass through unchanged", () => {
  const body = { error: "Please confirm that you are using a real photo of yourself.", code: "CONSENT_REQUIRED" };
  assert.equal(photoUploadErrorMessage({ status: 400, body, kind: "response" }), body.error);
});

test("unknown server failures never leak internals", () => {
  assert.match(photoUploadErrorMessage({ status: 500, body: { stack: "secret" }, kind: "response" }), /our side/i);
  assert.doesNotMatch(photoUploadErrorMessage({ status: 500, body: { stack: "secret" }, kind: "response" }), /secret/);
  assert.match(photoUploadErrorMessage({ status: 404, body: null, kind: "response" }), /try again/i);
});

test("client size pre-check message names the limit", () => {
  assert.match(photoFileTooLargeMessage(5.6 * 1024 * 1024), /5\.6MB/);
  assert.match(photoFileTooLargeMessage(5.6 * 1024 * 1024), /4MB or smaller/);
});
