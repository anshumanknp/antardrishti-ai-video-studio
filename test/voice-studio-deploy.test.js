import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const compose = readFileSync(new URL("../deploy/voicestudio-compose.yml", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../deploy/voicestudio.Dockerfile", import.meta.url), "utf8");
const setup = readFileSync(new URL("../scripts/setup-voice-studio.sh", import.meta.url), "utf8");
const preflight = readFileSync(new URL("../scripts/check-voice-studio-host.sh", import.meta.url), "utf8");
const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

test("VoiceStudio image builds VoxCPM2 into the upstream CPU server image", () => {
  assert.match(dockerfile, /FROM ghcr\.io\/debpalash\/voicestudio:stable/);
  assert.match(dockerfile, /pip install --no-cache-dir "voxcpm>=2\.0\.3"/);
  assert.match(dockerfile, /OMNIVOICE_TTS_BACKEND=voxcpm2/);
  assert.match(dockerfile, /OMNIVOICE_VOXCPM_DEVICE=cpu/);
});

test("VoiceStudio compose binds its API to host loopback and persists model/profile data", () => {
  assert.match(compose, /127\.0\.0\.1:3900:3900/);
  assert.match(compose, /VOICE_STUDIO_API_KEY:\?Run scripts\/setup-voice-studio\.sh/);
  assert.match(compose, /voicestudio-data:\/app\/omnivoice_data/);
  assert.match(compose, /dockerfile: deploy\/voicestudio\.Dockerfile/);
  assert.doesNotMatch(compose, /0\.0\.0\.0:3900/);
});

test("setup requires explicit opt-in before AMD64 emulation on ARM64", () => {
  assert.match(setup, /aarch64\|arm64/);
  assert.match(setup, /VOICE_STUDIO_ALLOW_AMD64_EMULATION/);
  assert.match(setup, /DOCKER_DEFAULT_PLATFORM=linux\/amd64/);
  assert.match(setup, /exit 2/);
});

test("setup generates and stores a strong API key without printing it", () => {
  assert.match(setup, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(setup, /VOICE_STUDIO_API_KEY must be at least 32 characters/);
  assert.match(setup, /chmodSync\(path, 0o600\)/);
  assert.match(setup, /Secret values were not printed/);
  assert.doesNotMatch(setup, /console\.log\(key\)/);
});

test("host preflight checks CPU architecture, memory and free disk", () => {
  assert.match(preflight, /uname -m/);
  assert.match(preflight, /MemTotal/);
  assert.match(preflight, /16\*1024\*1024/);
  assert.match(preflight, /df -Pk/);
  assert.match(preflight, /15\*1024\*1024/);
});

test(".env example documents private VoiceStudio server settings", () => {
  assert.match(envExample, /^VOICE_STUDIO_BASE_URL=/m);
  assert.match(envExample, /^VOICE_STUDIO_API_KEY=/m);
  assert.match(envExample, /^VOICE_STUDIO_MODEL=voxcpm2$/m);
  assert.match(envExample, /^VOICE_STUDIO_VOXCPM_DEVICE=cpu$/m);
});
