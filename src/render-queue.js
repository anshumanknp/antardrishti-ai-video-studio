import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { resetBufferApprovalIfContentChanged } from "./publishing-guard.js";

function renderInputFingerprint(job) {
  const input = {
    topic: job.topic,
    duration: job.duration,
    script: job.script,
    scriptData: job.scriptData,
    sceneImages: job.sceneImages,
    voiceFile: job.voiceFile,
    voiceDurationSec: job.voiceDurationSec,
    voiceMode: job.voiceMode,
    femaleVoice: job.femaleVoice,
    maleVoice: job.maleVoice
  };
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function createRenderQueue(options = {}) {
  const readJobs = options.readJobs;
  const writeJobs = options.writeJobs;
  const renderVideo = options.renderVideo;
  const outputDir = options.outputDir || "outputs";
  const dataDir = options.dataDir || "data";
  if (typeof readJobs !== "function" || typeof writeJobs !== "function" || typeof renderVideo !== "function") {
    throw new TypeError("Render queue requires readJobs, writeJobs and renderVideo functions.");
  }

  let draining = false;
  let stopped = false;

  function updateJob(jobId, update) {
    const jobs = readJobs();
    const job = jobs.find(item => item.id === jobId);
    if (!job) return null;
    update(job);
    job.updatedAt = new Date().toISOString();
    writeJobs(jobs);
    return job;
  }

  function enqueue(jobId) {
    const jobs = readJobs();
    const job = jobs.find(item => item.id === jobId);
    if (!job) {
      const error = new Error("Video brief नहीं मिला।");
      error.status = 404;
      throw error;
    }
    if (!job.scriptData || !Array.isArray(job.scriptData.scenes) || !job.scriptData.scenes.length) {
      const error = new Error("पहले Hindi script और scenes तैयार करें।");
      error.status = 400;
      throw error;
    }
    if (job.renderStatus === "queued" || job.renderStatus === "rendering") return job;

    // Any new render must receive a fresh human review and a fresh hosted URL.
    resetBufferApprovalIfContentChanged(job);
    job.renderStatus = "queued";
    job.renderProgress = 0;
    job.renderError = "";
    job.renderQueuedAt = new Date().toISOString();
    job.renderStartedAt = null;
    job.renderCompletedAt = null;
    job.updatedAt = new Date().toISOString();
    writeJobs(jobs);
    void drain();
    return job;
  }

  function getStatus(jobId) {
    const job = readJobs().find(item => item.id === jobId);
    if (!job) return null;
    return {
      id: job.id,
      renderStatus: job.renderStatus || "idle",
      renderProgress: Number(job.renderProgress) || 0,
      renderError: job.renderError || "",
      renderQueuedAt: job.renderQueuedAt || null,
      renderStartedAt: job.renderStartedAt || null,
      renderCompletedAt: job.renderCompletedAt || null,
      renderedVideoFile: job.renderedVideoFile || "",
      renderedVideoUrl: job.renderedVideoFile ? "/outputs/" + encodeURIComponent(job.renderedVideoFile) : "",
      renderedVideoMimeType: job.renderedVideoMimeType || "",
      renderedVideoSizeBytes: Number(job.renderedVideoSizeBytes) || 0,
      renderedVideoDurationSec: Number(job.renderedVideoDurationSec) || null,
      subtitleFile: job.subtitleFile || ""
    };
  }

  async function drain() {
    if (draining || stopped) return;
    draining = true;
    try {
      while (!stopped) {
        const jobs = readJobs();
        const next = jobs
          .filter(item => item.renderStatus === "queued")
          .sort((left, right) => Date.parse(left.renderQueuedAt || left.createdAt || 0) -
            Date.parse(right.renderQueuedAt || right.createdAt || 0))[0];
        if (!next) break;
        const jobId = next.id;
        next.renderStatus = "rendering";
        next.renderProgress = 1;
        next.renderStartedAt = new Date().toISOString();
        next.renderError = "";
        next.updatedAt = new Date().toISOString();
        writeJobs(jobs);
        const snapshot = JSON.parse(JSON.stringify(next));
        const inputFingerprint = renderInputFingerprint(snapshot);
        let lastProgressWrite = 0;

        try {
          const result = await renderVideo(snapshot, {
            outputDir,
            dataDir,
            onProgress: fraction => {
              const now = Date.now();
              if (now - lastProgressWrite < 1500 && fraction < 1) return;
              lastProgressWrite = now;
              updateJob(jobId, job => {
                if (job.renderStatus === "rendering") {
                  job.renderProgress = Math.max(1, Math.min(99, Math.round(Number(fraction) * 100)));
                }
              });
            }
          });
          const latestJob = readJobs().find(item => item.id === jobId);
          if (!latestJob || renderInputFingerprint(latestJob) !== inputFingerprint) {
            if (result.fileName) fs.rmSync(path.join(outputDir, path.basename(result.fileName)), { force: true });
            if (result.srtFile) fs.rmSync(path.join(outputDir, path.basename(result.srtFile)), { force: true });
            updateJob(jobId, job => {
              job.renderStatus = "failed";
              job.renderError = "Video content rendering के दौरान बदल गया। नया render शुरू करें।";
              job.renderProgress = 0;
              job.renderCompletedAt = new Date().toISOString();
            });
            continue;
          }
          updateJob(jobId, job => {
            job.renderStatus = "ready";
            job.renderProgress = 100;
            job.renderError = "";
            job.renderCompletedAt = new Date().toISOString();
            job.renderedVideoFile = result.fileName;
            job.renderedVideoMimeType = result.mimeType || "video/mp4";
            job.renderedVideoSizeBytes = Number(result.sizeBytes) || 0;
            job.renderedVideoDurationSec = Number(result.durationSec) || null;
            job.renderedVideoSavedAt = new Date().toISOString();
            job.subtitleFile = result.srtFile || "";
            // A fresh render invalidates a previous hosted copy and requires a new review.
            if (job.status === "approved" || job.status === "exported") job.status = "review";
            delete job.bufferVideoUrl;
          });
        } catch (error) {
          updateJob(jobId, job => {
            job.renderStatus = "failed";
            job.renderError = String(error?.message || "Server-side rendering failed.").slice(0, 1200);
            job.renderProgress = 0;
            job.renderCompletedAt = new Date().toISOString();
          });
        }
      }
    } finally {
      draining = false;
      if (!stopped && readJobs().some(item => item.renderStatus === "queued")) {
        void drain();
      }
    }
  }

  function resume() {
    const jobs = readJobs();
    let changed = false;
    for (const job of jobs) {
      if (job.renderStatus === "rendering") {
        job.renderStatus = "queued";
        job.renderProgress = 0;
        job.renderError = "Server restart के कारण अधूरा render queue में वापस रखा गया है।";
        job.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) writeJobs(jobs);
    void drain();
  }

  function stop() {
    stopped = true;
  }

  return { enqueue, getStatus, resume, stop };
}
