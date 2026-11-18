import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function readJobs(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error("Unable to read the video job store: " + error.message, { cause: error });
  }

  let jobs;
  try {
    jobs = JSON.parse(raw);
  } catch (error) {
    throw new Error("The video job store contains invalid JSON. It was left untouched; restore a valid backup before continuing.", { cause: error });
  }
  if (!Array.isArray(jobs)) {
    throw new Error("The video job store must contain a JSON array. It was left untouched.");
  }
  return jobs;
}

export function writeJobs(filePath, jobs) {
  if (!Array.isArray(jobs)) throw new TypeError("Video jobs must be an array.");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempFile = filePath + "." + process.pid + "." + randomUUID() + ".tmp";
  try {
    fs.writeFileSync(tempFile, JSON.stringify(jobs, null, 2), { encoding: "utf8", flag: "wx" });
    fs.renameSync(tempFile, filePath);
  } catch (error) {
    try { fs.rmSync(tempFile, { force: true }); } catch { /* Preserve the original write error. */ }
    throw new Error("Unable to save the video job store: " + error.message, { cause: error });
  }
}
