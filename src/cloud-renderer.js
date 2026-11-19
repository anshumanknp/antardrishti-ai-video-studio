import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { buildRenderedVideoFileName } from "./rendered-video.js";
import { getVideoVisualPlan } from "./visual-plan.js";

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;

function safeOutputPath(outputsDir, value, expectedPrefix = "") {
  const fileName = path.basename(String(value || "").split("?")[0]);
  if (!fileName || fileName === "." || fileName === "..") throw new Error("Render asset का file name सही नहीं है।");
  if (expectedPrefix && !fileName.startsWith(expectedPrefix)) throw new Error("Render asset इस video job से match नहीं करता।");
  const fullPath = path.resolve(outputsDir, fileName);
  if (!fullPath.startsWith(path.resolve(outputsDir) + path.sep)) throw new Error("Render asset outputs folder के बाहर है।");
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) throw new Error("Render asset नहीं मिली: " + fileName);
  return fullPath;
}

function secondsToSrt(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return [hours, minutes, secs].map(value => String(value).padStart(2, "0")).join(":") + "," + String(millis).padStart(3, "0");
}

function secondsToAss(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const wholeSeconds = Math.floor(value % 60);
  const centiseconds = Math.floor((value - Math.floor(value)) * 100);
  return hours + ":" + String(minutes).padStart(2, "0") + ":" + String(wholeSeconds).padStart(2, "0") + "." + String(centiseconds).padStart(2, "0");
}

function assText(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/[{}]/g, "").replace(/\r?\n/g, "\\N");
}

function splitCaptionRanges(captions, duration) {
  const safeCaptions = (Array.isArray(captions) ? captions : []).map(value => String(value || "").trim()).filter(Boolean);
  if (!safeCaptions.length) return [];
  const segmentDuration = duration / safeCaptions.length;
  return safeCaptions.map((text, index) => ({
    text,
    start: index * segmentDuration,
    end: index === safeCaptions.length - 1 ? duration : (index + 1) * segmentDuration
  }));
}

export function buildCloudRenderTimeline(job, outputsDir) {
  if (!job || !job.id) throw new Error("Video job नहीं मिली।");
  if (!job.scriptData || !Array.isArray(job.scriptData.scenes) || !job.scriptData.scenes.length) throw new Error("पहले Hindi video script तैयार करें।");
  const voiceFile = safeOutputPath(outputsDir, job.voiceFile, job.id + ".wav");
  const targetDuration = [15, 30, 45, 60].includes(Number(job.duration)) ? Number(job.duration) : 45;
  const voiceDuration = Number(job.voiceDurationSec);
  const totalDuration = Math.max(1, Math.min(120, Number.isFinite(voiceDuration) && voiceDuration > 0 ? voiceDuration + 0.15 : targetDuration));
  const introDuration = targetDuration <= 15 ? 1.2 : targetDuration <= 30 ? 1.8 : targetDuration <= 45 ? 2.2 : 2.5;
  const outroDuration = introDuration;
  const contentDuration = Math.max(0.5, totalDuration - introDuration - outroDuration);
  const scenes = job.scriptData.scenes.slice(0, 6);
  const totalWeight = scenes.reduce((sum, scene) => sum + Math.max(1, Number(scene.duration_sec || 5)), 0);
  const visualPlan = getVideoVisualPlan(targetDuration, scenes.length);
  const savedImages = Array.isArray(job.sceneImages) ? job.sceneImages : [];
  const slides = [{
    type: "intro",
    duration: introDuration,
    title: String(job.scriptData.title || job.topic || "Antardrishti"),
    body: String(job.scriptData.hook || "")
  }];
  const sceneCaptionEvents = [];
  let sceneCursor = introDuration;

  scenes.forEach((scene, sceneIndex) => {
    const sceneDuration = contentDuration * (Math.max(1, Number(scene.duration_sec || 5)) / totalWeight);
    const plan = visualPlan.scenes[sceneIndex] || { shotCount: 1, imageCount: 1 };
    const shotCount = Math.max(1, Number(plan.shotCount || 1));
    const imageCount = Math.max(1, Number(plan.imageCount || 1));
    const captions = Array.isArray(scene.subtitle_segments) && scene.subtitle_segments.length ? scene.subtitle_segments : [scene.subtitle || scene.dialogue || ""].filter(Boolean);
    const sceneImages = savedImages.filter(item => Number(item.sceneIndex) === sceneIndex);
    const shotDuration = sceneDuration / shotCount;

    for (let shotIndex = 0; shotIndex < shotCount; shotIndex++) {
      const variantIndex = shotIndex % imageCount;
      const selected = sceneImages.find(item => Number(item.variantIndex || 0) === variantIndex) || sceneImages[0] || null;
      const imagePath = selected?.url ? safeOutputPath(outputsDir, selected.url, job.id + "-scene-") : null;
      const captionStart = Math.min(Math.max(0, captions.length - 1), Math.floor(shotIndex * captions.length / shotCount));
      const captionEnd = Math.min(captions.length, Math.max(captionStart + 1, Math.floor((shotIndex + 1) * captions.length / shotCount)));
      const shotCaptions = captions.slice(captionStart, captionEnd);
      slides.push({
        type: "scene",
        duration: shotDuration,
        imagePath,
        sceneIndex,
        shotIndex,
        subtitle: shotIndex === 0 ? String(scene.subtitle || "") : "",
        captions: shotCaptions.length ? shotCaptions : [String(scene.subtitle || scene.dialogue || "")].filter(Boolean)
      });
      for (const range of splitCaptionRanges(shotCaptions, shotDuration)) {
        sceneCaptionEvents.push({ text: range.text, start: sceneCursor + range.start, end: sceneCursor + range.end, kind: "caption" });
      }
      if (shotIndex === 0 && scene.subtitle) {
        sceneCaptionEvents.push({ text: String(scene.subtitle), start: sceneCursor, end: sceneCursor + shotDuration, kind: "scene-subtitle" });
      }
      sceneCursor += shotDuration;
    }
  });

  slides.push({
    type: "outro",
    duration: outroDuration,
    title: "ANTARDRISHTI",
    body: String(job.scriptData.cta || "और जानने के लिए follow करें।")
  });

  const subtitleEvents = [
    { text: String(job.scriptData.hook || ""), start: 0.35, end: Math.max(0.65, introDuration - 0.1), kind: "intro" },
    ...sceneCaptionEvents,
    { text: String(job.scriptData.cta || "और जानने के लिए follow करें।"), start: totalDuration - outroDuration + 0.25, end: totalDuration - 0.05, kind: "outro" }
  ].filter(item => item.text.trim() && item.end > item.start);

  return {
    voiceFile, slides, totalDuration, introDuration, outroDuration, subtitleEvents,
    outputFile: buildRenderedVideoFileName(job.id, "mp4"),
    subtitleFile: "antardrishti-" + job.id + "-hi.srt"
  };
}

export function buildCloudSubtitleFiles(job, timeline) {
  const srt = timeline.subtitleEvents.map((item, index) =>
    (index + 1) + "\n" + secondsToSrt(item.start) + " --> " + secondsToSrt(item.end) + "\n" + item.text
  ).join("\n\n") + "\n";

  const events = [
    {
      start: 0, end: timeline.totalDuration, style: "Header",
      text: "{\\an7\\pos(78,110)\\c&H007BBDE0&}ANTARDRISHTI\\N{\\fs24\\c&H00D5DFEB&}आत्म-जागरूकता"
    },
    {
      start: 0.25, end: timeline.introDuration - 0.05, style: "Title",
      text: "{\\an7\\pos(78,600)\\c&H0078BDE2&}अपने लिए एक छोटा विराम\\N\\N{\\fs76\\c&H00F4F0E8&}" + assText(job.scriptData.title || job.topic)
    },
    ...timeline.subtitleEvents.filter(item => item.kind === "scene-subtitle").map(item => ({
      start: item.start, end: item.end, style: "SubTitle",
      text: "{\\an5\\pos(540,680)\\c&H0078BDE2&}" + assText(item.text)
    })),
    ...timeline.subtitleEvents.filter(item => item.kind === "caption" || item.kind === "intro" || item.kind === "outro").map(item => ({
      start: item.start, end: item.end, style: "Default",
      text: "{\\an5\\pos(540,1450)}" + assText(item.text)
    })),
    {
      start: timeline.totalDuration - timeline.outroDuration + 0.2,
      end: timeline.totalDuration - 0.05,
      style: "Title",
      text: "{\\an7\\pos(78,650)\\c&H0078BDE2&}ANTARDRISHTI\\N\\N{\\fs58\\c&H00F4F0E8&}" + assText(job.scriptData.cta || "और जानने के लिए follow करें।")
    }
  ].filter(item => item.end > item.start);

  const ass = [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920", "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Noto Sans Devanagari,48,&H00F5F1E9,&H000000FF,&H00101828,&H7808101C,1,0,0,0,100,100,0,0,1,3,1,2,78,78,300,1",
    "Style: Header,Noto Sans Devanagari,30,&H00E0BD7B,&H000000FF,&H00101828,&H00000000,1,0,0,0,100,100,0,0,1,2,0,7,0,0,0,1",
    "Style: Title,Noto Sans Devanagari,70,&H00F4F0E8,&H000000FF,&H00101828,&H00000000,1,0,0,0,100,100,0,0,1,3,1,7,0,0,0,1",
    "Style: SubTitle,Noto Sans Devanagari,42,&H00E2BD78,&H000000FF,&H00101828,&H00000000,1,0,0,0,100,100,0,0,1,2,0,5,0,0,0,1",
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events.map(item => "Dialogue: 0," + secondsToAss(item.start) + "," + secondsToAss(item.end) + "," + item.style + ",,0,0,0,," + item.text),
    ""
  ].join("\n");
  return { srt, ass };
}

function filterPath(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function runFfmpeg(ffmpegPath, args, totalDuration, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdoutBuffer = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("Server rendering में 30 मिनट से अधिक समय लगा।"));
    }, 30 * 60 * 1000);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    }
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        const match = line.match(/^out_time_(?:ms|us)=(\d+)$/);
        if (!match) continue;
        const seconds = Number(match[1]) / 1000000;
        if (Number.isFinite(seconds)) onProgress?.(Math.max(1, Math.min(99, Math.round(seconds / totalDuration * 100))));
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-6000); });
    child.on("error", error => finish(new Error("FFmpeg शुरू नहीं हो पाया: " + error.message)));
    child.on("close", code => {
      if (code === 0) finish();
      else finish(new Error("FFmpeg render fail हुआ (exit " + code + "): " + stderr.trim().slice(-1800)));
    });
  });
}

export async function renderJobWithFfmpeg(job, options = {}) {
  const outputsDir = path.resolve(options.outputsDir || "outputs");
  const dataDir = path.resolve(options.dataDir || "data");
  const ffmpegPath = options.ffmpegPath || process.env.FFMPEG_PATH || "ffmpeg";
  const timeline = buildCloudRenderTimeline(job, outputsDir);
  await fs.promises.mkdir(outputsDir, { recursive: true });
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "antardrishti-render-"));
  const assPath = path.join(tempDir, "captions.ass");
  const srtPath = path.join(tempDir, timeline.subtitleFile);
  const tempOutput = path.join(tempDir, "final.tmp.mp4");
  const finalOutput = path.join(outputsDir, timeline.outputFile);
  const finalSrt = path.join(outputsDir, timeline.subtitleFile);
  let logoPath = null;

  try {
    const subtitleFiles = buildCloudSubtitleFiles(job, timeline);
    await fs.promises.writeFile(assPath, subtitleFiles.ass, "utf8");
    await fs.promises.writeFile(srtPath, subtitleFiles.srt, "utf8");
    try {
      const logoMeta = JSON.parse(await fs.promises.readFile(path.join(dataDir, "brand-logo.json"), "utf8"));
      if (logoMeta?.fileName) logoPath = safeOutputPath(outputsDir, logoMeta.fileName);
    } catch { /* Logo is optional. */ }

    const args = ["-y", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats"];
    timeline.slides.forEach(slide => {
      if (slide.imagePath) args.push("-loop", "1", "-framerate", String(FPS), "-t", slide.duration.toFixed(3), "-i", slide.imagePath);
      else {
        const colour = slide.type === "scene" ? "172b42" : "0d1728";
        args.push("-f", "lavfi", "-i", "color=c=" + colour + ":s=" + WIDTH + "x" + HEIGHT + ":r=" + FPS + ":d=" + slide.duration.toFixed(3));
      }
    });
    const logoInputIndex = logoPath ? timeline.slides.length : -1;
    if (logoPath) args.push("-loop", "1", "-framerate", String(FPS), "-i", logoPath);
    const audioInputIndex = timeline.slides.length + (logoPath ? 1 : 0);
    args.push("-i", timeline.voiceFile);

    const filters = [];
    timeline.slides.forEach((slide, index) => {
      const zoom = slide.type === "scene" ? "zoompan=z='min(zoom+0.00025,1.04)':d=1:s=1080x1920:fps=30," : "";
      filters.push(
        "[" + index + ":v]scale=" + WIDTH + ":" + HEIGHT + ":force_original_aspect_ratio=increase," +
        "crop=" + WIDTH + ":" + HEIGHT + ",setsar=1,fps=" + FPS + "," + zoom +
        "trim=duration=" + slide.duration.toFixed(3) + ",setpts=PTS-STARTPTS,format=yuv420p[v" + index + "]"
      );
    });
    filters.push(timeline.slides.map((_, index) => "[v" + index + "]").join("") + "concat=n=" + timeline.slides.length + ":v=1:a=0[vcat]");
    filters.push("[vcat]ass=filename='" + filterPath(assPath) + "'[vsub]");
    if (logoPath) {
      filters.push("[" + logoInputIndex + ":v]format=rgba,scale=210:-1[brandlogo]");
      filters.push("[vsub][brandlogo]overlay=W-w-78:145:shortest=1,format=yuv420p[vout]");
    } else filters.push("[vsub]format=yuv420p[vout]");

    args.push(
      "-filter_complex", filters.join(";"), "-map", "[vout]", "-map", audioInputIndex + ":a:0",
      "-t", timeline.totalDuration.toFixed(3), "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
      "-pix_fmt", "yuv420p", "-r", String(FPS), "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
      "-movflags", "+faststart", "-threads", "2", tempOutput
    );

    await runFfmpeg(ffmpegPath, args, timeline.totalDuration, options.onProgress);
    const stat = await fs.promises.stat(tempOutput);
    if (stat.size < 1000) throw new Error("FFmpeg ने खाली MP4 बनाई।");
    await fs.promises.rm(finalOutput, { force: true });
    await fs.promises.rm(finalSrt, { force: true });
    await fs.promises.rename(tempOutput, finalOutput);
    await fs.promises.copyFile(srtPath, finalSrt);
    return {
      fileName: timeline.outputFile,
      subtitleFileName: timeline.subtitleFile,
      filePath: finalOutput,
      sizeBytes: stat.size,
      durationSec: Number(timeline.totalDuration.toFixed(2))
    };
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
