import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJobs, writeJobs } from "../src/job-store.js";

function temporaryStore(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "antardrishti-jobs-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, "jobs.json");
}

test("missing job store starts as an empty list", t => {
  const file = temporaryStore(t);
  assert.deepEqual(readJobs(file), []);
});

test("valid job store is read", t => {
  const file = temporaryStore(t);
  const jobs = [{ id: "job-1", topic: "Test" }];
  writeJobs(file, jobs);
  assert.deepEqual(readJobs(file), jobs);
});

test("corrupt JSON is reported and never silently treated as empty", t => {
  const file = temporaryStore(t);
  fs.writeFileSync(file, "{broken", "utf8");
  assert.throws(() => readJobs(file), /invalid JSON/);
  assert.equal(fs.readFileSync(file, "utf8"), "{broken");
});

test("non-array JSON is rejected", t => {
  const file = temporaryStore(t);
  fs.writeFileSync(file, JSON.stringify({ jobs: [] }), "utf8");
  assert.throws(() => readJobs(file), /must contain a JSON array/);
});

test("writes replace the store with valid JSON", t => {
  const file = temporaryStore(t);
  writeJobs(file, [{ id: "job-2" }]);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), [{ id: "job-2" }]);
});

test("write rejects non-array values", t => {
  const file = temporaryStore(t);
  assert.throws(() => writeJobs(file, {}), /must be an array/);
});
