(() => {
  "use strict";

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" })
        .catch(error => console.warn("[Antardrishti PWA] Service worker unavailable:", error.message));
    }, { once: true });
  }

  let installPrompt = null;
  let installButton = null;

  function ensureInstallButton() {
    if (installButton) return installButton;
    installButton = document.createElement("button");
    installButton.type = "button";
    installButton.textContent = "Install App";
    installButton.setAttribute("aria-label", "Install Antardrishti AI Video Studio");
    installButton.style.cssText = [
      "position:fixed",
      "right:14px",
      "bottom:14px",
      "z-index:1000",
      "display:none",
      "min-height:42px",
      "padding:10px 15px",
      "border:1px solid #d8b77a",
      "border-radius:24px",
      "background:#d8b77a",
      "color:#172337",
      "font-weight:750",
      "font-size:12px",
      "box-shadow:0 5px 22px #0006"
    ].join(";");
    installButton.addEventListener("click", async () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice.catch(() => null);
      installPrompt = null;
      installButton.style.display = "none";
    });
    document.body.appendChild(installButton);
    return installButton;
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    ensureInstallButton().style.display = "block";
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    if (installButton) installButton.style.display = "none";
  });

  function updateNetworkNotice() {
    let notice = document.getElementById("antardrishti-network-notice");
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "antardrishti-network-notice";
      notice.setAttribute("role", "status");
      notice.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:999;display:none;padding:10px 13px;border:1px solid #80653a;border-radius:9px;background:#30291d;color:#f1d7a4;font:12px/1.45 system-ui,sans-serif;text-align:center";
      document.body.appendChild(notice);
    }
    notice.textContent = "आप offline हैं। App का shell खुल सकता है, लेकिन scripts, rendering और Buffer के live API काम नहीं करेंगे।";
    notice.style.display = navigator.onLine ? "none" : "block";
  }

  window.addEventListener("online", updateNetworkNotice);
  window.addEventListener("offline", updateNetworkNotice);
  window.addEventListener("load", updateNetworkNotice, { once: true });
})();
