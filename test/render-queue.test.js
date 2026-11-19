import test from "node:test";
import assert from "node:assert/strict";
import { createRenderQueue } from "../src/render-queue.js";

function createStore(initial) {
  let jobs = structuredClone(initial);
  return {
    readJobs: () => structuredClone(jobs),
    writeJobs: next => { jobs = structuredClone(next); },
    current: () => structuredClone(jobs)
  };
}

test("queues server renders one at a time and stores completion metadata", async () => {
  const store = createStore([
    { id: "one", topic: "a", duration: 15, scriptData: { title: "a" }, voiceFile: "one.wav", sceneImages: [] },
    { id: "two", topic: "b", duration: 15, scriptData: { title: "b" }, voiceFile: "two.wav", sceneImages: [] }
  ]);
  let active = 0;
  let maximum = 0;
  const queue = createRenderQueue({
    readJobs: store.readJobs,
    writeJobs: store.writeJobs,
    async renderJob(job, { onProgress }) {
      active++;
      maximum = Math.max(maximum, active);
      onProgress(42);
      await new Promise(resolve => setTimeout(resolve, 15));
      active--;
      return { fileName: job.id + ".mp4", subtitleFileName: job.id + ".srt", sizeBytes: 5000, durationSec: 15 };
    }
  });
  queue.enqueue("one");
  queue.enqueue("two");
  await new Promise(resolve => setTimeout(resolve, 120));
  const jobs = store.current();
  assert.equal(maximum, 1);
  assert.ok(jobs.every(job => job.renderStatus === "ready"));
  assert.ok(jobs.every(job => job.renderProgress === 100));
});

test("recovers queued and interrupted render jobs after restart", async () => {
  const store = createStore([
    { id: "queued", renderStatus: "queued" },
    { id: "interrupted", renderStatus: "rendering", renderProgress: 38 }
  ]);
  const rendered = [];
  const queue = createRenderQueue({
    readJobs: store.readJobs,
    writeJobs: store.writeJobs,
    async renderJob(job) {
      rendered.push(job.id);
      return { fileName: job.id + ".mp4", subtitleFileName: job.id + ".srt", sizeBytes: 5000, durationSec: 10 };
    }
  });
  queue.recover();
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.deepEqual(rendered.sort(), ["interrupted", "queued"]);
  assert.ok(store.current().every(job => job.renderStatus === "ready"));
});
