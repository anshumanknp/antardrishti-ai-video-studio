import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3460);
const DATA_DIR = path.join(__dirname, "..", "data");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(JOBS_FILE)) fs.writeFileSync(JOBS_FILE, "[]", "utf8");

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

function readJobs() {
  try {
    return JSON.parse(fs.readFileSync(JOBS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeJobs(jobs) {
  const tempFile = JOBS_FILE + ".tmp";
  fs.writeFileSync(tempFile, JSON.stringify(jobs, null, 2), "utf8");
  fs.renameSync(tempFile, JOBS_FILE);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, app: "Antardrishti AI Video Studio" });
});

app.get("/api/jobs", (_req, res) => res.json(readJobs()));

app.post("/api/jobs", (req, res) => {
  const { topic, format = "mixed", duration = 45 } = req.body || {};
  if (typeof topic !== "string" || !topic.trim()) {
    return res.status(400).json({ error: "Topic is required." });
  }

  const allowedFormats = new Set(["mixed", "presenter", "cinematic"]);
  const selectedFormat = allowedFormats.has(format) ? format : "mixed";
  const numericDuration = Number(duration);
  const job = {
    id: randomUUID(),
    topic: topic.trim().slice(0, 300),
    format: selectedFormat,
    duration: Math.max(15, Math.min(90, Number.isFinite(numericDuration) ? numericDuration : 45)),
    language: "Hindi 90%, English 10%",
    aspectRatio: "9:16",
    status: "brief_created",
    script: "",
    videoFile: "",
    platforms: ["Instagram", "Facebook", "YouTube Shorts"],
    approvalRequired: true,
    createdAt: new Date().toISOString()
  };

  const jobs = readJobs();
  jobs.unshift(job);
  writeJobs(jobs);
  res.status(201).json(job);
});

app.patch("/api/jobs/:id", (req, res) => {
  const allowed = new Set(["script", "status", "videoFile"]);
  const jobs = readJobs();
  const job = jobs.find(item => item.id === req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found." });

  for (const [key, value] of Object.entries(req.body || {})) {
    if (allowed.has(key) && typeof value === "string") job[key] = value.slice(0, 20000);
  }
  job.updatedAt = new Date().toISOString();
  writeJobs(jobs);
  res.json(job);
});

app.listen(PORT, () => {
  console.log(`Antardrishti Studio running at http://localhost:${PORT}`);
});
