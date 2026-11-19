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
7. Select **Render on Cloud** to send the video to the server-side render queue. The server creates the MP4 and separate Hindi SRT file; you can close the mobile browser while the render continues.

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

AI scene-image prompts explicitly ask for no words, lettering, numbers, labels, scene names or logos. The video renderer adds the scene caption and brand logo after the background image is generated. Existing scene images made with older prompts may still have unwanted lettering; use **Generate Missing AI Images** once to replace them.

### Scene production plan

Each generated scene now carries a production brief alongside its Hindi dialogue and captions:

- **Shot type:** framing such as close-up, medium shot or wide shot.
- **Camera movement:** a practical move such as static, slow push-in, pan or tracking.
- **Transition:** the edit into the next scene, using a simple cut, dissolve or match cut.
- **Audio cue:** a short music or sound-effect direction that stays behind the narration.

The server validates these fields before accepting a generated script. The image prompt uses the requested shot type. The cloud renderer applies a slow zoom to generated stills. These are still-image camera effects, not real camera footage or character movement. A dissolve/cross-fade is applied when that transition is requested; hard cuts remain immediate. These are still-image camera effects, not real camera footage or character movement. Audio cues remain production notes; this version does not generate a separate music or sound-effect track.

### Video and subtitles

Video rendering runs on the server through FFmpeg, not in the mobile browser. It creates a 1080×1920 MP4, mixes the saved Hindi voice, applies the uploaded logo and Devanagari captions, and writes a separate scene-timed Hindi `.srt` file. Caption segments are timed evenly within each scene, not word-level forced alignment. The current server renderer uses a slow zoom on still images; it does not create real moving footage.

**Cloud render queue:** Pressing Render on Cloud creates a persistent render job. The server runs one render at a time by default, saves progress and recovers queued/interrupted jobs after restart. Closing the mobile browser does not stop the render. Reopening Script Studio shows the saved render status or restores the finished MP4. Changing the script, voice or scene artwork while a render is running causes the stale output to be rejected.

The Studio uses a duration-based visual plan rather than generating a single image per scene. The current plan is 5 visual shots / 4 AI images for 15 seconds, 8 / 6 for 30 seconds, 10 / 8 for 45 seconds and 13 / 10 for 60 seconds. Extra visual shots reuse an existing scene image with a different crop and simulated camera move, so they do not trigger another image request. Only missing planned images are generated. The gallery also has a per-image regenerate action; it replaces only that selected image. The `@cf/black-forest-labs/flux-1-schnell` model creates square stills that the renderer crops to 9:16. Cloudflare's 10,000 AI Neurons/day Free allocation is shared across the account. The Studio applies a separate safety cap of 30 image requests per UTC day; this app cap is not a measurement of Cloudflare Neurons. There is no paid image-provider fallback. AI presenter footage and real generated cinematic video clips remain separate future integrations.

### One-click automation

After Cloudflare is configured, open a video job and press **Auto Create Video (Free APIs)**. The Studio runs these steps in sequence:

1. Generate a Hindi script in Devanagari if one does not exist.
2. Save the reviewed script and the selected female, male or duet voice settings.
3. Generate the Hindi narration audio through Gemini TTS.
4. Generate missing scene images through Cloudflare Workers AI. Existing images are reused.
5. Render the vertical video with the voice, scene images and Hindi subtitles, then prepare the separate SRT download.

The script generator treats the selected 15/30/45/60-second length as a target and uses duration-specific narration word ranges and scene counts. After TTS, the Studio measures the actual voice duration. When a voice file exists, the renderer sets the final video length from the decoded narration duration (plus a short 0.15-second audio tail) and scales the intro, scene and outro timings to fit it. For example, a 13.8-second voice produces a video of about 14 seconds even when the selected target was 15 seconds; a slightly longer voice is also allowed to finish without being cut off. If no voice file exists, the renderer falls back to the selected duration. The automation still stops on an API or quota error and shows the failed step. It does not fall back to a paid provider. You still review the final video and decide when to publish it.

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
6. Review the final video and all three platform-copy fields. In the main dashboard, change the job status to **Approved** only after that review.
7. In Script Studio, select **Connect / Refresh Buffer**. The first Facebook, Instagram and YouTube channel (if connected) is selected by default. Adjust the checkboxes if needed.
8. Generate the Social Media Content Pack. It contains separate Facebook and Instagram captions, a YouTube Shorts title and SEO description, hashtags, and 8–12 YouTube SEO keyword suggestions. Review the copy and approve the final video in the dashboard.
9. In the Buffer Publishing panel, choose an optional date/time for each selected channel. The time is interpreted in that Buffer channel's configured timezone. Leave a channel's date/time blank to use its next available Buffer queue slot.
10. Select **Queue / Schedule Selected Channels**. The Studio uploads the rendered video to Cloudinary automatically the first time, saves its permanent HTTPS URL to the job, and creates a separate Buffer post for each selected channel. No manual video URL or repeated upload is needed.

### Publishing Centre and Buffer sync

Open **Publishing Centre** from the dashboard navigation. It retrieves Buffer posts for the connected organizations, including status, scheduled date, sent date, channel and publishing error message. It compares Buffer post IDs with Antardrishti's local queue records and shows failed or unverified Studio attempts separately.

Each new **Queue to Selected Channels** batch is saved locally before the Buffer requests start. The Studio records an individual outcome for every channel, including failures and successful Buffer Post IDs. The latest 100 queue batches per video job are retained in the local job record.

The tracker sync reads up to 20 pages of 50 posts per organization, covering a two-year history window. Buffer keeps sent and failed posts for two years; older sent or failed posts may no longer be available from its API. If the page cap is reached, the tracker warns that the returned list is incomplete. Scheduled dates are displayed using the Buffer channel's configured timezone.

The tracker sync does not create, edit or delete posts. The Publishing Calendar shows posts by scheduled date in each channel's timezone; selecting a day filters the records below. From a post row, only a post whose Buffer status is **Scheduled** can be rescheduled or cancelled. Rescheduling uses Buffer's custom schedule mode; cancellation deletes the scheduled post from Buffer after confirmation. Published, failed and unverified posts do not expose those actions. A local post ID that is not returned in the sync is labelled **Not found in sync**, not automatically treated as deleted; verify its Buffer ID and history window before retrying to avoid duplicates.

### One-time Cloudinary setup for automatic video hosting

Buffer's API does not accept a local MP4 upload. The Studio therefore uploads the rendered video to Cloudinary before creating Buffer posts.

1. Create or sign in to a Cloudinary account and open **Console Settings → Upload → Upload Presets**.
2. Create an upload preset and set **Signing Mode** to **Unsigned**. Give it a name such as `antardrishti_buffer_video`.
3. Restrict **Allowed formats** to `mp4,webm`, set an upload folder such as `antardrishti`, and keep uploaded videos publicly deliverable. An unsigned preset name can be used by anyone who knows it, so restrict formats and rotate the preset if it is exposed.
4. Add an **eager video transformation** that produces MP4/H.264 from WebM. Configure it to run synchronously so the MP4 URL is included in the upload response. This matters when the browser can render only WebM.
5. Add the Cloudinary **Cloud name** and unsigned **Upload preset name** to the local `.env` file:

```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_UPLOAD_PRESET=antardrishti_buffer_video
```

6. Save `.env` and restart the Studio with `npm start`. Select **Connect / Refresh Buffer** again. The note should confirm that Cloudinary is ready.

The cloud name and unsigned preset name are not API secrets, but the preset enables unauthenticated uploads. Do not use an unrestricted preset. Never put the Cloudinary API secret in browser code, chat or GitHub.

The dashboard gives AI caption generation up to 70 seconds, Cloudinary upload up to 3 minutes, and Buffer queue submission up to 110 seconds. Server-side Buffer calls time out after 25 seconds each. A timeout is shown as an error instead of leaving a button spinning indefinitely. For diagnosis, read the PowerShell window running `npm start`: failures are labelled `[social-copy]`, `[buffer-status]`, `[buffer-queue]` or `[buffer-queue-all]`.

The Studio keeps the Cloudinary URL with the job, so retries reuse the same hosted video. If the script, platform copy, voice or scene images change after approval, the job returns to review and the old hosted URL is cleared. Review and approve the new content before queueing again.

The server only queues a job whose status is exactly **Approved**. The Studio creates separate posts per selected channel and records each success. It blocks duplicate posting of the same video to the same channel. If one channel fails, successful channels remain queued and the result lists the failures so only those can be retried. A successful queue action means Buffer accepted the scheduled post; it does not mean the post has already published.

The Buffer API is available on Buffer Free and paid plans. Limits vary by plan and can change; see the [official rate limits](https://developers.buffer.com/guides/api-limits.html).

**YouTube SEO limitation:** Buffer's YouTube API input accepts a title and description but does not expose YouTube's separate native video-tags field. Antardrishti generates and stores 8–12 relevant keyword suggestions and includes the main search phrases naturally in the title and description. It does not claim to send native YouTube tags through Buffer. Hashtags are included in the description. See the [Buffer YouTube metadata fields](https://developers.buffer.com/types/YoutubePostMetadataInput.html).

Buffer requires public direct HTTPS media URLs that remain available until publication. Cloudinary supplies this hosted media URL. See Buffer's [media hosting guide](https://developers.buffer.com/guides/hosting-media.html).

The Buffer integration queues Reels to Facebook and Instagram and a YouTube video post with a separate title and description. YouTube is set to Public and Education category by default. The AI-generated disclosure option is enabled by default where supported. Review all scheduled posts in Buffer before their queue time.

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

- Script, Duet dialogue and social copy: `gemini-3.8-flash` (the server automatically tries `gemini-3.1-flash-lite` and `gemini-3.5-flash-lite` when a temporary capacity error occurs).
- Hindi narration: `gemini-3.1-flash-tts-preview` (Standard free tier).
- Optional scene images: Cloudflare Workers AI `@cf/black-forest-labs/flux-1-schnell` (free allocation; requires a Cloudflare Account ID and Workers AI API token).
- Duet uses Gemini's two-speaker TTS configuration.
- Blend makes two TTS requests and mixes their PCM audio into one WAV.

TTS requests can take longer than script generation. Blend uses about twice the TTS generation requests of a single voice. Cloudflare Workers AI's Free plan currently includes 10,000 Neurons per day, shared with other Workers AI usage in the same account. The Studio applies its own safety cap of 30 image requests per UTC day and does not automatically switch to a paid image API. When the Cloudflare daily quota is exhausted, image generation stops until the quota resets. Check Cloudflare's current pricing and dashboard usage before production use. Gemini text and TTS free-tier access is also subject to quotas and can change. Do not send private client or therapy information to either API.

### Image provider and quota controls

Scene images use Cloudflare Workers AI FLUX Schnell when `CLOUDFLARE_IMAGE_ENABLED=true` and the local `.env` contains a valid Cloudflare Account ID and API token. Keep the flag set to `false` to disable image generation. The Studio does not call a paid image fallback.

The image gallery generates only missing planned assets and offers a separate **Regenerate this image** action for one selected asset. The application has its own safety cap of 30 successful image requests per UTC day. This is separate from Cloudflare's account-wide Neurons allocation and does not predict or measure Neuron consumption.

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


### Oracle Cloud deployment

The deployment starter files are in docs/oracle-cloud-deployment.md, scripts/oracle-bootstrap.sh and deploy/. The app supports external persistent folders through DATA_DIR and OUTPUT_DIR; the systemd template uses /var/lib/antardrishti/. Install Node.js 22, FFmpeg and Noto Devanagari fonts on the VM.

**Security gate:** this repository version does not yet include Admin Login or API authorization. Do not expose the app publicly until that work is complete and tested. Keep the Node port private behind Nginx.
