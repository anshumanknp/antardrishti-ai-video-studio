#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Antardrishti VoiceStudio host preflight"
echo "---------------------------------------"

if ! command -v docker >/dev/null 2>&1; then
  echo "BLOCKED: Docker is not installed."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "BLOCKED: Docker Compose v2 is not available."
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)
    echo "Architecture: $ARCH (native linux/amd64 image)"
    ;;
  aarch64|arm64)
    echo "Architecture: $ARCH (upstream VoiceStudio CPU image is linux/amd64 only)."
    echo "AMD64 emulation may work, but will be slower. Do not assume native ARM support."
    ;;
  *)
    echo "WARNING: Unverified architecture: $ARCH"
    ;;
esac

if [[ -r /proc/meminfo ]]; then
  MEM_KB="$(awk '/MemTotal:/ {print $2}' /proc/meminfo)"
  MEM_GB="$(awk -v kb="$MEM_KB" 'BEGIN {printf "%.1f", kb/1024/1024}')"
  echo "Host RAM: ${MEM_GB} GiB"
  if (( MEM_KB < 8*1024*1024 )); then
    echo "WARNING: Less than 8 GiB RAM. VoxCPM2 CPU inference may be impractical or fail."
  elif (( MEM_KB < 16*1024*1024 )); then
    echo "WARNING: Less than 16 GiB RAM. Keep other heavy workloads stopped during TTS."
  else
    echo "RAM check: no low-memory warning."
  fi
else
  echo "RAM check: unavailable on this operating system."
fi

AVAILABLE_KB="$(df -Pk . | awk 'NR==2 {print $4}')"
AVAILABLE_GB="$(awk -v kb="$AVAILABLE_KB" 'BEGIN {printf "%.1f", kb/1024/1024}')"
echo "Free disk: ${AVAILABLE_GB} GiB"
if (( AVAILABLE_KB < 15*1024*1024 )); then
  echo "WARNING: Less than 15 GiB free. Model downloads and Docker image layers may exhaust disk space."
fi

if [[ ! -f .env ]]; then
  echo "WARNING: .env is missing. Copy .env.example to .env before starting Antardrishti."
elif ! grep -q '^VOICE_STUDIO_API_KEY=.' .env; then
  echo "VoiceStudio key: not configured (setup script can generate it)."
else
  echo "VoiceStudio key: present in .env (value not displayed)."
fi

echo
echo "Preflight finished. This check does not install Docker or download the model."
