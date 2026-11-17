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

This is a slide-based video builder. It does not yet generate AI presenter footage, realistic cinematic clips or AI-generated scene images. Visual directions stay as internal production notes and are not printed as text over the scenes.

## API models and usage

- Script and Duet dialogue: `gemini-3.1-flash-lite` (the server can try `gemini-3.5-flash-lite` after a temporary overload).
- Hindi narration: `gemini-3.1-flash-tts-preview`.
- Duet uses Gemini's two-speaker TTS configuration.
- Blend makes two TTS requests and mixes their PCM audio into one WAV.

TTS requests can take longer than script generation. Blend uses about twice the TTS generation requests of a single voice. Free-tier access, quotas and model names can change; check Google AI Studio usage before production use. Do not send private client or therapy information to the API.

## Requirements

- Node.js 18.17 or newer

## Run on Windows

1. Open this repository folder in Command Prompt or PowerShell.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Run `npm start`.
5. Open http://localhost:3460

## Planned implementation

1. Connect an image provider for generated scene artwork, with a provider interface so the rest of the app does not depend on one vendor.
2. Connect an AI presenter/avatar provider and support presenter shots between generated scenes.
3. Add optional AI-generated cinematic video clips after choosing a provider and checking its pricing, limits and commercial-use terms.
4. Improve subtitle timing beyond the current scene-level SRT and add optional caption styling.
5. Add reliable MP4 rendering and final export checks.
6. Keep preview, edit, regenerate and human-approval steps before publication.
7. Export approved videos for the existing Buffer workflow. Direct publishing stays out of scope until API access and permissions are confirmed.

## Content safety

Avoid claims that hypnotherapy or past-life regression can diagnose, cure, or replace medical/mental-health care. Present guided exercises accurately and encourage qualified professional support where appropriate.

## Security

Keep API keys in a local `.env` file or deployment secrets. Never commit credentials.
