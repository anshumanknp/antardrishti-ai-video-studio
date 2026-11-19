import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from "node:crypto";

export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function createAdminPasswordHash(password) {
  const value = String(password || "");
  if (value.length < 12) throw new Error("Admin password कम-से-कम 12 characters का होना चाहिए।");
  const salt = randomBytes(16);
  const derived = scryptSync(value, salt, 64);
  return "scrypt$" + salt.toString("base64url") + "$" + derived.toString("base64url");
}

export function isValidAdminPasswordHash(encoded) {
  const parts = String(encoded || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "base64url");
    const key = Buffer.from(parts[2], "base64url");
    return salt.length >= 16 && key.length === 64;
  } catch {
    return false;
  }
}

export function verifyAdminPassword(password, encoded) {
  if (!isValidAdminPasswordHash(encoded)) return false;
  const [, saltText, keyText] = String(encoded).split("$");
  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(keyText, "base64url");
  const actual = scryptSync(String(password || ""), salt, expected.length);
  return timingSafeEqual(actual, expected);
}

export function createAdminSessionToken(secret, now = Date.now()) {
  const expiresAt = now + ADMIN_SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({
    exp: expiresAt,
    nonce: randomBytes(18).toString("base64url")
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return payload + "." + signature;
}

export function verifyAdminSessionToken(token, secret, now = Date.now()) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const expected = createHmac("sha256", secret).update(parts[0]).digest();
  let actual;
  try {
    actual = Buffer.from(parts[1], "base64url");
  } catch {
    return false;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    return Number.isFinite(payload.exp) && payload.exp > now &&
      payload.exp <= now + ADMIN_SESSION_TTL_MS + 60_000 &&
      typeof payload.nonce === "string" && payload.nonce.length >= 16;
  } catch {
    return false;
  }
}
