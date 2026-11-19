import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { getVideoVisualPlan } from "./visual-plan.js";
import { buildRenderedVideoFileName } from "./rendered-video.js";

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;

function safeDuration(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(180, number) : fallback;
}

function seconds(value) {
  return Math.max(0.1, Number(value) || 0.1).toFixed(3);
}

function wrapText(value, maxCharacters = 25) {
  const words = String(value || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? line + " " + word : word;
    if (line && next.length > maxCharacters) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

function srtTime(value) {
  const totalMs = Math.max(0, Math.round(Number(value) * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const wholeSeconds = Math.floor((totalMs % 60000) / 1000);
  const milliseconds = totalMs % 1000;
  return [hours, minutes, wholeSeconds].map(item => String(item).padStart(2, "0")).join(":") +
    "," + String(milliseconds).padStart(3, "0");
}

function makeSrt(captions, duration, offset = 0) {
  const items = (Array.isArray(captions) ? captions : []).map(item => String(item || "").trim()).filter(Boolean);
  if (!items.length) return "";
  const segmentDuration = duration / items.length;
  return items.map((caption, index) =>
    String(index + 1) + "\n" +
    srtTime(offset + index * segmentDuration) + " --> " +
    srtTime(offset + (index + 1) * segmentDuration) + "\n" +
    wrapText(caption, 24)
  ).join("\n\n") + "\n";
}

function outputAssetPath(outputDir, publicUrl) {
  const fileName = path.basename(String(publicUrl || ""));
  if (!fileName || fileName === "." || fileName === "..") return "";
  const fullPath = path.join(outputDir, fileName);
  return fs.existsSync(fullPath) ? fullPath : "";
}

function filterPath(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function textFileFilter(fontPath, textPath, x, y, fontSize, color) {
  return "drawtext=fontfile='" + filterPath(fontPath) + "':textfile='" + filterPath(textPath) +
    "':x=" + x + ":y=" + y + ":fontsize=" + fontSize + ":fontcolor=" + color +
    ":line_spacing=18:expansion=none:borderw=2:bordercolor=black@0.45";
}

function writeTextFile(directory, name, text) {
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, String(text || ""), "utf8");
  return filePath;
}

function chooseFont() {
  const candidates = [
    process.env.ANTARDRISHTI_FONT_PATH,
    "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansDevanagari-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || "";
}

function runFfmpeg(args, options = {}) {
  const binary = process.env.FFMPEG_PATH || "ffmpeg";
  const progress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  const totalDuration = Math.max(0.1, Number(options.totalDuration) || 1);
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [
      "-hide_banner", "-loglevel", "error", "-y", "-progress", "pipe:1", "-nostats",
      ...args
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdoutBuffer = "";
    child.stdout.on("data", chunk => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        const match = line.match(/^out_time_ms=(\d+)/);
        if (match) {
          const elapsed = Number(match[1]) / 1000000;
          progress(Math.min(1, Math.max(0, elapsed / totalDuration)));
        }
      }
    });
    child.stderr.on("data", chunk => {
      stderr = (stderr + chunk.toString("utf8")).slice(-10000);
    });
    child.on("error", error => {
      if (error.code === "ENOENT") {
        reject(new Error("Oracle server पर FFmpeg install नहीं है। Deployment setup में ffmpeg और fonts-noto-core install करें।"));
      } else {
        reject(error);
      }
    });
    child.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error("FFmpeg rendering failed (exit " + code + "): " + (stderr.trim() || "No additional error details.")));
    });
  });
}

function buildSlides(job, outputDir) {
  const scenes = Array.isArray(job?.scriptData?.scenes) ? job.scriptData.scenes.slice(0, 6) : [];
  if (!scenes.length) throw new Error("पहले Hindi script और कम-से-कम एक scene तैयार करें।");

  const targetDuration = safeDuration(job.duration, 45);
  const voiceDuration = Number(job.voiceDurationSec);
  const totalDuration = Number.isFinite(voiceDuration) && voiceDuration > 0
    ? voiceDuration + 0.15
    : targetDuration;
  const introDuration = targetDuration <= 15 ? 1.2 : targetDuration <= 30 ? 1.8 : targetDuration <= 45 ? 2.2 : 2.5;
  const outroDuration = introDuration;
  const contentDuration = Math.max(0.5, totalDuration - introDuration - outroDuration);
  const totalWeight = scenes.reduce((sum, scene) => sum + Math.max(1, Number(scene.duration_sec) || 5), 0);
  const visualPlan = getVideoVisualPlan(targetDuration, scenes.length);
  const savedImages = Array.isArray(job.sceneImages) ? job.sceneImages : [];
  const slides = [{
    type: "intro",
    duration: introDuration,
    title: job.scriptData.title || job.topic || "Antardrishti",
    body: job.scriptData.hook || ""
  }];

  scenes.forEach((scene, sceneIndex) => {
    const sceneWeight = Math.max(1, Number(scene.duration_sec) || 5);
    const sceneDuration = contentDuration * (sceneWeight / totalWeight);
    const scenePlan = visualPlan.scenes[sceneIndex] || { shotCount: 1, imageCount: 1 };
    const shotCount = Math.max(1, Number(scenePlan.shotCount) || 1);
    const captions = Array.isArray(scene.subtitle_segments) && scene.subtitle_segments.length
      ? scene.subtitle_segments
      : [scene.subtitle || scene.dialogue || ""].filter(Boolean);
    const sceneImages = savedImages.filter(image => Number(image.sceneIndex) === sceneIndex);

    for (let shotIndex = 0; shotIndex < shotCount; shotIndex++) {
      const variantCount = Math.max(1, Number(scenePlan.imageCount) || 1);
      const variantIndex = shotIndex % variantCount;
      const selectedImage = sceneImages.find(image =>
        (Number.isInteger(Number(image.variantIndex)) ? Number(image.variantIndex) : 0) === variantIndex
      ) || sceneImages[0] || null;
      const captionStart = Math.min(Math.max(0, captions.length - 1), Math.floor(shotIndex * captions.length / shotCount));
      const captionEnd = Math.min(captions.length, Math.max(captionStart + 1, Math.floor((shotIndex + 1) * captions.length / shotCount)));
      const shotCaptions = captions.slice(captionStart, captionEnd);
      slides.push({
        type: "scene",
        duration: sceneDuration / shotCount,
        title: "SCENE " + String(sceneIndex + 1).padStart(2, "0") + " · SHOT " + String(shotIndex + 1),
        subtitle: shotIndex === 0 ? String(scene.subtitle || "") : "",
        captions: shotCaptions.length ? shotCaptions : [captions[captions.length - 1] || ""].filter(Boolean),
        imagePath: outputAssetPath(outputDir, selectedImage?.url)
      });
    }
  });

  slides.push({
    type: "outro",
    duration: outroDuration,
    title: "ANTARDRISHTI",
    body: job.scriptData.cta || "और जानने के लिए follow करें।"
  });

  let cursor = 0;
  const allSrt = [];
  slides.forEach(slide => {
    if (slide.type === "scene") {
      const srt = makeSrt(slide.captions, slide.duration, cursor);
      if (srt) allSrt.push(srt.trim());
    }
    cursor += slide.duration;
  });

  return { slides, totalDuration, srt: allSrt.join("\n\n") + (allSrt.length ? "\n" : "") };
}

function makeFilterGraph(slide, slideIndex, totalSlides, inputHasImage, hasLogo, slideSrtPath, textPaths, fontPath, tempDir) {
  const filters = [];
  if (inputHasImage) {
    filters.push(
      "scale=" + WIDTH + ":" + HEIGHT + ":force_original_aspect_ratio=increase",
      "crop=" + WIDTH + ":" + HEIGHT,
      "zoompan=z='min(zoom+0.00018,1.055)':d=1:s=" + WIDTH + "x" + HEIGHT + ":fps=" + FPS
    );
    filters.push("drawbox=c=black@0.38:t=fill");
  }
  filters.push(
    textFileFilter(fontPath, textPaths.brand, 76, 260, 30, "0xe0bd7b"),
    textFileFilter(fontPath, textPaths.tagline, 78, 308, 24, "0xd5dfeb"),
    "drawbox=x=78:y=375:w=842:h=3:color=0x8f7349:t=fill"
  );

  if (slide.type === "intro") {
    filters.push(textFileFilter(fontPath, textPaths.kicker, 78, 600, 32, "0xe2bd78"));
    filters.push(textFileFilter(fontPath, textPaths.title, 78, 760, 70, "0xf4f0e8"));
    filters.push(textFileFilter(fontPath, textPaths.body, 82, 1120, 44, "0xd5dfeb"));
  } else if (slide.type === "outro") {
    filters.push(textFileFilter(fontPath, textPaths.title, 78, 650, 50, "0xe4c488"));
    filters.push(textFileFilter(fontPath, textPaths.body, 78, 810, 62, "0xf4f0e8"));
  } else {
    if (textPaths.subtitle) filters.push(textFileFilter(fontPath, textPaths.subtitle, 78, 680, 38, "0xe2bd78"));
    if (slideSrtPath) {
      filters.push(
        "subtitles=filename='" + filterPath(slideSrtPath) + "':fontsdir='" +
        filterPath(path.dirname(fontPath)) +
        "':force_style='FontName=Noto Sans Devanagari,FontSize=25,PrimaryColour=&H00F5F1E9,OutlineColour=&H00101A2A,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=440'"
      );
    }
  }

  const progressWidth = Math.max(1, Math.round(760 * ((slideIndex + 1) / totalSlides)));
  filters.push("drawbox=x=78:y=1500:w=" + progressWidth + ":h=5:color=0xd8b576:t=fill");
  const base = filters.join(",");
  if (hasLogo) {
    return "[0:v]" + base + "[base];[1:v]scale=170:-1[logo];[base][logo]overlay=x=840:y=170:shortest=1,format=yuv420p[outv]";
  }
  return "[0:v]" + base + ",format=yuv420p[outv]";
}

async function renderOneSlide(slide, index, totalSlides, tempDir, outputDir, logoPath, fontPath, onProgress, progressStart, progressSpan) {
  const duration = seconds(slide.duration);
  const inputHasImage = Boolean(slide.imagePath);
  const hasLogo = Boolean(logoPath);
  const segmentFile = path.join(tempDir, "segment-" + String(index).padStart(3, "0") + ".mp4");
  const textPaths = {
    brand: writeTextFile(tempDir, "brand.txt", "ANTARDRISHTI"),
    tagline: writeTextFile(tempDir, "tagline.txt", "आत्म-जागरूकता"),
    kicker: writeTextFile(tempDir, "kicker.txt", "अपने लिए एक छोटा विराम"),
    title: writeTextFile(tempDir, "title-" + index + ".txt", wrapText(slide.title, slide.type === "intro" ? 23 : 26)),
    body: writeTextFile(tempDir, "body-" + index + ".txt", wrapText(slide.body, 24)),
    subtitle: slide.subtitle ? writeTextFile(tempDir, "subtitle-" + index + ".txt", wrapText(slide.subtitle, 25)) : ""
  };
  let slideSrtPath = "";
  if (slide.type === "scene" && Array.isArray(slide.captions) && slide.captions.length) {
    slideSrtPath = writeTextFile(tempDir, "captions-" + index + ".srt", makeSrt(slide.captions, slide.duration));
  }

  const args = [];
  if (inputHasImage) {
    args.push("-loop", "1", "-framerate", String(FPS), "-t", duration, "-i", slide.imagePath);
  } else {
    args.push("-f", "lavfi", "-i", "color=c=0x0d1728:s=" + WIDTH + "x" + HEIGHT + ":r=" + FPS + ":d=" + duration);
  }
  if (hasLogo) args.push("-loop", "1", "-framerate", String(FPS), "-t", duration, "-i", logoPath);

  const filterGraph = makeFilterGraph(
    slide, index, totalSlides, inputHasImage, hasLogo, slideSrtPath, textPaths, fontPath, tempDir
  );
  args.push(
    "-filter_complex", filterGraph,
    "-map", "[outv]",
    "-t", duration,
    "-an",
    "-r", String(FPS),
    "-c:v", "libx264",
    "-preset", process.env.ANTARDRISHTI_FFMPEG_PRESET || "ultrafast",
    "-crf", process.env.ANTARDRISHTI_FFMPEG_CRF || "24",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    segmentFile
  );

  await runFfmpeg(args, {
    totalDuration: slide.duration,
    onProgress: fraction => onProgress(progressStart + progressSpan * fraction)
  });
  if (!fs.existsSync(segmentFile) || fs.statSync(segmentFile).size < 1000) {
    throw new Error("FFmpeg ने scene " + (index + 1) + " की valid video file नहीं बनाई।");
  }
  return segmentFile;
}

export async function renderJobVideo(job, options = {}) {
  const outputDir = path.resolve(options.outputDir || "outputs");
  const dataDir = path.resolve(options.dataDir || "data");
  fs.mkdirSync(outputDir, { recursive: true });
  const fontPath = chooseFont();
  if (!fontPath) {
    throw new Error("Hindi font नहीं मिला। Oracle setup में fonts-noto-core install करें या ANTARDRISHTI_FONT_PATH set करें।");
  }

  const plan = buildSlides(job, outputDir);
  const tempDir = path.join(os.tmpdir(), "antardrishti-render-" + randomUUID());
  fs.mkdirSync(tempDir, { recursive: true });
  const brandMetaFile = path.join(dataDir, "brand-logo.json");
  let logoPath = "";
  try {
    const brand = JSON.parse(fs.readFileSync(brandMetaFile, "utf8"));
    logoPath = outputAssetPath(outputDir, brand?.fileName);
  } catch { /* Brand logo is optional. */ }

  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  const segmentFiles = [];
  const manifestFile = path.join(tempDir, "concat.txt");
  const silentVideo = path.join(tempDir, "silent.mp4");
  const temporaryOutput = path.join(tempDir, "final.mp4");
  const finalFileName = buildRenderedVideoFileName(job.id, "mp4");
  const finalPath = path.join(outputDir, finalFileName);
  const srtFileName = "antardrishti-" + job.id + "-hi.srt";
  const srtPath = path.join(outputDir, srtFileName);

  try {
    for (let index = 0; index < plan.slides.length; index++) {
      const start = 0.02 + (index / plan.slides.length) * 0.82;
      const span = 0.82 / plan.slides.length;
      const segment = await renderOneSlide(
        plan.slides[index], index, plan.slides.length, tempDir, outputDir, logoPath,
        fontPath, onProgress, start, span
      );
      segmentFiles.push(segment);
    }

    fs.writeFileSync(manifestFile, segmentFiles.map(file =>
      "file '" + file.replace(/'/g, "'\\''") + "'"
    ).join("\n") + "\n", "utf8");

    await runFfmpeg([
      "-f", "concat", "-safe", "0", "-i", manifestFile,
      "-c", "copy", "-movflags", "+faststart", silentVideo
    ], {
      totalDuration: plan.totalDuration,
      onProgress: fraction => onProgress(0.84 + 0.08 * fraction)
    });

    if (plan.srt) fs.writeFileSync(srtPath, plan.srt, "utf8");
    else fs.rmSync(srtPath, { force: true });

    const voicePath = outputAssetPath(outputDir, job.voiceFile);
    if (voicePath) {
      await runFfmpeg([
        "-i", silentVideo, "-i", voicePath,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-t", seconds(plan.totalDuration),
        "-movflags", "+faststart",
        temporaryOutput
      ], {
        totalDuration: plan.totalDuration,
        onProgress: fraction => onProgress(0.92 + 0.07 * fraction)
      });
    } else {
      fs.copyFileSync(silentVideo, temporaryOutput);
      onProgress(0.99);
    }

    const stat = fs.statSync(temporaryOutput);
    if (stat.size < 1000) throw new Error("Final MP4 खाली है या सही तरह से नहीं बनी।");
    fs.copyFileSync(temporaryOutput, finalPath);
    onProgress(1);
    return {
      fileName: finalFileName,
      mimeType: "video/mp4",
      sizeBytes: fs.statSync(finalPath).size,
      srtFile: plan.srt ? srtFileName : "",
      durationSec: Number(plan.totalDuration.toFixed(2))
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
