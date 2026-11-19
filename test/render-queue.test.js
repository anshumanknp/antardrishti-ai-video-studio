import test from "node:test";
import assert from "node:assert/strict";
import { createRenderQueue } from "../src/render-queue.js";

function waitFor(predicate, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error("Timed out waiting for render queue."));
      setTimeout(tick, 10);
    };
    tick();
  });
}

test("render queue persists queued, rendering and ready states", async () => {
  const jobs = [{
    id: "job-1",
    scriptData: { scenes: [{ dialogue: "नमस्कार" }] },
    status: "script_ready"
  }];
  const queue = createRenderQueue({
    readJobs: () => jobs,
    writeJobs: () => {},
    renderVideo: async () => ({
      fileName: "antardrishti-job-1-final.mp4",
      mimeType: "video/mp4",
      sizeBytes: 2048,
      durationSec: 15,
      srtFile: "antardrishti-job-1-hi.srt"
    })
  });

  const queued = queue.enqueue("job-1");
  assert.ok(["queued", "rendering"].includes(queued.renderStatus));
  await waitFor(() => jobs[0].renderStatus === "ready");
  assert.equal(jobs[0].renderProgress, 100);
  assert.equal(jobs[0].renderedVideoFile, "antardrishti-job-1-final.mp4");
  assert.equal(jobs[0].renderedVideoMimeType, "video/mp4");
  assert.equal(jobs[0].subtitleFile, "antardrishti-job-1-hi.srt");
  queue.stop();
});

test("render queue runs one render at a time", async () => {
  const jobs = [1, 2, 3].map(id => ({
    id: "job-" + id,
    scriptData: { scenes: [{ dialogue: "नमस्कार" }] },
    renderStatus: "queued"
  }));
  let active = 0;
  let maximumActive = 0;
  const queue = createRenderQueue({
    readJobs: () => jobs,
    writeJobs: () => {},
    renderVideo: async job => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 20));
      active -= 1;
      return { fileName: job.id + ".mp4", mimeType: "video/mp4", sizeBytes: 2048 };
    }
  });

  queue.resume();
  await waitFor(() => jobs.every(job => job.renderStatus === "ready"));
  assert.equal(maximumActive, 1);
  queue.stop();
});

test("render queue validates job existence and script readiness", () => {
  const jobs = [{ id: "empty-job" }];
  const queue = createRenderQueue({
    readJobs: () => jobs,
    writeJobs: () => {},
    renderVideo: async () => ({})
  });
  assert.throws(() => queue.enqueue("missing"), /Video brief नहीं मिला/);
  assert.throws(() => queue.enqueue("empty-job"), /Hindi script/);
  queue.stop();
});
