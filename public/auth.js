(() => {
  "use strict";

  if (window.__antardrishtiAuthInstalled) return;
  window.__antardrishtiAuthInstalled = true;

  const originalFetch = window.fetch.bind(window);
  const authEndpoints = new Set([
    "/api/auth/session",
    "/api/auth/login",
    "/api/auth/logout"
  ]);

  let authEnabled = false;
  let sessionReady = false;
  let csrfToken = "";
  let authPromise = null;
  let loginResolver = null;
  let overlay;
  let form;
  let passwordInput;
  let submitButton;
  let message;
  let configNote;
  let logoutButton;

  function addStyles() {
    if (document.getElementById("antardrishti-auth-styles")) return;
    const style = document.createElement("style");
    style.id = "antardrishti-auth-styles";
    style.textContent = `
      #antardrishti-auth-overlay{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:18px;background:rgba(5,10,18,.94);backdrop-filter:blur(8px)}
      #antardrishti-auth-overlay[hidden]{display:none}
      .antardrishti-auth-card{width:min(100%,420px);padding:26px;border:1px solid #3b4b61;border-radius:16px;background:#142235;color:#edf2f7;box-shadow:0 24px 90px #0009}
      .antardrishti-auth-brand{font:700 11px/1.4 Inter,system-ui,sans-serif;letter-spacing:.18em;color:#d8b77a}
      .antardrishti-auth-title{margin:12px 0 7px;font:500 28px/1.2 Georgia,serif}
      .antardrishti-auth-copy{margin:0 0 20px;color:#a9b8ca;font:13px/1.6 Inter,system-ui,sans-serif}
      .antardrishti-auth-field{display:block;margin:0 0 8px;color:#c7d2df;font:650 12px Inter,system-ui,sans-serif}
      #antardrishti-admin-password{display:block;width:100%;min-height:48px;padding:12px 13px;border:1px solid #40536c;border-radius:9px;background:#0d1928;color:#f5f7fa;font-size:16px;outline:none}
      #antardrishti-admin-password:focus{border-color:#d8b77a;box-shadow:0 0 0 3px #d8b77a22}
      #antardrishti-auth-submit{width:100%;min-height:47px;margin-top:13px;border:0;border-radius:9px;background:#d8b77a;color:#172233;font-weight:750;font-size:14px}
      #antardrishti-auth-submit:disabled{opacity:.6}
      #antardrishti-auth-message{min-height:20px;margin:13px 0 0;color:#ffb8b8;font-size:12px;line-height:1.5}
      #antardrishti-auth-config{padding:12px;border:1px solid #775b35;border-radius:9px;background:#30291d;color:#f1d7a4;font-size:12px;line-height:1.6}
      #antardrishti-auth-logout{position:fixed;right:12px;top:12px;z-index:2147482000;border:1px solid #52627a;border-radius:30px;padding:8px 12px;background:#17263a;color:#e8edf4;font-size:11px;font-weight:650}
      #antardrishti-auth-logout[hidden]{display:none}
      @media(max-width:480px){.antardrishti-auth-card{padding:22px}.antardrishti-auth-title{font-size:25px}}
    `;
    document.head.appendChild(style);
  }

  function buildOverlay() {
    if (overlay) return;
    addStyles();

    overlay = document.createElement("section");
    overlay.id = "antardrishti-auth-overlay";
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "antardrishti-auth-title");

    const card = document.createElement("div");
    card.className = "antardrishti-auth-card";
    const brand = document.createElement("div");
    brand.className = "antardrishti-auth-brand";
    brand.textContent = "ANTARDRISHTI AI VIDEO STUDIO";
    const title = document.createElement("h1");
    title.id = "antardrishti-auth-title";
    title.className = "antardrishti-auth-title";
    title.textContent = "Admin Login";
    const copy = document.createElement("p");
    copy.className = "antardrishti-auth-copy";
    copy.textContent = "अपने Video Studio और publishing records तक पहुँचने के लिए admin password दर्ज करें।";

    form = document.createElement("form");
    form.autocomplete = "on";
    const label = document.createElement("label");
    label.className = "antardrishti-auth-field";
    label.htmlFor = "antardrishti-admin-password";
    label.textContent = "Admin password";
    passwordInput = document.createElement("input");
    passwordInput.id = "antardrishti-admin-password";
    passwordInput.type = "password";
    passwordInput.name = "password";
    passwordInput.autocomplete = "current-password";
    passwordInput.required = true;
    passwordInput.minLength = 12;
    submitButton = document.createElement("button");
    submitButton.id = "antardrishti-auth-submit";
    submitButton.type = "submit";
    submitButton.textContent = "Login";
    message = document.createElement("p");
    message.id = "antardrishti-auth-message";
    message.setAttribute("role", "status");
    configNote = document.createElement("div");
    configNote.id = "antardrishti-auth-config";
    configNote.hidden = true;
    configNote.textContent = "Server पर ADMIN_PASSWORD (कम-से-कम 12 characters) और ADMIN_SESSION_SECRET (कम-से-कम 32 characters) configure करें। फिर server restart करें।";

    label.appendChild(document.createTextNode(""));
    form.append(label, passwordInput, submitButton, message);
    card.append(brand, title, copy, configNote, form);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    logoutButton = document.createElement("button");
    logoutButton.id = "antardrishti-auth-logout";
    logoutButton.type = "button";
    logoutButton.textContent = "Admin · Logout";
    logoutButton.hidden = true;
    document.body.appendChild(logoutButton);

    form.addEventListener("submit", submitLogin);
    logoutButton.addEventListener("click", logout);
  }

  function openLogin(configMissing = false) {
    buildOverlay();
    overlay.hidden = false;
    logoutButton.hidden = true;
    configNote.hidden = !configMissing;
    form.hidden = configMissing;
    message.textContent = configMissing
      ? "Admin login अभी server पर configure नहीं है। Public access बंद रखा गया है।"
      : "";
    if (!configMissing) {
      passwordInput.value = "";
      window.setTimeout(() => passwordInput.focus(), 30);
    }
  }

  function closeLogin() {
    if (overlay) overlay.hidden = true;
    if (logoutButton) logoutButton.hidden = !authEnabled;
  }

  async function submitLogin(event) {
    event.preventDefault();
    if (submitButton.disabled) return;
    submitButton.disabled = true;
    submitButton.textContent = "Checking…";
    message.textContent = "";

    try {
      const response = await originalFetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput.value })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Login नहीं हो पाया।");

      csrfToken = result.csrfToken || "";
      sessionReady = true;
      closeLogin();
      const resolve = loginResolver;
      loginResolver = null;
      if (resolve) resolve();
    } catch (error) {
      message.textContent = error.message || "Login नहीं हो पाया।";
      passwordInput.select();
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Login";
    }
  }

  async function logout() {
    logoutButton.disabled = true;
    try {
      await originalFetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": csrfToken }
      });
    } finally {
      csrfToken = "";
      sessionReady = false;
      authPromise = null;
      loginResolver = null;
      openLogin(false);
      const pending = new Promise(resolve => { loginResolver = resolve; });
      authPromise = pending;
      logoutButton.disabled = false;
    }
  }

  async function initializeSession() {
    buildOverlay();
    const response = await originalFetch("/api/auth/session", {
      credentials: "same-origin",
      cache: "no-store"
    });
    const status = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(status.error || "Admin session status नहीं मिल पाया।");

    authEnabled = status.authEnabled === true;
    if (!authEnabled) {
      sessionReady = true;
      return;
    }
    if (!status.configured) {
      openLogin(true);
      return new Promise(() => {});
    }
    if (status.authenticated) {
      csrfToken = status.csrfToken || "";
      sessionReady = true;
      closeLogin();
      return;
    }

    openLogin(false);
    return new Promise(resolve => { loginResolver = resolve; });
  }

  function ensureSession() {
    if (sessionReady) return Promise.resolve();
    if (!authPromise) {
      authPromise = initializeSession().catch(error => {
        buildOverlay();
        openLogin(true);
        message.textContent = error.message || "Admin session initialize नहीं हो पाया।";
        throw error;
      });
    }
    return authPromise;
  }

  function protectedUrl(input) {
    try {
      const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
      if (url.origin !== window.location.origin) return false;
      return url.pathname.startsWith("/api/") || url.pathname === "/outputs" || url.pathname.startsWith("/outputs/");
    } catch {
      return false;
    }
  }

  function endpointPath(input) {
    try {
      return new URL(typeof input === "string" ? input : input.url, window.location.href).pathname;
    } catch {
      return "";
    }
  }

  window.fetch = async function antardrishtiAuthenticatedFetch(input, init = {}) {
    const pathname = endpointPath(input);
    if (!protectedUrl(input) || authEndpoints.has(pathname)) {
      return originalFetch(input, init);
    }

    await ensureSession();

    const requestSource = input instanceof Request ? input.clone() : input;
    async function send() {
      const headers = new Headers(requestSource instanceof Request ? requestSource.headers : undefined);
      new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
      const method = String(init.method || (requestSource instanceof Request ? requestSource.method : "GET")).toUpperCase();
      if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken) {
        headers.set("X-CSRF-Token", csrfToken);
      }
      return originalFetch(requestSource instanceof Request ? requestSource.clone() : requestSource, {
        ...init,
        headers,
        credentials: init.credentials || "same-origin"
      });
    }

    let response = await send();
    if (response.status === 401 && authEnabled) {
      sessionReady = false;
      csrfToken = "";
      authPromise = null;
      await ensureSession();
      response = await send();
    }
    return response;
  };
})();
