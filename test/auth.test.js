import test from "node:test";
import assert from "node:assert/strict";
import { createAuthSecurity } from "../src/auth.js";

const PASSWORD = "a long admin password for tests";
const SECRET = "0123456789abcdef0123456789abcdef-secret";

function request({ method = "GET", path = "/", cookie = "", csrf = "", origin = "", fetchSite = "same-origin", ip = "127.0.0.1" } = {}) {
  const headers = {
    host: "studio.example.test",
    ...(cookie ? { cookie } : {}),
    ...(csrf ? { "x-csrf-token": csrf } : {}),
    ...(origin ? { origin } : {}),
    ...(fetchSite ? { "sec-fetch-site": fetchSite } : {})
  };
  return {
    method,
    path,
    ip,
    headers,
    socket: { remoteAddress: ip },
    get(name) { return headers[String(name).toLowerCase()] || ""; }
  };
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

function call(handler, req) {
  const res = response();
  let nextCalled = false;
  handler(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

function login(auth, password = PASSWORD) {
  const req = request({ method: "POST", path: "/api/auth/login", origin: "https://studio.example.test" });
  req.body = { password };
  const res = response();
  auth.login(req, res);
  const cookie = String(res.headers["set-cookie"] || "").match(/^([^;]+)/)?.[1] || "";
  return { req, res, cookie, csrf: res.body?.csrfToken };
}

test("local development without credentials keeps API available", () => {
  const auth = createAuthSecurity();
  assert.equal(auth.authEnabled, false);
  const result = call(auth.apiMiddleware, request({ path: "/jobs" }));
  assert.equal(result.nextCalled, true);
});

test("production fails closed when admin credentials are missing", () => {
  const auth = createAuthSecurity({ required: true });
  const session = response();
  auth.sessionStatus(request({ path: "/api/auth/session" }), session);
  assert.equal(session.body.configured, false);
  assert.equal(session.body.authRequired, true);
  assert.equal(call(auth.apiMiddleware, request({ path: "/jobs" })).res.statusCode, 503);
  assert.equal(call(auth.outputsMiddleware, request({ path: "/video.mp4" })).res.statusCode, 503);
});

test("successful login issues an HttpOnly SameSite cookie and CSRF token", () => {
  const auth = createAuthSecurity({ adminPassword: PASSWORD, sessionSecret: SECRET });
  const result = login(auth);
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.res.body.authenticated, true);
  assert.ok(result.cookie.startsWith("antardrishti_admin="));
  assert.match(result.res.headers["set-cookie"], /HttpOnly/);
  assert.match(result.res.headers["set-cookie"], /SameSite=Strict/);
  assert.ok(result.csrf.length > 20);
});

test("authenticated reads pass but state-changing APIs require a CSRF token", () => {
  const auth = createAuthSecurity({ adminPassword: PASSWORD, sessionSecret: SECRET });
  const loggedIn = login(auth);
  assert.equal(call(auth.apiMiddleware, request({ path: "/jobs", cookie: loggedIn.cookie })).nextCalled, true);
  assert.equal(call(auth.apiMiddleware, request({ method: "POST", path: "/jobs", cookie: loggedIn.cookie })).res.statusCode, 403);
  assert.equal(call(auth.apiMiddleware, request({
    method: "POST", path: "/jobs", cookie: loggedIn.cookie, csrf: loggedIn.csrf
  })).nextCalled, true);
});

test("tampered cookies, missing sessions and cross-site writes are rejected", () => {
  const auth = createAuthSecurity({ adminPassword: PASSWORD, sessionSecret: SECRET });
  const loggedIn = login(auth);
  const tampered = loggedIn.cookie.slice(0, -1) + "x";
  assert.equal(call(auth.apiMiddleware, request({ path: "/jobs", cookie: tampered })).res.statusCode, 401);
  assert.equal(call(auth.apiMiddleware, request({
    method: "DELETE", path: "/jobs/1", cookie: loggedIn.cookie, csrf: loggedIn.csrf, fetchSite: "cross-site"
  })).res.statusCode, 403);
  assert.equal(call(auth.apiMiddleware, request({
    method: "PATCH", path: "/jobs/1", cookie: loggedIn.cookie, csrf: loggedIn.csrf, origin: "https://evil.example.test"
  })).res.statusCode, 403);
});

test("login attempts are rate limited per IP", () => {
  const auth = createAuthSecurity({ adminPassword: PASSWORD, sessionSecret: SECRET });
  let last;
  for (let index = 0; index < 6; index++) {
    const req = request({ method: "POST", path: "/api/auth/login", origin: "https://studio.example.test" });
    req.body = { password: "wrong password" };
    last = response();
    auth.login(req, last);
  }
  assert.equal(last.statusCode, 429);
  assert.ok(last.headers["retry-after"]);
});

test("secure cookie attribute is included for HTTPS deployments", () => {
  const auth = createAuthSecurity({ adminPassword: PASSWORD, sessionSecret: SECRET, secureCookies: true });
  const loggedIn = login(auth);
  assert.match(loggedIn.res.headers["set-cookie"], /Secure/);
});

test("health endpoint can pass through API protection", () => {
  const auth = createAuthSecurity({ adminPassword: PASSWORD, sessionSecret: SECRET, required: true });
  assert.equal(call(auth.apiMiddleware, request({ path: "/health" })).nextCalled, true);
});

test("logout clears the cookie and revokes the current session", () => {
  const auth = createAuthSecurity({ adminPassword: PASSWORD, sessionSecret: SECRET });
  const loggedIn = login(auth);
  const req = request({
    method: "POST",
    path: "/api/auth/logout",
    cookie: loggedIn.cookie,
    csrf: loggedIn.csrf,
    origin: "https://studio.example.test"
  });
  const res = response();
  auth.logout(req, res);
  assert.equal(res.body.authenticated, false);
  assert.match(res.headers["set-cookie"], /Max-Age=0/);
  assert.equal(call(auth.apiMiddleware, request({ path: "/jobs", cookie: loggedIn.cookie })).res.statusCode, 401);
});

test("sessions expire after twelve hours", () => {
  let clock = 1000;
  const auth = createAuthSecurity({
    adminPassword: PASSWORD,
    sessionSecret: SECRET,
    now: () => clock
  });
  const loggedIn = login(auth);
  assert.equal(call(auth.apiMiddleware, request({ path: "/jobs", cookie: loggedIn.cookie })).nextCalled, true);
  clock += 12 * 60 * 60 * 1000 + 1;
  assert.equal(call(auth.apiMiddleware, request({ path: "/jobs", cookie: loggedIn.cookie })).res.statusCode, 401);
});
