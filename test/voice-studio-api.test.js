import test from "node:test";
import assert from "node:assert/strict";
import {
  generateVoiceStudioSpeech,
  getVoiceStudioConfig,
  getVoiceStudioStatus,
  inspectWav,
  listVoiceStudioProfiles
} from "../src/voice-studio-api.js";

function makeWav({ sampleRate = 48000, channels = 1, bitsPerSample = 16, durationSec = 2 } = {}) {
  const bytesPerSample = bitsPerSample / 8;
  const data = Buffer.alloc(Math.round(sampleRate * durationSec) * channels * bytesPerSample);
  const wav = Buffer.alloc(44 + data.length);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + data.length, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  wav.writeUInt16LE(channels * bytesPerSample, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(data.length, 40);
  data.copy(wav, 44);
  return wav;
}

const env = {
  VOICE_STUDIO_BASE_URL: "https://voice.example.test",
  VOICE_STUDIO_API_KEY: "test-secret",
  VOICE_STUDIO_MODEL: "voxcpm2"
};

test("VoiceStudio config adds the OpenAI-compatible /v1 path", () => {
  const config = getVoiceStudioConfig(env);
  assert.equal(config.configured, true);
  assert.equal(config.baseUrl, "https://voice.example.test/v1");
  assert.equal(config.model, "voxcpm2");
  assert.equal(config.apiKey, "test-secret");
});

test("VoiceStudio config accepts a complete /v1 URL and local HTTP", () => {
  assert.equal(
    getVoiceStudioConfig({ VOICE_STUDIO_BASE_URL: "https://voice.example.test/v1/", VOICE_STUDIO_API_KEY: "test-secret" }).baseUrl,
    "https://voice.example.test/v1"
  );
  const local = getVoiceStudioConfig({ VOICE_STUDIO_BASE_URL: "http://127.0.0.1:3900" });
  assert.equal(local.configured, true);
  assert.equal(local.apiKey, "");
});

test("remote VoiceStudio refuses plaintext HTTP and missing API keys", () => {
  assert.match(
    getVoiceStudioConfig({ VOICE_STUDIO_BASE_URL: "http://voice.example.test" }).reason,
    /HTTPS/
  );
  assert.match(
    getVoiceStudioConfig({ VOICE_STUDIO_BASE_URL: "https://voice.example.test" }).reason,
    /VOICE_STUDIO_API_KEY/
  );
});

test("missing VoiceStudio configuration is reported without exposing credentials", async () => {
  const status = await getVoiceStudioStatus({ env: {} });
  assert.equal(status.configured, false);
  assert.equal(status.available, false);
  assert.equal(status.model, "voxcpm2");
  assert.match(status.message, /VOICE_STUDIO_BASE_URL/);
});

test("status checks engine availability and counts saved voice profiles", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/models")) {
      return new Response(JSON.stringify({ data: [{ id: "voxcpm2" }, { id: "omnivoice" }] }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({
      voices: [
        { voice_id: "profile123", name: "Administrator clone", type: "profile", language: "hi" },
        { voice_id: "alloy", name: "Alloy", type: "openai_alias" }
      ]
    }), { headers: { "Content-Type": "application/json" } });
  };
  const status = await getVoiceStudioStatus({ env, fetchImpl });
  assert.equal(status.available, true);
  assert.equal(status.modelAvailable, true);
  assert.equal(status.profileCount, 1);
  assert.match(calls[0].options.headers.get("Authorization"), /^Bearer /);
});

test("profile list returns only saved clone profiles", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    voices: [
      { voice_id: "profile123", name: "My cloned voice", type: "profile", language: "hi", addressable_by_name: true },
      { voice_id: "alloy", name: "Alloy", type: "openai_alias" }
    ]
  }), { headers: { "Content-Type": "application/json" } });
  const profiles = await listVoiceStudioProfiles({ env, fetchImpl });
  assert.deepEqual(profiles, [{
    id: "profile123",
    name: "My cloned voice",
    language: "hi",
    addressableByName: true
  }]);
});

test("speech request uses selected clone, VoxCPM2, style instructions and WAV", async () => {
  const wav = makeWav({ durationSec: 2.5 });
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(wav, { headers: { "Content-Type": "audio/wav" } });
  };
  const result = await generateVoiceStudioSpeech({
    text: "नमस्कार। आज हम मन की शांति पर बात करेंगे।",
    voiceId: "profile123",
    instructions: "Speak calmly and thoughtfully.",
    env,
    fetchImpl
  });
  assert.equal(request.url, "https://voice.example.test/v1/audio/speech");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.get("Authorization"), "Bearer test-secret");
  assert.equal(request.body.model, "voxcpm2");
  assert.equal(request.body.voice, "profile123");
  assert.equal(request.body.instructions, "Speak calmly and thoughtfully.");
  assert.equal(request.body.response_format, "wav");
  assert.equal(result.mimeType, "audio/wav");
  assert.equal(result.sampleRate, 48000);
  assert.equal(result.durationSec, 2.5);
  assert.deepEqual(result.buffer, wav);
});

test("speech request rejects missing clone profile and excessive script length", async () => {
  await assert.rejects(
    generateVoiceStudioSpeech({ text: "नमस्कार", voiceId: "", env, fetchImpl: async () => { throw new Error("should not call"); } }),
    /cloned voice/
  );
  await assert.rejects(
    generateVoiceStudioSpeech({ text: "क".repeat(4097), voiceId: "profile123", env, fetchImpl: async () => { throw new Error("should not call"); } }),
    /4,096/
  );
});

test("malformed and truncated WAV responses are rejected", () => {
  assert.throws(() => inspectWav(Buffer.from("not audio")), /invalid WAV/);
  const wav = makeWav();
  assert.throws(() => inspectWav(wav.subarray(0, 44)), /truncated WAV/);
});

test("upstream failures return a safe, readable error without credentials", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    error: { message: "Engine voxcpm2 is not installed." }
  }), {
    status: 400,
    headers: { "Content-Type": "application/json" }
  });
  await assert.rejects(
    generateVoiceStudioSpeech({ text: "नमस्कार", voiceId: "profile123", env, fetchImpl }),
    error => error.status === 400 && /not installed/.test(error.message) && !/test-secret/.test(error.message)
  );
});
