# Antardrishti AI Video Studio

A separate, local-first workspace for planning and tracking Antardrishti short-video production.

## Product brief

- 30 short videos per month
- Selectable video lengths: 15, 30, 45 or 60 seconds, vertical 9:16
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

### Brand logo

- Open Script Studio and go to **Brand logo**.
- Choose a PNG, JPG or WebP image up to 1.5 MB, then select **Upload / Replace Logo**.
- A transparent PNG is recommended. The logo is saved locally in the project's `outputs/` folder and reused on future videos from this Studio.
- The renderer places the logo at the top-right inside the Reels-safe area. The logo is larger than the original starter layout. Use a compact, horizontal logo with a transparent background for the cleanest result.
- Use **Remove Logo** to delete the saved logo. The logo is separate from generated AI scene art, so it stays sharp and does not get distorted by the image model.

AI scene-image prompts explicitly ask for no words, lettering, numbers, labels, scene names or logos. The video renderer adds the scene caption and brand logo after the background image is generated. Existing scene images made with older prompts may still have unwanted lettering; use **Generate / Refresh Scene Images (Free API)** once to replace them.

### Scene production plan

Each generated scene now carries a production brief alongside its Hindi dialogue and captions:

- **Shot type:** framing such as close-up, medium shot or wide shot.
- **Camera movement:** a practical move such as static, slow push-in, pan or tracking.
- **Transition:** the edit into the next scene, using a simple cut, dissolve or match cut.
- **Audio cue:** a short music or sound-effect direction that stays behind the narration.

The server validates these fields before accepting a generated script. The image prompt uses the requested shot type, and the browser renderer applies simulated push-in, pull-out, pan and tilt moves to generated stills. A dissolve/cross-fade is applied when that transition is requested; hard cuts remain immediate. These are still-image camera effects, not real camera footage or character movement. Audio cues remain production notes; this version does not generate a separate music or sound-effect track.

### Video and subtitles

The current video builder uses animated gradient title cards and generated scene artwork. It starts narration at the opening, overlays the uploaded logo, shows each scene's main subtitle and its sequential Hindi caption segments (2–3 segments per scene for 15-second videos; 3–4 for longer videos), and creates a scene-timed Hindi `.srt` file. Shot framing and supported camera moves affect the rendered image. Content, logo and progress indicator stay inside a central Reels-safe region; the video preview has an optional Instagram UI/safe-area guide. The guide is preview-only and is not exported. MP4 or WebM output depends on browser support. Caption segments are timed evenly within each scene, not word-level forced alignment.

The Studio generates one AI image for each scene in the script. It uses 3 scenes for 15/30-second videos, 5 for 45 seconds and 6 for 60 seconds, then uses those images as full-bleed video backgrounds. It uses the `@cf/black-forest-labs/flux-1-schnell` model. Cloudflare's Free Workers plan includes 10,000 AI Neurons per day, shared across the account. The Studio adds its own hard limit of 100 generated images per UTC day and has no paid image-provider fallback. Visual directions are used as image prompts and are not printed as text over the scenes. AI presenter footage and generated cinematic video clips are separate future integrations.

### One-click automation

After Cloudflare is configured, open a video job and press **Auto Create Video (Free APIs)**. The Studio runs these steps in sequence:

1. Generate a Hindi script in Devanagari if one does not exist.
2. Save the reviewed script and the selected female, male or duet voice settings.
3. Generate the Hindi narration audio through Gemini TTS.
4. Generate missing scene images through Cloudflare Workers AI. Existing images are reused.
5. Render the vertical video with the voice, scene images and Hindi subtitles, then prepare the separate SRT download.

The script generator targets the selected length with duration-specific narration word ranges and scene counts. After TTS, the Studio measures the actual voice duration. Auto Create stops before spending image-generation quota when the narration differs from the selected length by more than 2 seconds or 8% (whichever is greater). The renderer uses the selected 15/30/45/60-second duration and blocks a large voice/video mismatch instead of exporting a short or cut-off reel. The automation also stops on an API or quota error and shows the failed step. It does not fall back to a paid provider. You still review the final video and decide when to publish it.

### Social media copy and Buffer queue

After a Hindi script is ready, open Script Studio and select **Generate Captions & Titles**. The Studio creates and saves separate copy for:
- Facebook caption with opening hook and hashtags
- Instagram Reel caption with opening hook and hashtags
- YouTube Shorts title and description with hashtags

Each field can be edited and copied independently. Script regeneration or Devanagari conversion clears the old social copy so it cannot accidentally be used with a different script.

#### Connect Buffer

1. In Buffer, open **Settings → API** and create a personal API key.
2. Put the key in your local `.env` file as `BUFFER_API_KEY=your_key`.
3. Keep the key private and never commit `.env` to GitHub.
4. Restart the Studio with `npm start`.
5. Open Script Studio and select **Connect / Refresh Buffer**. The app reads your Buffer organizations and connected Facebook, Instagram and YouTube channels.
6. Select a channel, provide a direct public HTTPS URL for the finished video, and select **Add Video to Buffer Queue**.

The Buffer API is available on Buffer Free and paid plans. Buffer's current Free API allowance is 1,000 requests per connected channel every 30 days, up to 3,000 total requests.

**Video hosting requirement:** Buffer's API does not provide a video-file upload endpoint. The video must first be hosted at a stable, direct, public HTTPS URL that remains available until the scheduled post publishes. A local `localhost` URL or a private Google Drive/Dropbox share link will not work. Cloudinary or a public Cloudflare R2 bucket can provide a suitable URL. The current integration accepts that URL in Script Studio; it does not upload the local video to a host automatically.

The Buffer integration adds Reels to the Facebook and Instagram queues, and a YouTube video post with a separate title and description. YouTube is set to Public and Education category by default. The AI-generated disclosure option is enabled by default for platforms that support it. Review every post in Buffer before its scheduled time.

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
