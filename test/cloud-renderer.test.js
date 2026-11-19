import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
