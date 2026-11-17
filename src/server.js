import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read local .env without another package. Never commit the real .env file.
function loadLocalEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim().replace(/^\\uFEFF/, "");
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
loadLocalEnv();

const app = express();
const PORT = Number(process.env.PORT || 3460);
const DATA_DIR = path.join(__dirname, "..", "data");
const OUTPUT_DIR = path.join(__dirname, "..", "outputs");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
const GEMINI_TEXT_MODEL = "gemini-3.1-flash-lite";
const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-3.1-flash-tts-preview";

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(JOBS_FILE)) fs.writeFileSync(JOBS_FILE, "[]", "utf8");

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/outputs", express.static(OUTPUT_DIR));

function readJobs() {
  try { return JSON.parse(fs.readFileSync(JOBS_FILE, "utf8")); }
  catch { return []; }
}

function writeJobs(jobs) {
  const tempFile = JOBS_FILE + ".tmp";
  fs.writeFileSync(tempFile, JSON.stringify(jobs, null, 2), "utf8");
  fs.renameSync(tempFile, JOBS_FILE);
}

function pcmToWav(pcm, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function getModelText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const parts = [];
  for (const step of payload?.steps || []) {
    if (step.type !== "model_output") continue;
    for (const block of step.content || []) {
      if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
    }
  }
  return parts.join("\n").trim();
}

function apiError(status, payload) {
  const message = typeof payload?.error?.message === "string" ? payload.error.message : "";
  if (status === 401 || status === 403) return "Gemini API key या project permission सही नहीं है। अपनी local .env file में key जाँचें।";
  if (status === 429) return "Gemini Free Tier की rate limit पूरी हो सकती है। AI Studio में usage जाँचें और बाद में फिर कोशिश करें।";
  return message ? message.slice(0, 400) : "Gemini API request failed (HTTP " + status + ").";
}

async function callGemini(body) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "PASTE_YOUR_KEY_HERE") {
    const error = new Error("Gemini API key configured नहीं है। Project folder की .env file में GEMINI_API_KEY डालें और server restart करें।");
    error.status = 503;
    throw error;
  }

  const requestedModel = body.model || GEMINI_TEXT_MODEL;
  const isTextRequest = !/tts|speech/i.test(requestedModel);
  const modelsToTry = isTextRequest
    ? ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite"]
    : [requestedModel];

  let lastError = null;
  for (let index = 0; index < modelsToTry.length; index++) {
    const model = modelsToTry[index];
    try {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ store: false, ...body, model }),
        signal: AbortSignal.timeout(25000)
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload;

      const message = typeof payload?.error?.message === "string" ? payload.error.message : "";
      const temporaryIssue = response.status === 503 &&
        /(high demand|overload|temporarily unavailable|try again later|capacity)/i.test(message);

      lastError = new Error(apiError(response.status, payload));
      lastError.status = response.status === 429 ? 429 : response.status >= 500 ? 502 : response.status;

      if (!temporaryIssue || index === modelsToTry.length - 1) throw lastError;
    } catch (error) {
      lastError = error;
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
      if (!timedOut || index === modelsToTry.length - 1) {
        if (!error.status && timedOut) {
          const timeoutError = new Error("Gemini ने 25 seconds में response नहीं दिया। कुछ देर बाद फिर कोशिश करें।");
          timeoutError.status = 504;
          throw timeoutError;
        }
        throw error;
      }
      // Try one alternate lightweight model after a timeout.
    }
  }
  throw lastError || new Error("Gemini request failed.");
}

function findJob(id) {
  const jobs = readJobs();
  return { jobs, job: jobs.find(item => item.id === id) };
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "Antardrishti AI Video Studio",
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "PASTE_YOUR_KEY_HERE"),
    textModel: GEMINI_TEXT_MODEL,
    ttsModel: GEMINI_TTS_MODEL
  });
});

app.get("/api/jobs", (_req, res) => res.json(readJobs()));

app.post("/api/jobs", (req, res) => {
  const { topic, format = "mixed", duration = 45 } = req.body || {};
  if (typeof topic !== "string" || !topic.trim()) return res.status(400).json({ error: "Topic is required." });

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
    scriptData: null,
    voiceFile: "",
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

app.post("/api/jobs/:id/generate-script", async (req, res) => {
  const { jobs, job } = findJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Video brief not found." });

  const schema = {
    type: "object",
    properties: {
      title: { type: "string", description: "Hindi title written in Devanagari script. Only a few common English words if essential." },
      hook: { type: "string", description: "Spoken Hindi hook written in Devanagari script, not Roman Hindi." },
      voiceover: { type: "string", description: "Complete spoken narration in Devanagari Hindi. Do not write Hindi using English/Roman letters. Keep English words to at most about 10 percent." },
      scenes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            duration_sec: { type: "integer" },
            dialogue: { type: "string", description: "Presenter dialogue in Devanagari Hindi, never Roman Hindi." },
            visual_direction: { type: "string", description: "Internal visual-production prompt. English is allowed here; this text is not spoken and is not shown as a subtitle." },
            subtitle: { type: "string", description: "Short on-screen Hindi subtitle in Devanagari script, never Roman Hindi." }
          },
          required: ["duration_sec", "dialogue", "visual_direction", "subtitle"]
        }
      },
      cta: { type: "string", description: "A short spoken call-to-action in Devanagari Hindi." },
      safety_note: { type: "string", description: "Internal accuracy note in Hindi or English." }
    },
    required: ["title", "hook", "voiceover", "scenes", "cta", "safety_note"]
  };

  const prompt = [
    "Create a complete short-form video script for Antardrishti.",
    "",
    "VIDEO BRIEF",
    "Topic: " + job.topic,
    "Duration: " + job.duration + " seconds",
    "Format: " + job.format,
    "Aspect ratio: vertical 9:16",
    "",
    "LANGUAGE",
    "- IMPORTANT SCRIPT RULE: All audience-facing Hindi must be written in Devanagari script. Never write Hindi in Roman/English letters.",
    "- The title, hook, voiceover, scene dialogue, subtitles and CTA must be in natural Hindi using Devanagari. Keep English words to at most about 10% and use them only when natural.",
    "- Correct style example: \"क्या आप जानते हैं कि आपका मन आपके अनुभवों को कैसे प्रभावित करता है?\" Incorrect style: \"Kya aap jaante hain ki aapka man...\"",
    "- Warm, grounded Indian Hindi voice. Use everyday language, not stiff translated Hindi.",
    "- Make the voiceover fit the selected duration.",
    "- Write a strong hook for the first 2–3 seconds.",
    "- Provide exactly 3 concise scenes. Each scene must include dialogue in Devanagari Hindi, a short subtitle in Devanagari Hindi, and a practical visual direction.",
    "- Visual directions are internal production prompts, not audience copy. They may be written in clear English so future image/video models can understand them.",
    "- Move quickly from hook to explanation to one useful takeaway and CTA.",
    "- Visual directions should describe visuals that can be composed from typography, shapes and gradients. Do not ask to draw text inside an AI image.",
    "- Use the Devanagari voiceover as exact narration text. Do not include scene headings inside voiceover.",
    "",
    "SAFETY AND ACCURACY",
    "- Do not claim hypnotherapy diagnoses, cures, or replaces medical or mental-health care.",
    "- Do not present past-life regression memories as scientific proof of literal past lives. Describe PLR as an experiential or introspective practice when relevant.",
    "- Do not invent studies, statistics, credentials or medical facts.",
    "- Do not ask viewers to stop medication or treatment.",
    "- Keep the content educational, careful and non-coercive.",
    "",
    "Return only JSON matching the supplied schema."
  ].join("\n");

  try {
    const payload = await callGemini({
      model: GEMINI_TEXT_MODEL,
      input: prompt,
      response_format: { type: "text", mime_type: "application/json", schema },
      generation_config: { max_output_tokens: 1400 }
    });
    const text = getModelText(payload);
    if (!text) return res.status(502).json({ error: "Gemini ने खाली script response दिया।" });

    let scriptData;
    try { scriptData = JSON.parse(text); }
    catch { return res.status(502).json({ error: "Gemini response JSON format में नहीं था। Regenerate करके देखें।" }); }

    if (!scriptData.title || !scriptData.voiceover || !Array.isArray(scriptData.scenes) || !scriptData.scenes.length) {
      return res.status(502).json({ error: "Gemini script में जरूरी scene या voiceover fields नहीं मिले। Regenerate करें।" });
    }

    job.scriptData = scriptData;
    job.script = scriptData.voiceover;
    job.voiceFile = "";
    job.status = "script_ready";
    job.updatedAt = new Date().toISOString();
    writeJobs(jobs);
    res.json({ ok: true, job });
  } catch (error) {
    res.status(error.status || 502).json({
      error: error.name === "TimeoutError" ? "Gemini response में समय लग गया। फिर कोशिश करें।" : error.message || "Gemini से connect नहीं हो पाया।"
    });
  }
});

app.post("/api/jobs/:id/generate-voice", async (req, res) => {
  const { jobs, job } = findJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Video brief not found." });
  const narration = typeof req.body?.voiceover === "string"
    ? req.body.voiceover.trim()
    : String(job.scriptData?.voiceover || job.script || "").trim();

  if (!narration) return res.status(400).json({ error: "पहले Hindi script generate करें।" });
  if (narration.length > 12000) return res.status(400).json({ error: "Voiceover 12,000 characters से छोटा रखें।" });

  try {
    const payload = await callGemini({
      model: GEMINI_TTS_MODEL,
      input: "Speak the following script in natural, warm, clear Indian Hindi. Use a calm, friendly educational narrator style, medium pace, and accurate Hindi pronunciation. Preserve the words; do not translate or add an introduction.\n\n" + narration,
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: process.env.GEMINI_TTS_VOICE || "Kore" }] }
    });

    const lastModelStep = [...(payload.steps || [])].reverse().find(step => step.type === "model_output");
    const audioBlock = [...(lastModelStep?.content || [])].reverse().find(block => block.type === "audio");
    const audioData = payload?.output_audio?.data || audioBlock?.data;
    if (typeof audioData !== "string" || !audioData.length) {
      return res.status(502).json({ error: "Gemini TTS ने audio data नहीं लौटाया।" });
    }

    const pcm = Buffer.from(audioData, "base64");
    const wav = pcmToWav(pcm, Number(payload?.output_audio?.sample_rate || audioBlock?.sample_rate || 24000));
    const safeFile = job.id + ".wav";
    fs.writeFileSync(path.join(OUTPUT_DIR, safeFile), wav);
    job.script = narration;
    if (job.scriptData) job.scriptData.voiceover = narration;
    job.voiceFile = "/outputs/" + safeFile;
    job.updatedAt = new Date().toISOString();
    writeJobs(jobs);
    res.json({ ok: true, voiceFile: job.voiceFile, mimeType: "audio/wav" });
  } catch (error) {
    res.status(error.status || 502).json({
      error: error.name === "TimeoutError" ? "Voice generation में समय लग गया। फिर कोशिश करें।" : error.message || "Gemini TTS से connect नहीं हो पाया।"
    });
  }
});

app.delete("/api/jobs/:id", (req, res) => {
  const jobs = readJobs();
  const index = jobs.findIndex(item => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Video brief not found." });
  const [deletedJob] = jobs.splice(index, 1);
  writeJobs(jobs);
  try {
    if (deletedJob.voiceFile) fs.rmSync(path.join(OUTPUT_DIR, path.basename(deletedJob.voiceFile)), { force: true });
  } catch { /* Ignore optional audio cleanup errors. */ }
  res.json({ ok: true, deletedId: deletedJob.id });
});

app.patch("/api/jobs/:id", (req, res) => {
  const allowedStrings = new Set(["script", "status", "videoFile"]);
  const jobs = readJobs();
  const job = jobs.find(item => item.id === req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found." });

  for (const [key, value] of Object.entries(req.body || {})) {
    if (allowedStrings.has(key) && typeof value === "string") job[key] = value.slice(0, 30000);
  }
  if (req.body?.scriptData && typeof req.body.scriptData === "object" && !Array.isArray(req.body.scriptData)) {
    job.scriptData = req.body.scriptData;
    if (typeof req.body.scriptData.voiceover === "string") job.script = req.body.scriptData.voiceover.slice(0, 30000);
  }
  job.updatedAt = new Date().toISOString();
  writeJobs(jobs);
  res.json(job);
});

app.listen(PORT, () => {
  console.log("Antardrishti Studio running at http://localhost:" + PORT);
});
