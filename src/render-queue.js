import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const VALID_STATUSES = new Set(["queued", "processing", "completed", "failed"]);
const ACTIVE_STATUSES = new Set(["queued", "processing"]);
const MAX_HISTORY = 1000;

function readQueueFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error("Unable to read the render queue: " + error.message, { cause: error });
  }

  let queue;
  try {
    queue = JSON.parse(raw);
  } catch (error) {
    throw new Error("The render queue contains invalid JSON. It was left untouched; restore a valid backup before continuing.", { cause: error });
  }
  if (!Array.isArray(queue)) {
    throw new Error("The render queue must contain a JSON array. It was left untouched.");
  }
  return queue;
}

function writeQueueFile(filePath, queue) {
  if (!Array.isArray(queue)) throw new TypeError("Render queue must be an array.");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempFile = filePath + "." + process.pid + "." + randomUUID() + ".tmp";
  try {
    fs.writeFileSync(tempFile, JSON.stringify(queue, null, 2), { encoding: "utf8", flag: "wx" });
    fs.renameSync(tempFile, filePath);
  } catch (error) {
    try { fs.rmSync(tempFile, { force: true }); } catch { /* Preserve the original write error. */ }
    throw new Error("Unable to save the render queue: " + error.message, { cause: error });
  }
}

export function readRenderQueue(filePath) {
  return readQueueFile(filePath);
}

export function enqueueRenderTask(filePath, jobId, now = new Date().toISOString()) {
  const safeJobId = String(jobId || "").trim();
  if (!/^[a-z0-9_-]{1,80}$/i.test(safeJobId)) {
    throw new TypeError("A valid video job ID is required.");
  }

  const queue = readQueueFile(filePath);
  const activeTask = queue.find(task => task.jobId === safeJobId && ACTIVE_STATUSES.has(task.status));
  if (activeTask) return { task: activeTask, created: false };

  const task = {
    id: randomUUID(),
    jobId: safeJobId,
    status: "queued",
    stage: "Queued for server rendering",
    progress: 0,
    attemptCount: 0,
    createdAt: now,
    updatedAt: now
  };
  queue.push(task);

  const retained = queue.length > MAX_HISTORY
    ? queue.filter(item => ACTIVE_STATUSES.has(item.status)).concat(
        queue.filter(item => !ACTIVE_STATUSES.has(item.status)).slice(-(MAX_HISTORY - queue.filter(item => ACTIVE_STATUSES.has(item.status)).length))
      )
    : queue;
  writeQueueFile(filePath, retained);
  return { task, created: true };
}

export function recoverInterruptedRenderTasks(filePath, now = new Date().toISOString()) {
  const queue = readQueueFile(filePath);
  let recovered = 0;
  for (const task of queue) {
    if (task.status !== "processing") continue;
    task.status = "queued";
    task.stage = "Recovered after server restart; render will restart from the beginning";
    task.progress = 0;
    task.updatedAt = now;
    task.recoveredAt = now;
    delete task.startedAt;
    recovered++;
  }
  if (recovered) writeQueueFile(filePath, queue);
  return recovered;
}

export function claimNextRenderTask(filePath, now = new Date().toISOString()) {
  const queue = readQueueFile(filePath);
  const task = queue.find(item => item.status === "queued");
  if (!task) return null;

  task.status = "processing";
  task.stage = "Preparing video assets";
  task.progress = 1;
  task.attemptCount = Math.max(0, Number(task.attemptCount) || 0) + 1;
  task.startedAt = now;
  task.updatedAt = now;
  writeQueueFile(filePath, queue);
  return task;
}

export function updateRenderTask(filePath, taskId, patch, now = new Date().toISOString()) {
  const queue = readQueueFile(filePath);
  const task = queue.find(item => item.id === taskId);
  if (!task) return null;

  const allowed = new Set(["status", "stage", "progress", "error", "outputFile", "completedAt"]);
  for (const [key, value] of Object.entries(patch || {})) {
    if (!allowed.has(key)) continue;
    if (key === "status" && !VALID_STATUSES.has(value)) {
      throw new TypeError("Invalid render task status.");
    }
    if (key === "progress") {
      const progress = Number(value);
      if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
        throw new TypeError("Render progress must be between 0 and 100.");
      }
      task.progress = Math.round(progress);
      continue;
    }
    if (key === "stage" || key === "error" || key === "outputFile" || key === "completedAt") {
      if (typeof value === "string") task[key] = value.slice(0, 1000);
      continue;
    }
    task[key] = value;
  }
  task.updatedAt = now;
  writeQueueFile(filePath, queue);
  return task;
}
