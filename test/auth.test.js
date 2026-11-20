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

test("unconfigured local development keeps API available without enabling admin auth", () => {
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
  const api = call(auth.apiMiddleware, request({ path: "/jobs" }));
  assert.equal(api.res.statusCode, 503);
  const output = call(auth.outputsMiddleware, request({ path: "/video.mp4" }));
  assert.equal(output.res.statusCode, 503);
});

test("successful login issues HttpOnly SameSite cookie and CSRF token", () => {
  const auth = createAuthSecurity({ adminPassword: PASSWORD, sessionSecret: SECRET });
  const result = login(auth);
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.res.body.authenticated, true);
  assert.ok(result.cookie.startsWith("antardrishti_admin="));
  assert.match(result.res.headers["set-cookie"], /HttpOnly/);
  assert.match(result.res.headers["set-cookie"], /SameSite=Strict/);
  assert.equal(result.csrf.length > 20, true);
});

test("authenticated reads pass but state-changing APIs require a CSRF token", () => {
  const auth = createAuthSecurity({ adminPassword: PASSWORD, sessionSecret: SECRET });
  const loggedIn = login(auth);
  const cookieHeader = loggedIn.cookie;
  const read = call(auth.apiMiddleware, request({ path: "/jobs", cookie: cookieHeader }));
  assert.equal(read.nextCalled, true);
  const mutationWithoutCsrf = call(auth.apiMiddleware, request({ method: "POST", path: "/jobs", cookie: cookieHeader }));
  assert.equal(mutationWithoutCsrf.res.statusCode, 403);
  const mutationWithCsrf = call(auth.apiMiddleware, request({ method: "POST", path: "/jobs", cookie: cookieHeader, csrf: loggedIn.csrf }));
  assert.equal(mutationWithCsrf.nextCalled, true);
});

test("tampered cookies, missing sessions and cross-site writes are rejected", () => {
  const auth = createAuthSecurity({ adminPassword: PASSWORD, sessionSecret: SECRET });
  const loggedIn = login(auth);
  const tampered = loggedIn.cookie.slice(0, -1) + "x";
  assert.equal(call(auth.apiMiddleware, request({ path: "/jobs", cookie: tampered })).res.statusCode, 401);
  assert.equal(call(auth.apiMiddleware, request({ method: "DELETE", path: "/jobs/1", cookie: loggedIn.cookie, csrf: loggedIn.csrf, fetchSite: "cross-site" })).res.statusCode, 403);
  assert.equal(call(auth.apiMiddleware, request({ method: "PATCH", path: "/jobs/1", cookie: loggedIn.cookie, csrf: loggedIn.csrf, origin: "https://evil.example.test" })).res.statusCode, 403);
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
