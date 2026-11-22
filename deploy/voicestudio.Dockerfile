# Extend the official VoiceStudio server image with the VoxCPM2 TTS engine.
# The upstream Docker image does not bundle this optional engine package.
FROM ghcr.io/debpalash/voicestudio:stable

RUN python3 -m pip install --no-cache-dir "voxcpm>=2.0.3"

ENV OMNIVOICE_TTS_BACKEND=voxcpm2
ENV OMNIVOICE_VOXCPM_DEVICE=cpu
