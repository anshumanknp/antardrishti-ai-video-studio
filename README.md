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
6. Generate the Hindi-first script, review/edit it, then generate Hindi voice.
7. Select **Create Slide Video** to create a vertical slide-based video in the browser and download it.

The first slide-video version uses locally drawn animated backgrounds, scene text and subtitles. It does not call an image-generation API and does not create an AI presenter or cinematic footage. Image/video generation can be added later through separate provider modules; Gemini image and video models currently have no free API tier in the pricing table.

## API models

- Script: `gemini-3.7-flash` (default; free Flash fallback also tries 3.8 and 3.6 on temporary overload)
- Hindi narration: `gemini-3.1-flash-tts-preview` (TTS)

Free-tier availability, quotas and model names can change. Check Google AI Studio usage before production use. Free-tier content may be used by Google to improve its products, so do not send private client or therapy information.

## Not implemented yet

This starter does **not** yet generate AI scripts, avatars, voiceovers, cinematic clips, captions, background music, rendered MP4s, or publish to Buffer. These require selecting providers, reviewing their current APIs/pricing/terms, and configuring credentials. No API keys are included.

## Requirements

- Node.js 18.17 or newer

## Run on Windows

1. Open this repository folder in Command Prompt or PowerShell.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Run `npm start`.
5. Open http://localhost:3460

## Planned implementation

1. Add Hindi script generation with fact-check and safety checks.
2. Select and connect an AI presenter/avatar provider.
3. Select and connect a cinematic video generation provider.
4. Add Hindi TTS, subtitles, licensed music and FFmpeg rendering.
5. Add preview, edit, regenerate and human-approval gates.
6. Export approved MP4s for the existing Buffer workflow.
7. Consider direct Buffer/API integration only after provider access and permissions are confirmed.

## Content safety

Avoid claims that hypnotherapy or past-life regression can diagnose, cure, or replace medical/mental-health care. Present guided exercises accurately and encourage qualified professional support where appropriate.

## Security

Keep API keys in a local `.env` file or deployment secrets. Never commit credentials.
