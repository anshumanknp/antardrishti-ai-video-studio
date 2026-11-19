# Oracle Cloud deployment plan

## Current milestone

This repository includes a server-side FFmpeg renderer and a persistent single-worker render queue. The mobile browser submits a render request; the Oracle service continues rendering after the browser tab is closed. The dashboard can poll the saved render state when reopened.

The current renderer expects job assets in the configured outputs folder:
- voice WAV: <job-id>.wav
- generated scenes: <job-id>-scene-*
- optional logo: the file recorded in data/brand-logo.json

It creates an MP4 and a separate Hindi SRT file. FFmpeg must include the ass/libass filter and the Noto Devanagari font package must be installed.

## Important security gate

The current application does not yet have Admin Login or API authorization. Do not expose the application to the public internet until the authentication and authorization milestone is merged and tested. Keep port 3460 private and use the reverse proxy only after that gate is complete.

## 1. Create the Oracle VM

Recommended starting configuration:
- Ubuntu 24.04 LTS (or the currently available supported Ubuntu LTS image)
- Ampere A1, 2 OCPU and 12 GB RAM if the Always Free allocation is available in the account's home region
- Boot volume sized to fit within the account's Always Free total block-volume allocation
- Public IPv4 address
- SSH key authentication only

Oracle can report insufficient host capacity in a home region. Free-tier availability and account eligibility must be confirmed in the Oracle console. The Always Free instance may be reclaimed if it meets Oracle's published idle-instance criteria.

## 2. Install server packages

Run the bootstrap script on the VM:

    sudo bash scripts/oracle-bootstrap.sh

The script installs Node.js 22, FFmpeg, Noto fonts, Nginx, Certbot and creates a dedicated antardrishti service user plus persistent data folders.

## 3. Put application code on the VM

Place the repository contents in:

    /opt/antardrishti/app

Then install dependencies:

    cd /opt/antardrishti/app
    npm install --omit=dev
    npm run build
    npm test

Do not copy .env into the Git repository. Create the server environment file separately:

    sudo nano /etc/antardrishti/studio.env

Use the project's .env.example as the key list. Add the real Gemini, Cloudflare, Buffer and Cloudinary values directly on the VM. Never put secrets in GitHub commits, issue comments or screenshots.

## 4. Configure persistent storage and service

The systemd template is deploy/antardrishti.service. Install it, then enable the service:

    sudo cp deploy/antardrishti.service /etc/systemd/system/antardrishti.service
    sudo systemctl daemon-reload
    sudo systemctl enable --now antardrishti
    sudo systemctl status antardrishti

The service stores jobs in /var/lib/antardrishti/data and generated files in /var/lib/antardrishti/outputs, separate from replaceable application code.

Useful diagnostics:

    sudo journalctl -u antardrishti -f
    ffmpeg -filters | grep -E 'ass|subtitles'
    fc-list | grep -i 'Noto Sans Devanagari'

## 5. Configure domain and HTTPS

Create an A record for the chosen studio subdomain pointing to the Oracle VM public IPv4. Copy deploy/nginx-studio.conf.example to /etc/nginx/sites-available/antardrishti, replace studio.example.com, enable it, test it and reload Nginx:

    sudo ln -s /etc/nginx/sites-available/antardrishti /etc/nginx/sites-enabled/antardrishti
    sudo nginx -t
    sudo systemctl reload nginx

After DNS resolves, enable TLS:

    sudo certbot --nginx -d studio.example.com

Keep Oracle ingress rules limited to SSH (22), HTTP (80) and HTTPS (443). Do not open port 3460 to the internet.

## 6. Backups and validation

Before launch, configure a daily backup of /var/lib/antardrishti/data and /var/lib/antardrishti/outputs to a separate storage target. Test a restore to a temporary directory. A backup on the same boot volume is not a disaster-recovery backup.

Run at least one 15-second and one 60-second video through the server renderer. Verify MP4 playback, Devanagari fonts, subtitle timing, logo placement, page-close recovery, server-restart recovery and Buffer upload.

## 7. GitHub deployment

For the first launch, deploy a reviewed commit manually. Automatic GitHub-to-Oracle deployment should be enabled only after the service, login gate, backup and rollback path are tested. Use a dedicated deploy key and GitHub Actions secrets; never store SSH private keys in repository files.
