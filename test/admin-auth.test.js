import test from "node:test";
import assert from "node:assert/strict";
import {
  createAdminPasswordHash,
  isValidAdminPasswordHash,
  verifyAdminPassword,
  createAdminSessionToken,
  verifyAdminSessionToken,
  ADMIN_SESSION_TTL_MS
} from "../src/admin-auth.js";

test("creates and verifies a salted admin password hash", () => {
  const hash = createAdminPasswordHash("a-long-private-password");
  assert.ok(isValidAdminPasswordHash(hash));
  assert.equal(verifyAdminPassword("a-long-private-password", hash), true);
  assert.equal(verifyAdminPassword("wrong-password", hash), false);
  assert.throws(() => createAdminPasswordHash("short"), /12 characters/);
});

test("signs expiring admin sessions and rejects tampering", () => {
  const now = 1_800_000_000_000;
  const secret = "a-strong-random-secret-for-unit-tests";
  const token = createAdminSessionToken(secret, now);
  assert.equal(verifyAdminSessionToken(token, secret, now + 1000), true);
  assert.equal(verifyAdminSessionToken(token, "different-secret", now + 1000), false);
  assert.equal(verifyAdminSessionToken(token + "x", secret, now + 1000), false);
  assert.equal(verifyAdminSessionToken(token, secret, now + ADMIN_SESSION_TTL_MS + 1), false);
});
