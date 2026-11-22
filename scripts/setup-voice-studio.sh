#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Engine and Docker Compose v2 are required. Install them first."
  exit 1
fi

ARCH="$(uname -m)"
DOCKER_PLATFORM_ARGS=()
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
  touch .env
  chmod 600 .env
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

echo "Pulling VoiceStudio CPU image and starting the private sidecar..."
docker compose --env-file .env -f deploy/voicestudio-compose.yml pull
docker compose --env-file .env -f deploy/voicestudio-compose.yml up -d

echo "VoiceStudio container started. Waiting for its health check..."
for attempt in $(seq 1 36); do
  if docker compose --env-file .env -f deploy/voicestudio-compose.yml exec -T voicestudio curl -sf http://127.0.0.1:3900/health >/dev/null 2>&1; then
    echo "VoiceStudio health endpoint is responding."
    echo "Next: open VoiceStudio at http://127.0.0.1:3900 through an SSH tunnel, create your own clone profile, then return to Antardrishti."
    echo "Do not expose port 3900 publicly. The API key is stored only in .env."
    exit 0
  fi
  sleep 5
done

echo "VoiceStudio did not become healthy within 3 minutes."
echo "Check logs with: docker compose --env-file .env -f deploy/voicestudio-compose.yml logs --tail=150"
exit 1
