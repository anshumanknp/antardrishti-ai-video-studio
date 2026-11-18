import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { readJobs as readJobStore, writeJobs as writeJobStore } from "./job-store.js";
import { validateScriptData } from "./script-validation.js";

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
const BRAND_LOGO_META_FILE = path.join(DATA_DIR, "brand-logo.json");
const GEMINI_TEXT_MODEL = "gemini-3.1-flash-lite";
const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-3.1-flash-tts-preview";
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_IMAGE_MODEL = process.env.CLOUDFLARE_IMAGE_MODEL || "@cf/black-forest-labs/flux-1-schnell";
const CLOUDFLARE_IMAGE_STEPS = Math.max(1, Math.min(4, Number(process.env.CLOUDFLARE_IMAGE_STEPS || 4)));
const CLOUDFLARE_IMAGE_DAILY_LIMIT = 100;
const IMAGE_USAGE_FILE = path.join(DATA_DIR, "cloudflare-image-usage.json");
const CLOUDFLARE_IMAGE_ENABLED = process.env.CLOUDFLARE_IMAGE_ENABLED === "true" &&
  Boolean(CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_API_TOKEN);
const FEMALE_TTS_VOICES = new Set(["Kore", "Aoede", "Leda", "Zephyr", "Gacrux"]);
const MALE_TTS_VOICES = new Set(["Orus", "Puck", "Charon", "Algieba", "Sadaltager"]);
const DEFAULT_FEMALE_VOICE = "Kore";
const DEFAULT_MALE_VOICE = "Orus";

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(JOBS_FILE)) fs.writeFileSync(JOBS_FILE, "[]", "utf8");

app.use(express.json({ limit: "3mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/outputs", express.static(OUTPUT_DIR));

function readJobs() { return readJobStore(JOBS_FILE); }
function writeJobs(jobs) { return writeJobStore(JOBS_FILE, jobs); }

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

function readImageUsage() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const usage = JSON.parse(fs.readFileSync(IMAGE_USAGE_FILE, "utf8"));
    if (usage.date === today && Number.isFinite(usage.count)) return usage;
  } catch { /* Start a fresh daily counter. */ }
  return { date: today, count: 0 };
}

function writeImageUsage(usage) {
  fs.writeFileSync(IMAGE_USAGE_FILE, JSON.stringify(usage, null, 2), "utf8");
}

function reserveImageUsageSlot() {
  const usage = readImageUsage();
  if (usage.count >= CLOUDFLARE_IMAGE_DAILY_LIMIT) {
    const error = new Error(
      "इस Studio की सुरक्षित daily image limit पूरी हो गई है (" +
      CLOUDFLARE_IMAGE_DAILY_LIMIT + " images)। यह free-tier limit की सुरक्षा के लिए है; कल UTC reset के बाद फिर कोशिश करें।"
    );
    error.status = 429;
    throw error;
  }
  usage.count += 1;
  writeImageUsage(usage);
  return usage;
}

function releaseImageUsageSlot() {
  const usage = readImageUsage();
  usage.count = Math.max(0, usage.count - 1);
  writeImageUsage(usage);
}

async function generateCloudflareSceneImage(prompt) {
  if (!CLOUDFLARE_IMAGE_ENABLED) {
    const error = new Error("Cloudflare Workers AI free image API configured नहीं है। .env में Account ID, API Token और CLOUDFLARE_IMAGE_ENABLED=true सेट करें।");
    error.status = 503;
    throw error;
  }

  const usageReservation = reserveImageUsageSlot();
  try {
    const endpoint =
      "https://api.cloudflare.com/client/v4/accounts/" +
      encodeURIComponent(CLOUDFLARE_ACCOUNT_ID) +
      "/ai/run/" + CLOUDFLARE_IMAGE_MODEL;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + CLOUDFLARE_API_TOKEN
      },
      body: JSON.stringify({
        prompt,
        steps: CLOUDFLARE_IMAGE_STEPS
      }),
      signal: AbortSignal.timeout(90000)
    });

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
      const messageBody = contentType.includes("application/json")
        ? await response.json().catch(() => ({}))
        : { errors: [{ message: (await response.text().catch(() => "")).slice(0, 300) }] };
      const apiMessage = messageBody?.errors?.map(item => item.message).filter(Boolean).join("; ");
      const error = new Error(
        response.status === 429
          ? "Cloudflare की daily free AI quota या rate limit पूरी हो गई है। कोई paid fallback नहीं होगा।"
          : apiMessage || "Cloudflare Workers AI image request failed (HTTP " + response.status + ")."
      );
      error.status = response.status === 429 ? 429 : response.status >= 500 ? 502 : response.status;
      throw error;
    }

    if (contentType.startsWith("image/")) {
      const buffer = Buffer.from(await response.arrayBuffer());
      return { buffer, mimeType: contentType.split(";")[0] || "image/jpeg" };
    }

    const payload = await response.json().catch(() => ({}));
    const base64 = payload?.result?.image || payload?.image;
    if (typeof base64 !== "string" || !base64.length) {
      const error = new Error("Cloudflare Workers AI ने image data नहीं लौटाया।");
      error.status = 502;
      throw error;
    }
    return { buffer: Buffer.from(base64, "base64"), mimeType: "image/jpeg" };
  } catch (error) {
    releaseImageUsageSlot();
    throw error;
  }
}

function extractGeminiPcm(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const audioPart = parts.find(part => part?.inlineData?.data || part?.inline_data?.data);
  const base64 = audioPart?.inlineData?.data || audioPart?.inline_data?.data;
  if (typeof base64 !== "string" || !base64.length) return null;
  return Buffer.from(base64, "base64");
}

async function generateGeminiTtsPcm(input, speechConfig) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "PASTE_YOUR_KEY_HERE") {
    const error = new Error("Gemini API key configured नहीं है। Project folder की .env file में GEMINI_API_KEY डालें और server restart करें।");
    error.status = 503;
    throw error;
  }

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(GEMINI_TTS_MODEL) + ":generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: input }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { languageCode: "hi-IN", ...speechConfig }
        }
      }),
      signal: AbortSignal.timeout(90000)
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(apiError(response.status, payload));
    error.status = response.status === 429 ? 429 : response.status >= 500 ? 502 : response.status;
    throw error;
  }

  const pcm = extractGeminiPcm(payload);
  if (!pcm || !pcm.length) {
    const error = new Error("Gemini TTS ने audio data नहीं लौटाया।");
    error.status = 502;
    throw error;
  }
  return pcm;
}

function mixPcmMono(primary, secondary, primaryGain = 0.72, secondaryGain = 0.28) {
  const primaryLength = primary.length - (primary.length % 2);
  const secondaryLength = secondary.length - (secondary.length % 2);
  const frameCount = Math.max(primaryLength, secondaryLength) / 2;
  const output = Buffer.alloc(frameCount * 2);

  for (let frame = 0; frame < frameCount; frame++) {
    const offset = frame * 2;
    const first = frame * 2 < primaryLength ? primary.readInt16LE(offset) : 0;
    const second = frame * 2 < secondaryLength ? secondary.readInt16LE(offset) : 0;
    const mixed = Math.max(-32768, Math.min(32767, Math.round(first * primaryGain + second * secondaryGain)));
    output.writeInt16LE(mixed, offset);
  }
  return output;
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

function devanagariIssues(scriptData) {
  const audienceText = [
    ["title", scriptData.title],
    ["hook", scriptData.hook],
    ["voiceover", scriptData.voiceover],
    ["cta", scriptData.cta],
    ...(scriptData.scenes || []).flatMap((scene, index) => [
      ["scene " + (index + 1) + " dialogue", scene.dialogue],
      ["scene " + (index + 1) + " subtitle", scene.subtitle],
      ...((scene.subtitle_segments || []).map((caption, captionIndex) =>
        ["scene " + (index + 1) + " caption " + (captionIndex + 1), caption]
      ))
    ])
  ];

  const acronymPattern = /\b(?:AI|PLR|CTA|MP4|SEO|TTS|API|USA|TV|OK|FAQ)\b/g;
  const issues = [];
  for (const [label, value] of audienceText) {
    if (typeof value !== "string" || !value.trim()) {
      issues.push(label + " is empty");
      continue;
    }
    const withoutAcronyms = value.replace(acronymPattern, "");
    const letters = withoutAcronyms.match(/\p{L}/gu) || [];
    if (letters.length < 8) continue;
    const devanagari = withoutAcronyms.match(/\p{Script=Devanagari}/gu) || [];
    const ratio = devanagari.length / letters.length;
    if (ratio < 0.58) issues.push(label + " is not predominantly Devanagari Hindi");
  }
  return issues;
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
    ttsModel: GEMINI_TTS_MODEL,
    imageGenerationEnabled: CLOUDFLARE_IMAGE_ENABLED,
    imageProvider: "Cloudflare Workers AI Free Tier",
    imageModel: CLOUDFLARE_IMAGE_MODEL,
    imageDailyLimit: CLOUDFLARE_IMAGE_DAILY_LIMIT,
    imageUsageToday: readImageUsage().count
  });
});

app.get("/api/brand/logo", (_req, res) => {
  try {
    const brand = JSON.parse(fs.readFileSync(BRAND_LOGO_META_FILE, "utf8"));
    if (!brand?.fileName || !fs.existsSync(path.join(OUTPUT_DIR, brand.fileName))) {
      return res.json({ ok: true, logo: null });
    }
    return res.json({
      ok: true,
      logo: {
        url: "/outputs/" + brand.fileName,
        mimeType: brand.mimeType,
        fileName: brand.fileName,
        updatedAt: brand.updatedAt
      }
    });
  } catch {
    return res.json({ ok: true, logo: null });
  }
});

app.post("/api/brand/logo", (req, res) => {
  const dataUrl = req.body?.dataUrl;
  if (typeof dataUrl !== "string") {
    return res.status(400).json({ error: "Logo image upload नहीं हुई।" });
  }

  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    return res.status(400).json({ error: "केवल PNG, JPG या WebP logo upload करें।" });
  }

  const mimeType = match[1];
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 1.5 * 1024 * 1024) {
    return res.status(413).json({ error: "Logo file 1.5 MB से छोटी रखें।" });
  }

  const validSignature =
    (mimeType === "image/png" && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mimeType === "image/jpeg" && buffer[0] === 0xff && buffer[1] === 0xd8) ||
    (mimeType === "image/webp" && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP");
  if (!validSignature) {
    return res.status(400).json({ error: "Logo file format सही नहीं है। PNG, JPG या WebP चुनें।" });
  }

  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  const fileName = "antardrishti-brand-logo." + extension;
  const previousName = (() => {
    try { return JSON.parse(fs.readFileSync(BRAND_LOGO_META_FILE, "utf8"))?.fileName || ""; }
    catch { return ""; }
  })();

  fs.writeFileSync(path.join(OUTPUT_DIR, fileName), buffer);
  if (previousName && previousName !== fileName) {
    fs.rmSync(path.join(OUTPUT_DIR, path.basename(previousName)), { force: true });
  }

  const logo = {
    fileName,
    mimeType,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(BRAND_LOGO_META_FILE, JSON.stringify(logo, null, 2), "utf8");
  res.json({
    ok: true,
    logo: {
      url: "/outputs/" + fileName,
      mimeType,
      fileName,
      updatedAt: logo.updatedAt
    }
  });
});

app.delete("/api/brand/logo", (_req, res) => {
  try {
    const logo = JSON.parse(fs.readFileSync(BRAND_LOGO_META_FILE, "utf8"));
    if (logo?.fileName) {
      fs.rmSync(path.join(OUTPUT_DIR, path.basename(logo.fileName)), { force: true });
    }
    fs.rmSync(BRAND_LOGO_META_FILE, { force: true });
  } catch { /* No saved brand logo. */ }
  res.json({ ok: true });
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
    sceneImages: [],
    voiceMode: "female",
    femaleVoice: DEFAULT_FEMALE_VOICE,
    maleVoice: DEFAULT_MALE_VOICE,
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
            visual_direction: { type: "string", description: "Internal visual-production prompt. English is allowed here; describe subject, setting, lighting, composition and action." },
            shot_type: { type: "string", description: "Choose a clear framing such as close-up, medium shot, wide shot, overhead or detail shot." },
            camera_movement: { type: "string", description: "Choose a practical movement such as static, slow push-in, pan, tilt or tracking; avoid complex impossible moves." },
            transition: { type: "string", description: "Describe a simple edit transition into the next scene, such as hard cut, dissolve, match cut or whip pan." },
            audio_cue: { type: "string", description: "Short music or sound-effect cue that supports the scene without competing with Hindi dialogue." },
            subtitle: { type: "string", description: "A short central idea subtitle in Devanagari Hindi." },
            subtitle_segments: {
              type: "array",
              description: "Three or four short Devanagari Hindi captions, in spoken order, each ideally 3 to 7 words. Together they should cover the scene dialogue, not add new claims.",
              items: { type: "string" }
            }
          },
          required: ["duration_sec", "dialogue", "visual_direction", "shot_type", "camera_movement", "transition", "audio_cue", "subtitle", "subtitle_segments"]
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
    "If the topic is typed in Roman Hindi, understand it and rewrite all audience-facing text in Devanagari Hindi.",
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
    "- Provide exactly 3 concise scenes. Each scene must include dialogue in Devanagari Hindi, a short subtitle in Devanagari Hindi, 3 or 4 sequential subtitle_segments in Devanagari Hindi, and a practical visual direction.",
    "- For every scene, specify shot_type, camera_movement, transition and audio_cue. Use simple production choices that can be executed in a lightweight vertical-video editor.",
    "- Each subtitle segment should be a natural spoken phrase of about 3–7 words. Keep the segments in the same order as the dialogue so they can appear one after another during that scene.",
    "- Do not put Scene 1, Scene 2, Scene 3, scene numbers, headings or labels in dialogue or subtitles.",
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
    "Before returning, check every audience-facing field. Hindi words must be in Devanagari, never Roman letters.",
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

    let languageIssues = devanagariIssues(scriptData);
    if (languageIssues.length) {
      // One short correction pass: keep the visual directions but rewrite all viewer-facing
      // Hindi copy into Devanagari before saving or showing it in the dashboard.
      const correction = await callGemini({
        model: GEMINI_TEXT_MODEL,
        input: [
          "Correct this video script. Its Hindi has been written in Roman letters.",
          "Rewrite title, hook, voiceover, every scene dialogue, every subtitle and CTA in natural Hindi using Devanagari script.",
          "Never use Roman Hindi. Common English words and acronyms may remain, but keep English below 10 percent.",
          "Keep visual_direction in English. Preserve the topic and meaning. Keep the selected duration and exactly 3 scenes.",
          "Return JSON only, following this schema: " + JSON.stringify(schema),
          "SCRIPT TO CORRECT:",
          JSON.stringify(scriptData)
        ].join("\\n"),
        response_format: { type: "text", mime_type: "application/json", schema },
        generation_config: { max_output_tokens: 1400 }
      });
      const correctedText = getModelText(correction);
      try {
        const corrected = JSON.parse(correctedText);
        if (corrected?.title && corrected?.voiceover && Array.isArray(corrected.scenes)) {
          const correctedIssues = devanagariIssues(corrected);
          if (!correctedIssues.length) scriptData = corrected;
          else languageIssues = correctedIssues;
        }
      } catch {
        // Keep the original validation issues and do not store uncorrected Roman Hindi.
      }
    }

    languageIssues = devanagariIssues(scriptData);
    if (languageIssues.length) {
      return res.status(422).json({
        error: "Script में कुछ Hindi text अभी भी Roman letters में है। Generate Script फिर दबाएँ। प्रभावित हिस्से: " + languageIssues.slice(0, 4).join(", ")
      });
    }

    const scriptIssues = validateScriptData(scriptData, job.duration);
    if (scriptIssues.length) {
      return res.status(422).json({
        error: "Generated script का production check पास नहीं हुआ: " + scriptIssues.slice(0, 5).join(" ")
      });
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

app.post("/api/jobs/:id/generate-scene-images", async (req, res) => {
  const { jobs, job } = findJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Video brief not found." });
  if (!CLOUDFLARE_IMAGE_ENABLED) {
    return res.status(403).json({
      error: "Cloudflare Workers AI free image API configured नहीं है। local .env में Cloudflare Account ID, API Token और CLOUDFLARE_IMAGE_ENABLED=true सेट करें; फिर server restart करें।"
    });
  }
  if (!job.scriptData || !Array.isArray(job.scriptData.scenes) || !job.scriptData.scenes.length) {
    return res.status(400).json({ error: "पहले video script generate करें।" });
  }

  const scenes = job.scriptData.scenes.slice(0, 5);
  const force = req.body?.force === true;
  const savedImages = Array.isArray(job.sceneImages) ? job.sceneImages : [];
  const results = [];
  const safeTopic = String(job.topic || "").replace(/[\r\n]+/g, " ").slice(0, 200);

  try {
    for (let index = 0; index < scenes.length; index++) {
      const existing = savedImages.find(item => item.sceneIndex === index && item.url);
      if (!force && existing && fs.existsSync(path.join(OUTPUT_DIR, path.basename(existing.url)))) {
        results.push(existing);
        continue;
      }

      const visualDirection = String(scenes[index].visual_direction || "").trim();
      const prompt = [
        "Create one premium, cinematic square still image to use as a clean background visual for a vertical 9:16 Hindi self-awareness video.",
        "Video topic: " + safeTopic,
        "Visual description: " + (visualDirection || "Create a calm, reflective scene that matches the video topic."),
        "Visual style: photorealistic cinematic photography, tasteful composition, natural light, restrained navy and warm neutral palette, detailed environment, emotionally calm and respectful.",
        "Composition: square image designed for a centered 9:16 crop. Keep the main subject exactly in the central 55 percent of the image width. If a person is shown, use a medium shot with the full head and face visible, centered, not cut off and not pushed to the edge. If an object is shown, show the whole object with clear margin. Leave the lower third calm and uncluttered for Hindi captions added later by the editor.",
        "IMPORTANT: The image must contain no writing at all. Do not draw words, letters, numbers, labels, signs, titles, headings, captions, subtitles, logos, watermarks, scene names, scene numbers, UI or borders.",
        "Do not write or depict the words Scene, Scene 1, Scene 2, Scene 3, or any numbered scene label.",
        "Avoid medical imagery, hospital scenes, distressed patients, diagnostic symbols, supernatural claims or frightening imagery.",
        "Create one coherent photograph, not a collage, storyboard, split panel, contact sheet or poster."
      ].join("\n");

      const generated = await generateCloudflareSceneImage(prompt);
      const extension = generated.mimeType.includes("jpeg") || generated.mimeType.includes("jpg")
        ? "jpg" : generated.mimeType.includes("webp") ? "webp" : "png";
      const fileName = job.id + "-scene-" + (index + 1) + "." + extension;
      fs.writeFileSync(path.join(OUTPUT_DIR, fileName), generated.buffer);
      const item = {
        sceneIndex: index,
        url: "/outputs/" + fileName,
        mimeType: generated.mimeType,
        model: CLOUDFLARE_IMAGE_MODEL,
        generatedAt: new Date().toISOString()
      };
      const priorIndex = savedImages.findIndex(image => image.sceneIndex === index);
      if (priorIndex >= 0) savedImages[priorIndex] = item;
      else savedImages.push(item);
      job.sceneImages = savedImages;
      job.updatedAt = new Date().toISOString();
      writeJobs(jobs);
      results.push(item);
    }

    job.sceneImages = savedImages.sort((a, b) => a.sceneIndex - b.sceneIndex);
    job.updatedAt = new Date().toISOString();
    writeJobs(jobs);
    res.json({ ok: true, job, sceneImages: job.sceneImages });
  } catch (error) {
    res.status(error.status || 502).json({
      error: error.message || "AI scene images generate नहीं हो पाईं।",
      generatedImages: results.length
    });
  }
});

app.post("/api/jobs/:id/convert-to-devanagari", async (req, res) => {
  const { jobs, job } = findJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Video brief not found." });

  const original = job.scriptData || {
    title: job.topic,
    hook: "",
    voiceover: job.script || "",
    scenes: [],
    cta: "",
    safety_note: ""
  };
  if (!original.voiceover && !(original.scenes || []).length) {
    return res.status(400).json({ error: "पहले इस video की script generate करें।" });
  }

  const schema = {
    type: "object",
    properties: {
      title: { type: "string" },
      hook: { type: "string" },
      voiceover: { type: "string" },
      scenes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            duration_sec: { type: "integer" },
            dialogue: { type: "string" },
            visual_direction: { type: "string" },
            shot_type: { type: "string" },
            camera_movement: { type: "string" },
            transition: { type: "string" },
            audio_cue: { type: "string" },
            subtitle: { type: "string" },
            subtitle_segments: { type: "array", items: { type: "string" } }
          },
          required: [
            "duration_sec", "dialogue", "visual_direction", "shot_type",
            "camera_movement", "transition", "audio_cue", "subtitle", "subtitle_segments"
          ]
        }
      },
      cta: { type: "string" },
      safety_note: { type: "string" }
    },
    required: ["title", "hook", "voiceover", "scenes", "cta", "safety_note"]
  };

  try {
    const payload = await callGemini({
      model: GEMINI_TEXT_MODEL,
      input: [
        "TASK: Convert the existing Hindi video script from Roman Hindi (Hinglish typed in English letters) into proper Devanagari Hindi.",
        "This is a transliteration and natural-Hindi correction task. Preserve the exact meaning, message, tone, facts, scene order, scene durations and number of scenes. Do not summarise or invent new content.",
        "All audience-facing fields must be written in Devanagari: title, hook, voiceover, each dialogue, each subtitle, all subtitle_segments and CTA.",
        "If a scene has no subtitle_segments, create 3 or 4 short sequential Devanagari captions from its dialogue. Do not add new claims.",
        "Do not return Roman Hindi. Keep a few genuinely English words/acronyms only when natural, such as AI or PLR. Convert Hindi words such as man, aap, kya, jaante, shakti, pehchanein into मन, आप, क्या, जानते, शक्ति, पहचानें.",
        "Keep visual_direction exactly as supplied; it is an internal prompt and may remain in English.",
        "Preserve each scene's existing shot_type, camera_movement, transition and audio_cue exactly where present. These are internal production notes and should remain concise English where originally written.",
        "If any production note is missing in an older script, fill only that missing note with a simple practical choice based on visual_direction; do not change notes that already exist.",
        "Keep scene order, scene count and each duration_sec unchanged. Return 3 or 4 non-empty subtitle_segments for every scene.",
        "Return only valid JSON matching this schema: " + JSON.stringify(schema),
        "EXISTING SCRIPT:",
        JSON.stringify(original)
      ].join("\n"),
      response_format: { type: "text", mime_type: "application/json", schema },
      generation_config: { max_output_tokens: 1600 }
    });

    const correctedText = getModelText(payload);
    if (!correctedText) return res.status(502).json({ error: "Hindi conversion से खाली response मिला।" });

    let corrected;
    try { corrected = JSON.parse(correctedText); }
    catch { return res.status(502).json({ error: "Hindi conversion का response सही JSON नहीं था। फिर कोशिश करें।" }); }

    if (!corrected.title || !corrected.voiceover || !Array.isArray(corrected.scenes)) {
      return res.status(502).json({ error: "Conversion में जरूरी script fields नहीं मिले।" });
    }

    const issues = devanagariIssues(corrected);
    if (issues.length) {
      return res.status(422).json({
        error: "कुछ हिस्से अभी भी Roman Hindi में हैं। Conversion दोबारा करें। प्रभावित हिस्से: " + issues.slice(0, 4).join(", ")
      });
    }

    const productionIssues = validateScriptData(corrected, job.duration);
    if (productionIssues.length) {
      return res.status(422).json({
        error: "Converted script का production check पास नहीं हुआ: " + productionIssues.slice(0, 5).join(" ")
      });
    }

    job.scriptData = corrected;
    job.script = corrected.voiceover;
    job.voiceFile = "";
    if (job.status === "approved" || job.status === "exported" || job.status === "published") {
      job.status = "review";
    } else {
      job.status = "script_ready";
    }
    job.updatedAt = new Date().toISOString();
    writeJobs(jobs);
    res.json({ ok: true, job });
  } catch (error) {
    res.status(error.status || 502).json({
      error: error.message || "देवनागरी conversion नहीं हो पाया।"
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

  const allowedModes = new Set(["female", "male", "duet", "mix"]);
  const voiceMode = allowedModes.has(req.body?.voiceMode) ? req.body.voiceMode
    : allowedModes.has(job.voiceMode) ? job.voiceMode : "female";
  const femaleVoice = FEMALE_TTS_VOICES.has(req.body?.femaleVoice) ? req.body.femaleVoice
    : FEMALE_TTS_VOICES.has(job.femaleVoice) ? job.femaleVoice : DEFAULT_FEMALE_VOICE;
  const maleVoice = MALE_TTS_VOICES.has(req.body?.maleVoice) ? req.body.maleVoice
    : MALE_TTS_VOICES.has(job.maleVoice) ? job.maleVoice : DEFAULT_MALE_VOICE;

  try {
    let pcm;
    let voiceModeLabel = "Female narrator";

    if (voiceMode === "female" || voiceMode === "male") {
      const voiceName = voiceMode === "female" ? femaleVoice : maleVoice;
      pcm = await generateGeminiTtsPcm(
        "Speak the following script in natural, warm, clear Indian Hindi. Use a calm, friendly educational narrator style, medium pace, and accurate Hindi pronunciation. Preserve the words; do not translate or add an introduction.\n\n" + narration,
        { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
      );
      voiceModeLabel = voiceMode === "female" ? "Female narrator · " + voiceName : "Male narrator · " + voiceName;
    } else if (voiceMode === "duet") {
      const dialogueSchema = {
        type: "object",
        properties: {
          turns: {
            type: "array",
            items: {
              type: "object",
              properties: {
                speaker: { type: "string", enum: ["Female", "Male"] },
                text: { type: "string" }
              },
              required: ["speaker", "text"]
            }
          }
        },
        required: ["turns"]
      };
      const dialoguePayload = await callGemini({
        model: GEMINI_TEXT_MODEL,
        input: [
          "Convert the following Hindi narration into a natural two-person spoken conversation for a short educational video.",
          "Create 6 to 8 concise turns. Alternate speakers, starting with Female, then Male. Use only the speaker labels Female and Male.",
          "Preserve every main idea and factual meaning. Do not add claims, statistics, advice or new information. Do not omit the main takeaway or call to action.",
          "Each turn's spoken text must be natural Hindi in Devanagari script. Never write Roman Hindi. Keep genuinely English words only when needed.",
          "Return JSON only with a turns array matching the schema.",
          "NARRATION:", narration
        ].join("\n"),
        response_format: { type: "text", mime_type: "application/json", schema: dialogueSchema },
        generation_config: { max_output_tokens: 1200 }
      });
      let dialogue;
      try { dialogue = JSON.parse(getModelText(dialoguePayload)); }
      catch {
        return res.status(502).json({ error: "Duet dialogue तैयार नहीं हो पाया। फिर कोशिश करें।" });
      }
      const turns = Array.isArray(dialogue?.turns) ? dialogue.turns : [];
      if (turns.length < 4 || turns.length > 10 || turns.some(turn =>
        !["Female", "Male"].includes(turn.speaker) ||
        typeof turn.text !== "string" || !turn.text.trim()
      )) {
        return res.status(502).json({ error: "Duet dialogue में speaker turns सही नहीं मिले। फिर कोशिश करें।" });
      }
      const languageIssues = [];
      turns.forEach((turn, index) => {
        const probe = {
          title: "जाँच",
          hook: "जाँच",
          voiceover: turn.text,
          cta: "जाँच",
          scenes: []
        };
        if (devanagariIssues(probe).length) languageIssues.push(index + 1);
      });
      if (languageIssues.length) {
        return res.status(422).json({ error: "Duet dialogue में कुछ Roman Hindi text मिला। फिर कोशिश करें।" });
      }

      const dialogueText = [
        "TTS the following natural Hindi conversation between a female and a male speaker.",
        "Use a calm, clear, warm Indian Hindi delivery. Speak only the words after each speaker label. Do not read the labels aloud.",
        ...turns.map(turn => turn.speaker + ": " + turn.text)
      ].join("\n");
      pcm = await generateGeminiTtsPcm(dialogueText, {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            { speaker: "Female", voiceConfig: { prebuiltVoiceConfig: { voiceName: femaleVoice } } },
            { speaker: "Male", voiceConfig: { prebuiltVoiceConfig: { voiceName: maleVoice } } }
          ]
        }
      });
      job.voiceoverTurns = turns;
      voiceModeLabel = "Duet · " + femaleVoice + " + " + maleVoice;
    } else {
      const [femalePcm, malePcm] = await Promise.all([
        generateGeminiTtsPcm(
          "Speak the following Hindi script in a calm, warm, clear Indian Hindi narrator style. Preserve the words exactly.\n\n" + narration,
          { voiceConfig: { prebuiltVoiceConfig: { voiceName: femaleVoice } } }
        ),
        generateGeminiTtsPcm(
          "Speak the following Hindi script in a calm, warm, clear Indian Hindi narrator style. Preserve the words exactly.\n\n" + narration,
          { voiceConfig: { prebuiltVoiceConfig: { voiceName: maleVoice } } }
        )
      ]);
      // Female voice is foreground; male voice is mixed underneath at a lower level.
      pcm = mixPcmMono(femalePcm, malePcm, 0.72, 0.28);
      voiceModeLabel = "Blended voices · " + femaleVoice + " + " + maleVoice;
    }

    const wav = pcmToWav(pcm, 24000);
    const safeFile = job.id + ".wav";
    fs.writeFileSync(path.join(OUTPUT_DIR, safeFile), wav);
    job.script = narration;
    if (job.scriptData) job.scriptData.voiceover = narration;
    job.voiceFile = "/outputs/" + safeFile;
    job.voiceMode = voiceMode;
    job.femaleVoice = femaleVoice;
    job.maleVoice = maleVoice;
    job.voiceModeLabel = voiceModeLabel;
    job.updatedAt = new Date().toISOString();
    writeJobs(jobs);
    res.json({
      ok: true,
      voiceFile: job.voiceFile,
      mimeType: "audio/wav",
      voiceMode: job.voiceMode,
      voiceModeLabel
    });
  } catch (error) {
    res.status(error.status || 502).json({
      error: error.name === "TimeoutError" || error.name === "AbortError"
        ? "Voice generation में समय लग गया। फिर कोशिश करें।"
        : error.message || "Gemini TTS से connect नहीं हो पाया।"
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
    for (const image of deletedJob.sceneImages || []) {
      if (image.url) fs.rmSync(path.join(OUTPUT_DIR, path.basename(image.url)), { force: true });
    }
  } catch { /* Ignore optional media cleanup errors. */ }
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
  if (["female", "male", "duet", "mix"].includes(req.body?.voiceMode)) job.voiceMode = req.body.voiceMode;
  if (FEMALE_TTS_VOICES.has(req.body?.femaleVoice)) job.femaleVoice = req.body.femaleVoice;
  if (MALE_TTS_VOICES.has(req.body?.maleVoice)) job.maleVoice = req.body.maleVoice;
  if (req.body?.scriptData && typeof req.body.scriptData === "object" && !Array.isArray(req.body.scriptData)) {
    job.scriptData = req.body.scriptData;
    if (typeof req.body.scriptData.voiceover === "string") job.script = req.body.scriptData.voiceover.slice(0, 30000);
  }
  job.updatedAt = new Date().toISOString();
  writeJobs(jobs);
  res.json(job);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Antardrishti Studio running on port " + PORT + " (local network enabled)");
});
