import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { getVideoVisualPlan } from "./visual-plan.js";
import { buildRenderedVideoFileName } from "./rendered-video.js";

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const SAMPLE_RATE = 24000;
const BYTES_PER_SAMPLE = 2;

function safeOutputFile(outputDir, url) {
  const fileName = path.basename(String(url || ""));
  if (!fileName || fileName !== String(url).replace(/^.*[\\/]/, "")) return null;
  const absolute = path.resolve(outputDir, fileName);
  if (!absolute.startsWith(path.resolve(outputDir) + path.sep)) return null;
  return fs.existsSync(absolute) ? absolute : null;
}

function getVoiceDuration(job, outputDir) {
  const voicePath = safeOutputFile(outputDir, job.voiceFile);
  if (!voicePath) return { path: null, duration: null };
  const stat = fs.statSync(voicePath);
  if (stat.size < 44) throw new Error("Saved Hindi voice file is incomplete.");
  const header = Buffer.alloc(44);
  const fd = fs.openSync(voicePath, "r");
  try { fs.readSync(fd, header, 0, 44, 0); } finally { fs.closeSync(fd); }
  const sampleRate = header.readUInt32LE(24);
  const channels = header.readUInt16LE(22);
  const bits = header.readUInt16LE(34);
  if (header.toString("ascii", 0, 4) !== "RIFF" ||
      header.toString("ascii", 8, 12) !== "WAVE" ||
      sampleRate !== SAMPLE_RATE || channels !== 1 || bits !== 16) {
    throw new Error("Saved voice WAV format is not supported by the server renderer.");
  }
  return { path: voicePath, duration: Math.max(0.1, (stat.size - 44) / (SAMPLE_RATE * channels * BYTES_PER_SAMPLE)) };
}

function formatSrtTime(seconds) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const wholeSeconds = Math.floor((totalMs % 60000) / 1000);
  const milliseconds = totalMs % 1000;
  return [hours, minutes, wholeSeconds].map(value => String(value).padStart(2, "0")).join(":") +
    "," + String(milliseconds).padStart(3, "0");
}

function wrapText(value, maxCharacters, maxLines) {
  const words = String(value || "").replace(/\\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? line + " " + word : word;
    if (candidate.length > maxCharacters && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines).join("\\n");
}

export function buildServerRenderPlan(job, outputDir) {
  if (!job || !/^[a-z0-9_-]{1,80}$/i.test(String(job.id || ""))) {
    throw new TypeError("A valid video job is required for rendering.");
  }
  const scenes = job.scriptData?.scenes;
  if (!Array.isArray(scenes) || scenes.length < 1 || scenes.length > 6) {
    throw new Error("पहले valid Hindi video script और scene plan तैयार करें।");
  }

  const targetDuration = [15, 30, 45, 60].includes(Number(job.duration)) ? Number(job.duration) : 45;
  const voice = getVoiceDuration(job, outputDir);
  const introDuration = targetDuration <= 15 ? 1.2 : targetDuration <= 30 ? 1.8 : targetDuration <= 45 ? 2.2 : 2.5;
  const totalDuration = voice.duration ? voice.duration + 0.15 : targetDuration;
  const outroDuration = introDuration;
  const contentDuration = Math.max(0.5, totalDuration - introDuration - outroDuration);
  const totalWeight = scenes.reduce((sum, scene) => sum + Math.max(1, Number(scene.duration_sec || 5)), 0);
  const visualPlan = getVideoVisualPlan(targetDuration, scenes.length);
  const savedImages = Array.isArray(job.sceneImages) ? job.sceneImages : [];
  const slides = [{ type: "intro", duration: introDuration, title: job.scriptData.title || job.topic, body: job.scriptData.hook || "" }];
  const subtitleCues = [];
  let timelineCursor = introDuration;

  scenes.forEach((scene, sceneIndex) => {
    const sceneDuration = contentDuration * (Math.max(1, Number(scene.duration_sec || 5)) / totalWeight);
    const scenePlan = visualPlan.scenes[sceneIndex] || { shotCount: 1, imageCount: 1 };
    const shotCount = Math.max(1, Number(scenePlan.shotCount || 1));
    const captions = Array.isArray(scene.subtitle_segments) && scene.subtitle_segments.length
      ? scene.subtitle_segments.map(value => String(value || "").trim()).filter(Boolean)
      : [String(scene.subtitle || scene.dialogue || "").trim()].filter(Boolean);
    const images = savedImages.filter(image => Number(image.sceneIndex) === sceneIndex);

    for (let shotIndex = 0; shotIndex < shotCount; shotIndex++) {
      const variantCount = Math.max(1, Number(scenePlan.imageCount || 1));
      const variantIndex = shotIndex % variantCount;
      const selectedImage = images.find(image =>
        (Number.isInteger(Number(image.variantIndex)) ? Number(image.variantIndex) : 0) === variantIndex
      ) || images[0] || null;
      const captionStart = Math.min(Math.max(0, captions.length - 1), Math.floor(shotIndex * captions.length / shotCount));
      const captionEnd = Math.min(captions.length, Math.max(captionStart + 1, Math.floor((shotIndex + 1) * captions.length / shotCount)));
      const shotCaptions = captions.slice(captionStart, captionEnd);
      const duration = sceneDuration / shotCount;
      const imagePath = selectedImage?.url ? safeOutputFile(outputDir, selectedImage.url) : null;
      slides.push({
        type: "scene",
        sceneIndex,
        shotIndex,
        duration,
        imagePath,
        captions: shotCaptions.length ? shotCaptions : [captions.at(-1) || ""].filter(Boolean)
      });
      const activeCaptions = shotCaptions.length ? shotCaptions : [captions.at(-1) || ""].filter(Boolean);
      const segmentDuration = duration / Math.max(1, activeCaptions.length);
      activeCaptions.forEach((caption, captionIndex) => {
        if (!caption) return;
        const start = timelineCursor + captionIndex * segmentDuration;
        const end = timelineCursor + (captionIndex + 1) * segmentDuration;
        subtitleCues.push({ start, end, text: caption });
      });
      timelineCursor += duration;
    }
  });

  slides.push({ type: "outro", duration: outroDuration, title: "ANTARDRISHTI", body: job.scriptData.cta || "और जानने के लिए follow करें।" });

  return {
    jobId: job.id,
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    totalDuration,
    introDuration,
    outroDuration,
    voicePath: voice.path,
    slides,
    subtitleCues,
    introTitle: wrapText(job.scriptData.title || job.topic, 23, 4),
    introHook: wrapText(job.scriptData.hook || "", 32, 4),
    outroText: wrapText(job.scriptData.cta || "और जानने के लिए follow करें।", 30, 5)
  };
}

function escapeFilterValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,")
    .replace(/\[/g, "\\[").replace(/\]/g, "\\]").replace(/;/g, "\\;");
}

function writeTextFile(filePath, value) {
  fs.writeFileSync(filePath, String(value || ""), { encoding: "utf8", mode: 0o600 });
  return escapeFilterValue(filePath);
}

function createSubtitleFile(filePath, cues) {
  const body = cues.map((cue, index) =>
    String(index + 1) + "\\n" +
    formatSrtTime(cue.start) + " --> " + formatSrtTime(cue.end) + "\\n" +
    cue.text.replace(/[\\r\\n]+/g, " ")
  ).join("\\n\\n");
  fs.writeFileSync(filePath, body + (body ? "\\n" : ""), { encoding: "utf8", mode: 0o600 });
}

function runFfmpeg(ffmpegPath, args, duration, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdoutBuffer = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\\r?\\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        const match = line.match(/^out_time_ms=(\\d+)$/);
        if (match && duration > 0) {
          const seconds = Number(match[1]) / 1_000_000;
          const progress = Math.max(4, Math.min(96, Math.round((seconds / duration) * 92) + 4));
          onProgress?.(progress);
        }
      }
    });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-12000); });
    child.on("error", error => reject(new Error("FFmpeg start नहीं हो पाया: " + error.message)));
    child.on("close", code => {
      if (code === 0) return resolve();
      reject(new Error("FFmpeg render failed (exit " + code + "): " + stderr.slice(-3500)));
    });
  });
}

export async function renderServerVideo({
  job,
  outputDir,
  brandLogoPath = null,
  ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg",
  fontFile = process.env.ANTARDRISHTI_FONT_FILE || "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf",
  onProgress
}) {
  const plan = buildServerRenderPlan(job, outputDir);
  if (!fs.existsSync(fontFile)) {
    throw new Error("Hindi font नहीं मिली। Oracle पर fonts-noto-core install करें या ANTARDRISHTI_FONT_FILE सेट करें।");
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "antardrishti-render-" + randomUUID() + "-"));
  const videoFile = buildRenderedVideoFileName(job.id, "mp4");
  const outputPath = path.join(outputDir, videoFile);
  const subtitleFile = "antardrishti-" + job.id + "-hi.srt";
  const subtitlePath = path.join(outputDir, subtitleFile);
  const srtTempPath = path.join(workDir, "captions.srt");

  try {
    fs.mkdirSync(outputDir, { recursive: true });
    createSubtitleFile(srtTempPath, plan.subtitleCues);

    const args = ["-hide_banner", "-y", "-loglevel", "error"];
    for (const slide of plan.slides) {
      if (slide.imagePath) {
        args.push("-loop", "1", "-framerate", String(plan.fps), "-t", slide.duration.toFixed(3), "-i", slide.imagePath);
      } else {
        args.push("-f", "lavfi", "-i", "color=c=0x0d1728:s=" + plan.width + "x" + plan.height + ":r=" + plan.fps + ":d=" + slide.duration.toFixed(3));
      }
    }

    const hasLogo = Boolean(brandLogoPath && fs.existsSync(brandLogoPath));
    const logoIndex = plan.slides.length;
    if (hasLogo) args.push("-loop", "1", "-t", plan.totalDuration.toFixed(3), "-i", brandLogoPath);

    const hasVoice = Boolean(plan.voicePath);
    const audioIndex = plan.slides.length + (hasLogo ? 1 : 0);
    if (hasVoice) args.push("-i", plan.voicePath);

    const filters = [];
    const slideLabels = [];
    plan.slides.forEach((slide, index) => {
      let chain = "[" + index + ":v]";
      if (slide.imagePath) {
        chain += "scale=" + plan.width + ":" + plan.height + ":force_original_aspect_ratio=increase,crop=" +
          plan.width + ":" + plan.height + ",zoompan=z='min(zoom+0.0005,1.08)':d=1:s=" +
          plan.width + "x" + plan.height + ":fps=" + plan.fps + ",";
      }
      chain += "drawbox=c=black@0.38:t=fill,trim=duration=" + slide.duration.toFixed(3) +
        ",setpts=PTS-STARTPTS[v" + index + "]";
      filters.push(chain);
      slideLabels.push("[v" + index + "]");
    });
    filters.push(slideLabels.join("") + "concat=n=" + plan.slides.length + ":v=1:a=0[base]");

    let currentLabel = "base";
    let headerPath = writeTextFile(path.join(workDir, "header.txt"), "ANTARDRISHTI");
    filters.push("[" + currentLabel + "]drawtext=fontfile=" + escapeFilterValue(fontFile) +
      ":textfile=" + headerPath + ":expansion=none:fontcolor=0xE0BD7B:fontsize=34:x=76:y=250:shadowcolor=black@0.65:shadowx=2:shadowy=2[header]");
    currentLabel = "header";

    const taglinePath = writeTextFile(path.join(workDir, "tagline.txt"), "आत्म-जागरूकता");
    filters.push("[" + currentLabel + "]drawtext=fontfile=" + escapeFilterValue(fontFile) +
      ":textfile=" + taglinePath + ":expansion=none:fontcolor=0xD5DFEB:fontsize=27:x=78:y=305[tagline]");
    currentLabel = "tagline";

    const introTitlePath = writeTextFile(path.join(workDir, "intro-title.txt"), plan.introTitle);
    filters.push("[" + currentLabel + "]drawtext=fontfile=" + escapeFilterValue(fontFile) +
      ":textfile=" + introTitlePath + ":expansion=none:fontcolor=0xF4F0E8:fontsize=72:line_spacing=18:x=78:y=690:shadowcolor=black@0.65:shadowx=2:shadowy=2:enable='between(t,0.05," +
      Math.max(0.1, plan.introDuration - 0.05).toFixed(3) + ")'[introtitle]");
    currentLabel = "introtitle";

    const hookPath = writeTextFile(path.join(workDir, "intro-hook.txt"), plan.introHook);
    filters.push("[" + currentLabel + "]drawtext=fontfile=" + escapeFilterValue(fontFile) +
      ":textfile=" + hookPath + ":expansion=none:fontcolor=0xD5DFEB:fontsize=40:line_spacing=12:x=82:y=1090:shadowcolor=black@0.65:shadowx=2:shadowy=2:enable='between(t,0.05," +
      Math.max(0.1, plan.introDuration - 0.05).toFixed(3) + ")'[introhook]");
    currentLabel = "introhook";

    const outroStart = plan.totalDuration - plan.outroDuration;
    const outroPath = writeTextFile(path.join(workDir, "outro-text.txt"), plan.outroText);
    filters.push("[" + currentLabel + "]drawtext=fontfile=" + escapeFilterValue(fontFile) +
      ":textfile=" + outroPath + ":expansion=none:fontcolor=0xF4F0E8:fontsize=62:line_spacing=18:x=78:y=810:shadowcolor=black@0.65:shadowx=2:shadowy=2:enable='between(t," +
      outroStart.toFixed(3) + "," + plan.totalDuration.toFixed(3) + ")'[outrotext]");
    currentLabel = "outrotext";

    if (hasLogo) {
      filters.push("[" + logoIndex + ":v]scale=190:-1,format=rgba[brandlogo]");
      filters.push("[" + currentLabel + "][brandlogo]overlay=W-w-78:180:shortest=1[withlogo]");
      currentLabel = "withlogo";
    }

    const fontsDir = path.dirname(fontFile);
    filters.push("[" + currentLabel + "]subtitles=" + escapeFilterValue(srtTempPath) +
      ":fontsdir=" + escapeFilterValue(fontsDir) +
      ":force_style='FontName=Noto Sans Devanagari,FontSize=48,PrimaryColour=&H00F5F1E9,OutlineColour=&H9908171E,BorderStyle=1,Outline=3,Shadow=1,Alignment=2,MarginV=350'[vout]");

    args.push(
      "-filter_complex", filters.join(";"),
      "-map", "[vout]"
    );
    if (hasVoice) args.push("-map", audioIndex + ":a:0", "-af", "apad=pad_dur=0.15");
    args.push(
      "-t", plan.totalDuration.toFixed(3),
      "-r", String(plan.fps),
      "-c:v", "libx264",
      "-preset", process.env.FFMPEG_PRESET || "veryfast",
      "-crf", "24",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart"
    );
    if (hasVoice) args.push("-c:a", "aac", "-b:a", "128k");
    args.push("-progress", "pipe:1", "-nostats", outputPath);

    onProgress?.(3, "Preparing Hindi subtitles and video layers");
    await runFfmpeg(ffmpegPath, args, plan.totalDuration, progress => onProgress?.(progress, "Rendering MP4 on Oracle Cloud"));
    fs.copyFileSync(srtTempPath, subtitlePath);
    const stat = fs.statSync(outputPath);
    if (stat.size < 1000) throw new Error("FFmpeg ने valid MP4 file नहीं बनाई।");
    onProgress?.(100, "Video ready");
    return {
      videoFile,
      subtitleFile,
      mimeType: "video/mp4",
      sizeBytes: stat.size,
      durationSec: Number(plan.totalDuration.toFixed(2))
    };
  } catch (error) {
    fs.rmSync(outputPath, { force: true });
    fs.rmSync(subtitlePath, { force: true });
    throw error;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
