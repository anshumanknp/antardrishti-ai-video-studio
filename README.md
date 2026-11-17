# Antardrishti AI Video Studio

A separate, local-first workspace for planning and tracking Antardrishti short-video production.

## Product brief

- 30 short videos per month
- 30–60 seconds, vertical 9:16
- Hindi-first language mix: about 90% Hindi and 10% English
- Natural Indian Hindi voice target
- Mixed format: AI presenter combined with cinematic generated visuals
- Hindi subtitles
- Manual review and approval before publishing
- Export approved MP4s for the existing Buffer workflow (Facebook, Instagram Professional and YouTube Shorts)

## Current starter scope

- Responsive dashboard with monthly target and production metrics
- Searchable and filterable production queue
- Video brief creation (topic, format, duration)
- Status tracking from brief created through review, approval and export
- Hindi-first content settings
- Mixed Presenter + Cinematic format option
- Explicit human approval workflow status

## Gemini-powered script, voice and slide workflow

1. Copy `.env.example` to a local file named `.env` in the repository root.
2. Add your Google AI Studio key after `GEMINI_API_KEY=`.
3. Keep `.env` private. It is ignored by Git; never paste the key into chat or commit it.
4. Restart the local server with `npm start`.
5. Add a video brief, then select **Open Studio** in the production queue.
6. Generate the Hindi-first Devanagari script, review/edit it, choose a voice style, and generate the voice.
7. Select **Create Slide Video** to make a vertical video in the browser. Download the video and the separate Hindi SRT subtitle file.

### Voice options

The Studio provides four modes:

- **Female narrator:** one selected female voice reads the full narration.
- **Male narrator:** one selected male voice reads the full narration.
- **Duet:** Gemini turns the narration into a short two-person Hindi dialogue. The female and male speakers alternate in one TTS generation.
- **Blend:** the same narration is generated separately with the selected female and male voices, then mixed into one WAV track. This uses two TTS requests and can sound deliberately layered.

Female voice choices: Kore, Aoede, Leda, Zephyr and Gacrux. Male voice choices: Orus, Puck, Charon, Algieba and Sadaltager. The available voice names and gender labels come from Google's Gemini TTS voice list.

### Video and subtitles

The current video builder uses animated gradients, shapes, title cards and scene subtitles. It adds the generated Hindi audio and can export MP4 or WebM depending on browser support. It also creates a separate scene-timed Hindi `.srt` file for use in an editor or publishing workflow.

The Studio can generate one AI image for each of the three scenes using Cloudflare Workers AI's free allocation, then use those images as full-bleed video backgrounds. It uses the `@cf/black-forest-labs/flux-1-schnell` model. Cloudflare's Free Workers plan includes 10,000 AI Neurons per day, shared across the account. The Studio adds its own hard limit of 100 generated images per UTC day and has no paid image-provider fallback. Visual directions are used as image prompts and are not printed as text over the scenes. AI presenter footage and generated cinematic video clips are separate future integrations.

### One-click automation

After Cloudflare is configured, open a video job and press **Auto Create Video (Free APIs)**. The Studio runs these steps in sequence:

1. Generate a Hindi script in Devanagari if one does not exist.
2. Save the reviewed script and the selected female, male or duet voice settings.
3. Generate the Hindi narration audio through Gemini TTS.
4. Generate missing scene images through Cloudflare Workers AI. Existing images are reused.
5. Render the vertical video with the voice, scene images and Hindi subtitles, then prepare the separate SRT download.

The automation stops on an API or quota error and shows the failed step. It does not fall back to a paid provider. You still review the final video and decide when to publish it.

### Configure Cloudflare free image generation

1. Create or sign in to a Cloudflare account and keep it on the Workers Free plan.
2. In the Cloudflare Dashboard, open **Workers AI** and select **Use REST API**.
3. Create a Workers AI API token using the dashboard template and copy the Account ID. The token needs Workers AI access.
4. Add these values to your local `.env` file in the project root:

```env
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_API_TOKEN=your_workers_ai_token
CLOUDFLARE_IMAGE_ENABLED=true
CLOUDFLARE_IMAGE_MODEL=@cf/black-forest-labs/flux-1-schnell
CLOUDFLARE_IMAGE_STEPS=4
```

5. Save the file and restart the app with `npm start`.

Keep the token private. Do not paste it into chat or commit it to GitHub. The image button stays disabled until the account ID, token and enabled flag are present. The current FLUX.1 Schnell endpoint does not accept a portrait-size parameter, so it generates a square image that the video renderer center-crops into 9:16. The image prompt keeps the main subject in the central crop-safe area.

## API models and usage

- Script and Duet dialogue: `gemini-3.1-flash-lite` (the server can try `gemini-3.5-flash-lite` after a temporary overload).
- Hindi narration: `gemini-3.1-flash-tts-preview` (Standard free tier).
- Optional scene images: Cloudflare Workers AI `@cf/black-forest-labs/flux-1-schnell` (free allocation; requires a Cloudflare Account ID and Workers AI API token).
- Duet uses Gemini's two-speaker TTS configuration.
- Blend makes two TTS requests and mixes their PCM audio into one WAV.

TTS requests can take longer than script generation. Blend uses about twice the TTS generation requests of a single voice. Cloudflare Workers AI's Free plan currently includes 10,000 Neurons per day, shared with other Workers AI usage in the same account. The Studio applies a conservative cap of 100 scene-image requests per UTC day and does not automatically switch to a paid image API. When the Cloudflare daily quota is exhausted, image generation stops until the quota resets. Check Cloudflare's current pricing and dashboard usage before production use. Gemini text and TTS free-tier access is also subject to quotas and can change. Do not send private client or therapy information to either API.

### Enable paid scene images (optional)

Leave these settings in the local `.env` file to keep image generation off:

```env
GEMINI_IMAGE_ENABLED=false
GEMINI_IMAGE_MODEL=gemini-3.1-flash-lite-image
```

Only when you explicitly decide to use paid image generation, change the first setting to `true` and restart the server. The **Generate AI Scene Images (Paid)** button then becomes available. It asks for confirmation before generating images. The server stores generated scene images in `outputs/`, reuses existing images unless a full refresh is confirmed, and deletes them when the related video job is deleted.

## Requirements

- Node.js 18.17 or newer

## Run on Windows

1. Open this repository folder in Command Prompt or PowerShell.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Run `npm start`.
5. Open http://localhost:3460

## Planned implementation

1. Add an AI presenter/avatar provider and support presenter shots between generated scenes.
2. Add optional AI-generated cinematic video clips after choosing a provider and checking its pricing, limits and commercial-use terms.
3. Improve subtitle timing beyond the current scene-level SRT and add optional caption styling.
4. Add reliable MP4 rendering and final export checks.
5. Keep preview, edit, regenerate and human-approval steps before publication.
6. Export approved videos for the existing Buffer workflow. Direct publishing stays out of scope until API access and permissions are confirmed.

## Content safety

Avoid claims that hypnotherapy or past-life regression can diagnose, cure, or replace medical/mental-health care. Present guided exercises accurately and encourage qualified professional support where appropriate.

## Security

Keep API keys in a local `.env` file or deployment secrets. Never commit credentials.
