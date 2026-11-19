import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  claimNextRenderTask,
  enqueueRenderTask,
  readRenderQueue,
  recoverInterruptedRenderTasks,
  updateRenderTask
} from "../src/render-queue.js";

function temporaryQueue(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "antardrishti-render-queue-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, "render-queue.json");
}

test("missing queue starts empty", t => {
  assert.deepEqual(readRenderQueue(temporaryQueue(t)), []);
});

test("enqueue creates a persistent queued task", t => {
  const file = temporaryQueue(t);
  const result = enqueueRenderTask(file, "job-1", "2026-11-19T12:00:00.000Z");
  assert.equal(result.created, true);
  assert.equal(result.task.status, "queued");
  assert.equal(result.task.progress, 0);
  assert.equal(readRenderQueue(file)[0].jobId, "job-1");
});

test("enqueue does not create a second active task for the same job", t => {
  const file = temporaryQueue(t);
  const first = enqueueRenderTask(file, "job-1");
  const second = enqueueRenderTask(file, "job-1");
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.task.id, first.task.id);
  assert.equal(readRenderQueue(file).length, 1);
});

test("claim picks the oldest queued task and marks it processing", t => {
  const file = temporaryQueue(t);
  enqueueRenderTask(file, "job-1", "2026-11-19T12:00:00.000Z");
  enqueueRenderTask(file, "job-2", "2026-11-19T12:01:00.000Z");
  const claimed = claimNextRenderTask(file, "2026-11-19T12:02:00.000Z");
  assert.equal(claimed.jobId, "job-1");
  assert.equal(claimed.status, "processing");
  assert.equal(claimed.attemptCount, 1);
  assert.equal(claimNextRenderTask(file).jobId, "job-2");
});

test("interrupted processing tasks are recovered after restart", t => {
  const file = temporaryQueue(t);
  const { task } = enqueueRenderTask(file, "job-1");
  claimNextRenderTask(file);
  assert.equal(recoverInterruptedRenderTasks(file, "2026-11-19T12:10:00.000Z"), 1);
  const recovered = readRenderQueue(file).find(item => item.id === task.id);
  assert.equal(recovered.status, "queued");
  assert.equal(recovered.progress, 0);
  assert.ok(recovered.recoveredAt);
});

test("progress updates are validated and persisted", t => {
  const file = temporaryQueue(t);
  const { task } = enqueueRenderTask(file, "job-1");
  assert.equal(updateRenderTask(file, task.id, { progress: 57, stage: "Encoding MP4" }).progress, 57);
  assert.equal(readRenderQueue(file)[0].stage, "Encoding MP4");
  assert.throws(() => updateRenderTask(file, task.id, { progress: 150 }), /between 0 and 100/);
});

test("missing task updates return null and invalid job IDs are rejected", t => {
  const file = temporaryQueue(t);
  assert.equal(updateRenderTask(file, "missing", { progress: 10 }), null);
  assert.throws(() => enqueueRenderTask(file, "../unsafe"), /valid video job ID/);
});

test("corrupt queue JSON is reported without overwriting it", t => {
  const file = temporaryQueue(t);
  fs.writeFileSync(file, "{broken", "utf8");
  assert.throws(() => readRenderQueue(file), /invalid JSON/);
  assert.equal(fs.readFileSync(file, "utf8"), "{broken");
});
