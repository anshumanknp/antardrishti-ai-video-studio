#!/usr/bin/env bash
set -euo pipefail

if [[ "\${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo bash scripts/oracle-bootstrap.sh" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git nginx ffmpeg fonts-noto-core certbot python3-certbot-nginx ufw

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

if ! id antardrishti >/dev/null 2>&1; then
  useradd --system --home-dir /opt/antardrishti --shell /usr/sbin/nologin antardrishti
fi

install -d -o antardrishti -g antardrishti -m 0750 /opt/antardrishti/app
install -d -o antardrishti -g antardrishti -m 0750 /var/lib/antardrishti
install -d -o antardrishti -g antardrishti -m 0750 /var/lib/antardrishti/data
install -d -o antardrishti -g antardrishti -m 0750 /var/lib/antardrishti/outputs
install -d -o root -g antardrishti -m 0750 /etc/antardrishti

echo
echo "Installed versions:"
node --version
npm --version
ffmpeg -version | head -n 1
echo
echo "Base server packages and persistent data folders are ready."
echo "Do not expose the app publicly until the Admin Login/security work is installed."
