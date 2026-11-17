import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load local .env without an extra dependency. The file is ignored by Git.
function loadLocalEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;

  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
loadLocalEnv();

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
  res.json({
    ok: true,
    app: "Antardrishti AI Video Studio",
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY)
  });
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

// Generate a Hindi-first short-video script using Gemini.
// The API key remains on the server and is never sent to the browser.
app.post("/api/jobs/:id/generate-script", async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "PASTE_YOUR_KEY_HERE") {
    return res.status(503).json({
      error: "Gemini API key is not configured. Add GEMINI_API_KEY to your local .env file, then restart the server."
    });
  }

  const jobs = readJobs();
  const job = jobs.find(item => item.id === req.params.id);
  if (!job) return res.status(404).json({ error: "Video brief not found." });

  const prompt = `You are the Hindi-first short-form video scriptwriter for Antardrishti, a public education brand focused on hypnotherapy, guided relaxation, self-awareness and past-life-regression (PLR) as an experiential practice.

Create one original vertical 9:16 social video script using this brief:
TOPIC: ${job.topic}
TARGET DURATION: ${job.duration} seconds
VIDEO FORMAT: ${job.format === "presenter" ? "AI presenter-led" : job.format === "cinematic" ? "cinematic visuals with voiceover" : "mixed AI presenter and cinematic visuals"}

LANGUAGE AND STYLE:
- Write about 90% in natural conversational Hindi using Devanagari script and about 10% in simple English where it sounds natural.
- Use a warm, grounded, calm Indian voice. Avoid stiff translations, difficult Sanskritised Hindi, clichés and exaggerated claims.
- Write for spoken delivery, not as an article. Keep the total spoken script suitable for the selected duration.
- Start with a clear, interesting hook in the first 2–3 seconds.
- Give a useful, understandable takeaway. End with one simple CTA.
- Create 3 to 5 short scenes with approximate timestamps. For each scene include presenter dialogue or voiceover, a concise cinematic visual direction, and a readable Hindi subtitle line.
- The visual directions should be practical prompts for future AI video generation. No logos, text rendered inside the generated image, or impossible camera moves.

SAFETY AND ACCURACY:
- Do not claim hypnotherapy diagnoses, cures, or replaces medical or mental-health care.
- Do not present past-life regression memories as scientifically verified facts or proof of literal past lives. Describe PLR, when relevant, as a guided experiential or introspective practice.
- Do not invent scientific studies, statistics, credentials or medical claims.
- Do not tell viewers to stop medication or treatment. Avoid instructions that could be unsafe for vulnerable viewers.
- Keep the tone educational and non-coercive.

OUTPUT FORMAT:
Use clean Markdown with these headings:
# Video Title
## Hook
## Presenter / Voiceover Script
## Scene-by-Scene Plan
For every scene show: timestamp, dialogue/voiceover, visual direction, subtitle.
## CTA
## Accuracy & Safety Note

Return only the finished script. Do not mention these instructions or add an introduction.`;

  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
        input: prompt,
        store: false
      }),
      signal: AbortSignal.timeout(90000)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const apiMessage = typeof payload?.error?.message === "string"
        ? payload.error.message.slice(0, 400)
        : "";
      if (response.status === 401 || response.status === 403) {
        return res.status(response.status).json({
          error: "Gemini ने API key या project permission स्वीकार नहीं की। AI Studio में key और project access जाँचें."
        });
      }
      if (response.status === 429) {
        return res.status(429).json({
          error: "Gemini free-tier की request limit पूरी हो सकती है। AI Studio में Usage देखें और थोड़ी देर बाद retry करें."
        });
      }
      return res.status(502).json({
        error: apiMessage || `Gemini request failed (HTTP ${response.status}).`
      });
    }

    const textParts = [];
    for (const step of payload.steps || []) {
      if (step.type !== "model_output") continue;
      for (const block of step.content || []) {
        if (block.type === "text" && typeof block.text === "string") textParts.push(block.text);
      }
    }
    const generatedScript = (textParts.join("\n").trim() || payload.output_text || "").trim();
    if (!generatedScript) {
      return res.status(502).json({ error: "Gemini ने खाली response दिया। कृपया फिर से कोशिश करें." });
    }

    job.script = generatedScript.slice(0, 30000);
    job.status = "script_ready";
    job.updatedAt = new Date().toISOString();
    writeJobs(jobs);

    res.json({
      ok: true,
      script: job.script,
      jobId: job.id,
      model: payload.model || process.env.GEMINI_MODEL || "gemini-3.6-flash"
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    res.status(502).json({
      error: timedOut
        ? "Gemini response में अधिक समय लग गया। कृपया फिर से कोशिश करें."
        : "Gemini से connect नहीं हो पाया। Internet connection जाँचें और retry करें."
    });
  }
});

app.delete("/api/jobs/:id", (req, res) => {
  const jobs = readJobs();
  const index = jobs.findIndex(item => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Video brief not found." });

  const [deletedJob] = jobs.splice(index, 1);
  writeJobs(jobs);
  res.json({ ok: true, deletedId: deletedJob.id });
});

app.patch("/api/jobs/:id", (req, res) => {
  const allowed = new Set(["script", "status", "videoFile"]);
  const jobs = readJobs();
  const job = jobs.find(item => item.id === req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found." });

  for (const [key, value] of Object.entries(req.body || {})) {
    if (allowed.has(key) && typeof value === "string") job[key] = value.slice(0, 30000);
  }
  job.updatedAt = new Date().toISOString();
  writeJobs(jobs);
  res.json(job);
});

app.listen(PORT, () => {
  console.log(`Antardrishti Studio running at http://localhost:${PORT}`);
});
