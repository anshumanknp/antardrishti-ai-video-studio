import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

const COOKIE_NAME = "antardrishti_admin";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

function digest(value) {
  return createHash("sha256").update(String(value)).digest();
}

function safeEqual(left, right) {
  return timingSafeEqual(digest(left), digest(right));
}

function header(req, name) {
  if (typeof req.get === "function") return req.get(name) || "";
  return req.headers?.[name.toLowerCase()] || "";
}

function parseCookies(value) {
  const cookies = {};
  for (const part of String(value || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const item = part.slice(separator + 1).trim();
    if (name && !Object.hasOwn(cookies, name)) cookies[name] = item;
  }
  return cookies;
}

function requestOriginAllowed(req) {
  const origin = header(req, "origin");
  const fetchSite = header(req, "sec-fetch-site").toLowerCase();
  if (fetchSite === "cross-site") return false;
  if (!origin) return true;

  try {
    const parsed = new URL(origin);
    const host = header(req, "host").toLowerCase();
    return Boolean(host && parsed.host.toLowerCase() === host);
  } catch {
    return false;
  }
}

function noStore(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}

export function createAuthSecurity({
  adminPassword = "",
  sessionSecret = "",
  required = false,
  secureCookies = false,
  now = () => Date.now()
} = {}) {
  const password = String(adminPassword);
  const secret = String(sessionSecret);
  const configured = password.length >= 12 && secret.length >= 32;
  const authEnabled = configured || Boolean(required);
  const sessions = new Map();
  const loginAttempts = new Map();

  function sign(sessionId) {
    return createHmac("sha256", secret).update(sessionId).digest("base64url");
  }

  function readSession(req) {
    if (!configured) return null;
    const cookie = parseCookies(header(req, "cookie"))[COOKIE_NAME];
    if (!cookie) return null;
    const separator = cookie.lastIndexOf(".");
    if (separator < 1) return null;
    const sessionId = cookie.slice(0, separator);
    const signature = cookie.slice(separator + 1);
    if (!safeEqual(signature, sign(sessionId))) return null;

    const session = sessions.get(sessionId);
    if (!session) return null;
    if (session.expiresAt <= now()) {
      sessions.delete(sessionId);
      return null;
    }
    return { id: sessionId, ...session };
  }

  function setSessionCookie(res, sessionId) {
    const attributes = [
      COOKIE_NAME + "=" + sessionId + "." + sign(sessionId),
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      "Max-Age=" + Math.floor(SESSION_TTL_MS / 1000)
    ];
    if (secureCookies) attributes.push("Secure");
    res.setHeader("Set-Cookie", attributes.join("; "));
  }

  function clearSessionCookie(res) {
    const attributes = [
      COOKIE_NAME + "=",
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      "Max-Age=0"
    ];
    if (secureCookies) attributes.push("Secure");
    res.setHeader("Set-Cookie", attributes.join("; "));
  }

  function rejectUnconfigured(res) {
    return res.status(503).json({
      ok: false,
      error: "Admin login configure नहीं है। ADMIN_PASSWORD और कम-से-कम 32 characters का ADMIN_SESSION_SECRET सेट करें।"
    });
  }

  function sendSessionStatus(req, res) {
    noStore(res);
    const session = readSession(req);
    res.json({
      ok: true,
      authEnabled,
      authRequired: Boolean(required),
      configured,
      authenticated: Boolean(session),
      csrfToken: session?.csrfToken || null,
      sessionExpiresAt: session ? new Date(session.expiresAt).toISOString() : null
    });
  }

  function login(req, res) {
    noStore(res);
    if (!requestOriginAllowed(req)) {
      return res.status(403).json({ ok: false, error: "Cross-origin login request अस्वीकार की गई।" });
    }
    if (!configured) return rejectUnconfigured(res);

    const ip = String(req.ip || req.socket?.remoteAddress || "unknown");
    const timestamp = now();
    const recent = (loginAttempts.get(ip) || []).filter(value => timestamp - value < LOGIN_WINDOW_MS);
    if (recent.length >= MAX_LOGIN_ATTEMPTS) {
      loginAttempts.set(ip, recent);
      res.setHeader("Retry-After", String(Math.ceil((LOGIN_WINDOW_MS - (timestamp - recent[0])) / 1000)));
      return res.status(429).json({ ok: false, error: "बहुत अधिक login प्रयास हुए हैं। 15 मिनट बाद फिर कोशिश करें।" });
    }
    recent.push(timestamp);
    loginAttempts.set(ip, recent);

    const supplied = typeof req.body?.password === "string" ? req.body.password.slice(0, 1024) : "";
    if (!safeEqual(supplied, password)) {
      return res.status(401).json({ ok: false, error: "Admin password सही नहीं है।" });
    }

    loginAttempts.delete(ip);
    const sessionId = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const createdAt = timestamp;
    sessions.set(sessionId, { csrfToken, createdAt, expiresAt: timestamp + SESSION_TTL_MS });

    if (sessions.size > 500) {
      for (const [id, session] of sessions) {
        if (session.expiresAt <= timestamp || sessions.size > 450) sessions.delete(id);
      }
    }

    setSessionCookie(res, sessionId);
    return res.json({
      ok: true,
      authenticated: true,
      csrfToken,
      sessionExpiresAt: new Date(timestamp + SESSION_TTL_MS).toISOString()
    });
  }

  function logout(req, res) {
    noStore(res);
    if (!requestOriginAllowed(req)) {
      return res.status(403).json({ ok: false, error: "Cross-origin logout request अस्वीकार की गई।" });
    }
    const session = readSession(req);
    if (session && !safeEqual(header(req, "x-csrf-token"), session.csrfToken)) {
      return res.status(403).json({ ok: false, error: "CSRF token सही नहीं है।" });
    }
    if (session) sessions.delete(session.id);
    clearSessionCookie(res);
    return res.json({ ok: true, authenticated: false });
  }

  function authorize(req, res, { checkCsrf = false } = {}) {
    if (required && !configured) return rejectUnconfigured(res);
    if (!authEnabled) return null;

    const session = readSession(req);
    if (!session) {
      return res.status(401).json({ ok: false, error: "Admin login आवश्यक है।" });
    }

    if (checkCsrf) {
      if (!requestOriginAllowed(req)) {
        return res.status(403).json({ ok: false, error: "Cross-origin request अस्वीकार की गई।" });
      }
      if (!safeEqual(header(req, "x-csrf-token"), session.csrfToken)) {
        return res.status(403).json({ ok: false, error: "CSRF token missing या invalid है।" });
      }
    }
    return null;
  }

  function apiMiddleware(req, res, next) {
    if (req.path === "/health") return next();
    const isReadOnly = req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS";
    const rejected = authorize(req, res, { checkCsrf: !isReadOnly });
    if (rejected) return rejected;
    return next();
  }

  function outputsMiddleware(req, res, next) {
    const rejected = authorize(req, res);
    if (rejected) return rejected;
    if (req.method !== "GET" && req.method !== "HEAD") {
      return res.status(405).json({ ok: false, error: "Output files are read-only." });
    }
    return next();
  }

  return {
    apiMiddleware,
    outputsMiddleware,
    sessionStatus: sendSessionStatus,
    login,
    logout,
    get configured() { return configured; },
    get authEnabled() { return authEnabled; }
  };
}
