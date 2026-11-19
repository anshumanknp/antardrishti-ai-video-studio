import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { renderJobWithFfmpeg } from "../src/cloud-renderer.js";
import { buildCloudRenderTimeline, buildCloudSubtitleFiles } from "../src/cloud-renderer.js";

test("builds a server render timeline from saved voice and scene images", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "antardrishti-render-test-"));
  try {
    const voice = "123e4567-e89b-12d3-a456-426614174000.wav";
    const image = "123e4567-e89b-12d3-a456-426614174000-scene-1-variant-1.png";
    fs.writeFileSync(path.join(dir, voice), "voice");
    fs.writeFileSync(path.join(dir, image), "image");
    const job = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      topic: "मन की शांति",
      duration: 15,
      voiceFile: "/outputs/" + voice,
      voiceDurationSec: 14.2,
      sceneImages: [{ sceneIndex: 0, variantIndex: 0, url: "/outputs/" + image }],
      scriptData: {
        title: "मन को समझें",
        hook: "क्या आपने कभी अपने मन को सुना है?",
        cta: "आज अपने लिए समय निकालें।",
        scenes: [{ duration_sec: 5, subtitle: "मन को समझना", subtitle_segments: ["मन को समझें", "खुद को समय दें"] }]
      }
    };
    const timeline = buildCloudRenderTimeline(job, dir);
    assert.equal(timeline.slides.length, 7);
    assert.equal(timeline.outputFile, "antardrishti-" + job.id + "-final.mp4");
    assert.ok(Math.abs(timeline.totalDuration - 14.35) < 0.01);
    assert.ok(timeline.slides.some(slide => slide.imagePath));
    const subtitles = buildCloudSubtitleFiles(job, timeline);
    assert.match(subtitles.srt, /मन को समझें/);
    assert.match(subtitles.ass, /Noto Sans Devanagari/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects scene image paths belonging to another job", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "antardrishti-render-test-"));
  try {
    const voice = "job-123.wav";
    fs.writeFileSync(path.join(dir, voice), "voice");
    const job = {
      id: "job-123",
      duration: 15,
      voiceFile: "/outputs/" + voice,
      scriptData: { scenes: [{ duration_sec: 5, subtitle_segments: ["परीक्षण"] }] },
      sceneImages: [{ sceneIndex: 0, url: "/outputs/other-job-scene-1.png" }]
    };
    assert.throws(() => buildCloudRenderTimeline(job, dir), /Render asset/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


const ffmpegProbe = spawnSync("ffmpeg", ["-filters"], { encoding: "utf8" });
const hasAssFilter = ffmpegProbe.status === 0 && /\bass\b/.test(ffmpegProbe.stdout || "");

test("FFmpeg creates a playable MP4 and Hindi SRT on the server", { skip: !hasAssFilter }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "antardrishti-ffmpeg-smoke-"));
  try {
    const jobId = "123e4567-e89b-12d3-a456-426614174000";
    const voiceFile = jobId + ".wav";
    const imageFile = jobId + "-scene-1-variant-1.png";
    execFileSync("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=24000:duration=3",
      "-c:a", "pcm_s16le", path.join(dir, voiceFile)
    ]);
    execFileSync("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=c=0x28405a:s=320x320:d=1",
      "-frames:v", "1", path.join(dir, imageFile)
    ]);
    const job = {
      id: jobId,
      topic: "मन की शांति",
      duration: 15,
      voiceFile: "/outputs/" + voiceFile,
      voiceDurationSec: 3,
      sceneImages: [{ sceneIndex: 0, variantIndex: 0, url: "/outputs/" + imageFile }],
      scriptData: {
        title: "मन को समझें",
        hook: "क्या आपने कभी अपने मन को सुना है?",
        cta: "आज अपने लिए समय निकालें।",
        scenes: [{ duration_sec: 5, subtitle: "मन को समझना", subtitle_segments: ["मन को समझें", "खुद को समय दें"] }]
      }
    };
    const result = await renderJobWithFfmpeg(job, { outputsDir: dir, dataDir: dir, ffmpegPath: "ffmpeg" });
    assert.ok(fs.statSync(path.join(dir, result.fileName)).size > 1000);
    assert.match(fs.readFileSync(path.join(dir, result.subtitleFileName), "utf8"), /मन को समझें/);
    const probe = execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", path.join(dir, result.fileName)
    ], { encoding: "utf8" });
    assert.ok(Number(probe.trim()) > 2.5);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
