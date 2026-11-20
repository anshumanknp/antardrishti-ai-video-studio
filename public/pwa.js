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
      if (!installPrompt) {
        showInstallHelp();
        return;
      }
      installPrompt.prompt();
      await installPrompt.userChoice.catch(() => null);
      installPrompt = null;
      installButton.textContent = "Install instructions";
      if (!isStandalone()) showInstallHelp();
    });
    document.body.appendChild(installButton);
    return installButton;
  }

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  }

  function showInstallHelp() {
    let dialog = document.getElementById("antardrishti-install-help");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "antardrishti-install-help";
      dialog.style.cssText = "max-width:360px;width:calc(100% - 32px);padding:22px;border:1px solid #52627a;border-radius:14px;background:#142235;color:#edf2f7;box-shadow:0 20px 70px #000b";
      const title = document.createElement("h2");
      title.textContent = "Install Antardrishti";
      title.style.cssText = "margin:0 0 12px;font:22px Georgia,serif";
      const steps = document.createElement("p");
      steps.style.cssText = "font:13px/1.7 system-ui,sans-serif;color:#c4d0de";
      steps.textContent = /iPhone|iPad|iPod/.test(navigator.userAgent)
        ? "Safari में Share बटन दबाएँ, फिर Add to Home Screen चुनें। इसके बाद Add दबाएँ।"
        : "Chrome में ऊपर ⋮ menu खोलें और Install app या Add to Home screen चुनें।";
      const note = document.createElement("p");
      note.style.cssText = "font:11px/1.6 system-ui,sans-serif;color:#9aacc0";
      note.textContent = "Install का विकल्प HTTPS पर hosted version में मिलेगा। App का पूरा काम करने के लिए internet और server चाहिए।";
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "Close";
      close.style.cssText = "width:100%;min-height:42px;border:0;border-radius:8px;background:#d8b77a;color:#172337;font-weight:750";
      close.addEventListener("click", () => dialog.close());
      dialog.append(title, steps, note, close);
      document.body.appendChild(dialog);
    }
    if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
    else dialog.setAttribute("open", "");
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

  window.addEventListener("load", () => {
    if (isStandalone() || !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return;
    window.setTimeout(() => {
      if (!installPrompt) {
        const button = ensureInstallButton();
        button.textContent = "Install instructions";
        button.style.display = "block";
      }
    }, 1500);
  }, { once: true });

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
