import test from "node:test";
import assert from "node:assert/strict";
import { classifyCloudflareImageError } from "../src/cloudflare-errors.js";

test("identifies the daily free Neurons allocation error", () => {
  const result = classifyCloudflareImageError({
    httpStatus: 429,
    payload: {
      errors: [{ code: 3036, message: "You have used up your daily free allocation of 10,000 neurons." }]
    }
  });
  assert.equal(result.code, "3036");
  assert.match(result.message, /daily free allocation पूरी हो गई है/);
  assert.equal(result.retryAfterSeconds, null);
});

test("identifies temporary Workers AI capacity errors separately", () => {
  const result = classifyCloudflareImageError({
    httpStatus: 429,
    payload: { errors: [{ code: 3040, message: "Capacity temporarily exceeded, please try again." }] }
  });
  assert.equal(result.code, "3040");
  assert.match(result.message, /temporary 3040/);
  assert.match(result.message, /बार-बार retry न करें/);
});

test("preserves provider rate-limit text and Retry-After", () => {
  const result = classifyCloudflareImageError({
    httpStatus: 429,
    payload: { errors: [{ code: 2999, message: "Too many requests." }] },
    retryAfterHeader: "12"
  });
  assert.equal(result.code, "2999");
  assert.match(result.message, /Too many requests/);
  assert.equal(result.retryAfterSeconds, 12);
});

test("supports quota text even when the provider changes its internal error code", () => {
  const result = classifyCloudflareImageError({
    httpStatus: 429,
    payload: { errors: [{ code: 9999, message: "You have used up your daily free allocation." }] }
  });
  assert.match(result.message, /daily free allocation पूरी हो गई है/);
});
