import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildServerRenderPlan } from "../src/server-renderer.js";

function temporaryOutput(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "antardrishti-render-plan-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function basicJob(overrides = {}) {
  return {
    id: "job-123",
    topic: "मन की शांति",
    duration: 15,
    scriptData: {
      title: "मन को शांत कैसे करें",
      hook: "कुछ पल खुद के लिए निकालें",
      cta: "ऐसी और जानकारी के लिए जुड़ें",
      scenes: [
        { duration_sec: 5, subtitle: "अपने विचारों को समझें", subtitle_segments: ["पहला विचार", "दूसरा विचार"], dialogue: "विचारों को देखें" },
        { duration_sec: 5, subtitle: "धीरे से साँस लें", subtitle_segments: ["धीरे से साँस लें"], dialogue: "साँस पर ध्यान दें" },
        { duration_sec: 5, subtitle: "खुद को समय दें", subtitle_segments: ["खुद को समय दें"], dialogue: "खुद को समय दें" }
      ]
    },
    sceneImages: [],
    voiceFile: "",
    ...overrides
  };
}

test("render plan makes intro, planned shots and outro", t => {
  const plan = buildServerRenderPlan(basicJob(), temporaryOutput(t));
  assert.equal(plan.slides[0].type, "intro");
  assert.equal(plan.slides.at(-1).type, "outro");
  assert.equal(plan.slides.filter(slide => slide.type === "scene").length, 5);
  assert.equal(plan.totalDuration, 15);
});

test("render plan distributes scene duration and subtitle timing across shots", t => {
  const plan = buildServerRenderPlan(basicJob(), temporaryOutput(t));
  const sceneSlides = plan.slides.filter(slide => slide.type === "scene");
  assert.ok(Math.abs(sceneSlides.reduce((sum, slide) => sum + slide.duration, 0) - (15 - 2.4)) < 0.001);
  assert.ok(plan.subtitleCues.length >= 3);
  assert.ok(plan.subtitleCues.every(cue => cue.start < cue.end));
  assert.ok(plan.subtitleCues[0].start >= plan.introDuration);
});

test("render plan rejects a missing or malformed script", t => {
  assert.throws(() => buildServerRenderPlan({ id: "job-1" }, temporaryOutput(t)), /valid Hindi video script/);
  assert.throws(() => buildServerRenderPlan(basicJob({ id: "../outside" }), temporaryOutput(t)), /valid video job/);
});

test("render plan uses actual saved WAV duration when available", t => {
  const outputDir = temporaryOutput(t);
  const wavPath = path.join(outputDir, "job-123.wav");
  const pcmBytes = 24000 * 2 * 6;
  const wav = Buffer.alloc(44 + pcmBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + pcmBytes, 4);
  wav.write("WAVE", 8);
  wav.writeUInt32LE(24000, 24);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt16LE(16, 34);
  fs.writeFileSync(wavPath, wav);
  const plan = buildServerRenderPlan(basicJob({ voiceFile: "/outputs/job-123.wav" }), outputDir);
  assert.equal(plan.voicePath, wavPath);
  assert.equal(plan.totalDuration, 6.15);
});
