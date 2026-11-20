import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { renderServerVideo } from "../src/server-renderer.js";

const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobePath = process.env.FFPROBE_PATH || "ffprobe";
const fontFile = process.env.ANTRDRISHTI_FONT_FILE ||
  process.env.ANTARDRISHTI_FONT_FILE ||
  "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf";

function commandWorks(command, args) {
  const result = spawnSync(command, args, { stdio: "ignore", timeout: 5000 });
  return !result.error && result.status === 0;
}

const canRender = commandWorks(ffmpegPath, ["-version"]) &&
  commandWorks(ffprobePath, ["-version"]) &&
  fs.existsSync(fontFile);

function writeWav(filePath, durationSeconds) {
  const sampleRate = 24000;
  const samples = Math.round(sampleRate * durationSeconds);
  const pcm = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, pcm]));
}

function writePpm(filePath, rgb) {
  const pixels = Buffer.alloc(2 * 2 * 3);
  for (let offset = 0; offset < pixels.length; offset += 3) {
    pixels[offset] = rgb[0];
    pixels[offset + 1] = rgb[1];
    pixels[offset + 2] = rgb[2];
  }
  fs.writeFileSync(filePath, Buffer.concat([
    Buffer.from("P6\n2 2\n255\n", "ascii"),
    pixels
  ]));
}

test("FFmpeg creates a playable vertical MP4 with Hindi subtitles and narration", {
  skip: !canRender && "FFmpeg, ffprobe or the Noto Sans Devanagari font is unavailable"
}, async t => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "antardrishti-ffmpeg-smoke-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));

  const voiceFile = "render-smoke-voice.wav";
  writeWav(path.join(outputDir, voiceFile), 14.85);

  const colors = [[34, 74, 112], [103, 64, 43], [46, 94, 72]];
  const sceneImages = colors.map((rgb, sceneIndex) => {
    const fileName = "render-smoke-scene-" + sceneIndex + ".ppm";
    writePpm(path.join(outputDir, fileName), rgb);
    return { sceneIndex, variantIndex: 0, url: "/outputs/" + fileName };
  });

  const job = {
    id: "render-smoke-123",
    topic: "मन की शांति",
    duration: 15,
    voiceFile: "/outputs/" + voiceFile,
    sceneImages,
    scriptData: {
      title: "मन को शांत कैसे करें",
      hook: "कुछ पल खुद के लिए निकालें",
      cta: "ऐसी और जानकारी के लिए जुड़ें",
      scenes: [
        {
          duration_sec: 5,
          dialogue: "अपने विचारों को समझें।",
          subtitle: "अपने विचारों को समझें",
          subtitle_segments: ["अपने विचारों को समझें", "विचारों को पहचानें"]
        },
        {
          duration_sec: 5,
          dialogue: "धीरे से साँस लें।",
          subtitle: "धीरे से साँस लें",
          subtitle_segments: ["धीरे से साँस लें", "ध्यान केंद्रित करें"]
        },
        {
          duration_sec: 5,
          dialogue: "खुद को समय दें।",
          subtitle: "खुद को समय दें",
          subtitle_segments: ["खुद को समय दें", "शांत रहें"]
        }
      ]
    }
  };

  const progressUpdates = [];
  const result = await renderServerVideo({
    job,
    outputDir,
    ffmpegPath,
    fontFile,
    onProgress: (progress, stage) => progressUpdates.push({ progress, stage })
  });

  const outputPath = path.join(outputDir, result.videoFile);
  const subtitlePath = path.join(outputDir, result.subtitleFile);
  assert.ok(fs.existsSync(outputPath), "MP4 output should exist");
  assert.ok(fs.statSync(outputPath).size > 1000, "MP4 output should not be empty");
  assert.ok(fs.existsSync(subtitlePath), "SRT subtitle output should exist");
  assert.match(fs.readFileSync(subtitlePath, "utf8"), /अपने विचारों को समझें/);
  assert.ok(progressUpdates.some(item => item.progress === 100), "render should report 100%");

  const probe = spawnSync(ffprobePath, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-show_entries", "stream=codec_type,codec_name,width,height",
    "-of", "json",
    outputPath
  ], { encoding: "utf8", timeout: 15000 });
  assert.equal(probe.status, 0, probe.stderr || "ffprobe should read the MP4");
  const media = JSON.parse(probe.stdout);
  const video = media.streams.find(stream => stream.codec_type === "video");
  const audio = media.streams.find(stream => stream.codec_type === "audio");
  assert.equal(video?.codec_name, "h264");
  assert.equal(video?.width, 1080);
  assert.equal(video?.height, 1920);
  assert.equal(audio?.codec_name, "aac");
  assert.ok(Math.abs(Number(media.format.duration) - 15) < 0.4,
    "final MP4 duration should match the 15-second narration");

  assert.equal(result.mimeType, "video/mp4");
  assert.equal(result.durationSec, 15);
});
