import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

test("PWA manifest declares a standalone portrait app", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.name, "Antardrishti AI Video Studio");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "portrait");
  assert.ok(manifest.icons.some(icon => icon.src === "/icon.svg"));
});

test("service worker explicitly avoids caching API and generated output data", () => {
  const worker = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /url\.pathname\.startsWith\("\/outputs\/"\)/);
  assert.match(worker, /request\.method !== "GET"/);
});

test("both dashboard pages load PWA setup and shared authentication", () => {
  for (const file of ["index.html", "publishing.html"]) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
    assert.match(html, /src="\/pwa\.js"/);
    assert.match(html, /src="\/auth\.js"/);
  }
});
