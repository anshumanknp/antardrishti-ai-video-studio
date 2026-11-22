#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Engine and Docker Compose v2 are required. Install them first."
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)
    echo "Using VoiceStudio's native linux/amd64 CPU image."
    ;;
  aarch64|arm64)
    if [[ "${VOICE_STUDIO_ALLOW_AMD64_EMULATION:-0}" != "1" ]]; then
      cat <<'EOF'
This host is ARM64. The upstream VoiceStudio CPU Docker image currently has
no native ARM64 manifest. AMD64 emulation is possible on some Docker hosts,
but may be much slower for VoxCPM2.

To explicitly accept emulation, run:
  VOICE_STUDIO_ALLOW_AMD64_EMULATION=1 bash scripts/setup-voice-studio.sh

For better performance, use an x86_64 server or a supported GPU host.
EOF
      exit 2
    fi
    echo "ARM64 host: enabling explicit linux/amd64 emulation."
    export DOCKER_DEFAULT_PLATFORM=linux/amd64
    ;;
  *)
    echo "Unsupported or unverified CPU architecture: $ARCH"
    exit 2
    ;;
esac

if [[ ! -f .env ]]; then
  echo ".env is missing. Copy .env.example to .env and add your existing Gemini/Cloudflare/Buffer settings first."
  exit 1
fi

node --input-type=module <<'NODE'
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";

const path = ".env";
let content = readFileSync(path, "utf8");
const updates = {
  VOICE_STUDIO_BASE_URL: "http://127.0.0.1:3900",
  VOICE_STUDIO_MODEL: "voxcpm2",
  VOICE_STUDIO_VOXCPM_DEVICE: "cpu"
};
const findValue = (key) => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp("^" + escaped + "=(.*)$", "m"));
  return match ? match[1].trim() : null;
};
let key = findValue("VOICE_STUDIO_API_KEY");
if (!key) {
  key = randomBytes(32).toString("base64url");
  updates.VOICE_STUDIO_API_KEY = key;
} else if (key.length < 32) {
  throw new Error("VOICE_STUDIO_API_KEY must be at least 32 characters. Remove the weak value and rerun setup.");
}
for (const [name, value] of Object.entries(updates)) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp("^" + escaped + "=.*$", "m");
  if (matcher.test(content)) content = content.replace(matcher, name + "=" + value);
  else content += (content.endsWith("\n") || content.length === 0 ? "" : "\n") + name + "=" + value + "\n";
}
writeFileSync(path, content, { mode: 0o600 });
chmodSync(path, 0o600);
console.log("Private VoiceStudio settings saved in .env. Secret values were not printed.");
NODE

if ! grep -q '^VOICE_STUDIO_API_KEY=.' .env; then
  echo "VOICE_STUDIO_API_KEY was not saved. Check .env permissions."
  exit 1
fi

echo "Checking available RAM and disk before downloading the VoiceStudio image..."
bash scripts/check-voice-studio-host.sh

echo "Building the VoiceStudio image with VoxCPM2 and starting the private sidecar..."
docker compose --env-file .env -f deploy/voicestudio-compose.yml build
docker compose --env-file .env -f deploy/voicestudio-compose.yml up -d

echo "VoiceStudio container started. Waiting for its health check..."
for attempt in $(seq 1 36); do
  if docker compose --env-file .env -f deploy/voicestudio-compose.yml exec -T voicestudio curl -sf http://127.0.0.1:3900/health >/dev/null 2>&1; then
    echo "VoiceStudio health endpoint is responding."
    if docker compose --env-file .env -f deploy/voicestudio-compose.yml exec -T voicestudio python3 -c 'import json,urllib.request; d=json.load(urllib.request.urlopen("http://127.0.0.1:3900/v1/models",timeout=10)); assert any(x.get("id")=="voxcpm2" for x in d.get("data",[])), "VoxCPM2 is not listed as available"' >/dev/null 2>&1; then
      echo "VoxCPM2 is listed as available."
    else
      echo "The server is up, but VoxCPM2 is not yet listed as an available engine."
      echo "Check build/runtime logs before creating a clone profile:"
      echo "docker compose --env-file .env -f deploy/voicestudio-compose.yml logs --tail=150"
      exit 1
    fi
    echo "Next: access VoiceStudio privately, create your own clone profile, then restart Antardrishti so it reloads the .env values."
    echo "Do not expose port 3900 publicly. The API key is stored only in .env."
    exit 0
  fi
  sleep 5
done

echo "VoiceStudio did not become healthy within 3 minutes."
echo "Check logs with: docker compose --env-file .env -f deploy/voicestudio-compose.yml logs --tail=150"
exit 1
