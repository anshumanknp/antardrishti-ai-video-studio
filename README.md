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

- Local dashboard and production queue
- Video brief creation (topic, format, duration)
- Hindi-first content settings
- Mixed Presenter + Cinematic format option
- Explicit human approval workflow status

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
