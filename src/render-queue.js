import fs from "node:fs";

function contentFingerprint(job) {
  return JSON.stringify({
    topic: job.topic,
    duration: job.duration,
    scriptData: job.scriptData,
    voiceFile: job.voiceFile,
    sceneImages: job.sceneImages
  });
}

export function createRenderQueue({ readJobs, writeJobs, renderJob, maxConcurrent = 1 }) {
  const pending = [];
  const queuedIds = new Set();
  let activeCount = 0;

  function updateJob(jobId, updater) {
    const jobs = readJobs();
    const job = jobs.find(item => item.id === jobId);
    if (!job) return null;
    updater(job);
    job.updatedAt = new Date().toISOString();
    writeJobs(jobs);
    return job;
  }

  function enqueue(jobId) {
    const jobs = readJobs();
    const job = jobs.find(item => item.id === jobId);
    if (!job) throw new Error("Video brief नहीं मिली।");
    if (["queued", "rendering"].includes(job.renderStatus)) {
      if (!queuedIds.has(jobId) && job.renderStatus === "queued") {
        pending.push(jobId);
        queuedIds.add(jobId);
        void drain();
      }
      return job;
    }
    job.renderStatus = "queued";
    job.renderProgress = 0;
    job.renderError = "";
    job.renderQueuedAt = new Date().toISOString();
    job.renderStartedAt = null;
    job.renderCompletedAt = null;
    job.renderFingerprint = contentFingerprint(job);
    job.updatedAt = new Date().toISOString();
    writeJobs(jobs);
    if (!queuedIds.has(jobId)) {
      pending.push(jobId);
      queuedIds.add(jobId);
    }
    void drain();
    return job;
  }

  async function drain() {
    if (activeCount >= maxConcurrent) return;
    while (pending.length && activeCount < maxConcurrent) {
      const jobId = pending.shift();
      queuedIds.delete(jobId);
      activeCount++;
      void processOne(jobId).finally(() => {
        activeCount--;
        void drain();
      });
    }
  }

  async function processOne(jobId) {
    const job = updateJob(jobId, item => {
      item.renderStatus = "rendering";
      item.renderProgress = 1;
      item.renderStartedAt = new Date().toISOString();
      item.renderError = "";
    });
    if (!job) return;
    const expectedFingerprint = job.renderFingerprint || contentFingerprint(job);
    try {
      const result = await renderJob(job, {
        onProgress(progress) {
          updateJob(jobId, item => {
            if (item.renderStatus === "rendering") item.renderProgress = Math.max(1, Math.min(99, Number(progress) || 1));
          });
        }
      });
      const latestJobs = readJobs();
      const latest = latestJobs.find(item => item.id === jobId);
      if (!latest) {
        if (result.filePath) fs.rmSync(result.filePath, { force: true });
        return;
      }
      if (contentFingerprint(latest) !== expectedFingerprint) {
        if (result.filePath) fs.rmSync(result.filePath, { force: true });
        latest.renderStatus = "failed";
        latest.renderProgress = 0;
        latest.renderError = "Render के दौरान script, voice या images बदल गईं। पुरानी video हटाई गई; नया render शुरू करें।";
        latest.renderCompletedAt = new Date().toISOString();
      } else {
        latest.renderStatus = "ready";
        latest.renderProgress = 100;
        latest.renderError = "";
        latest.renderedVideoFile = result.fileName;
        latest.renderedVideoMimeType = "video/mp4";
        latest.renderedVideoSizeBytes = result.sizeBytes;
        latest.renderedVideoSavedAt = new Date().toISOString();
        latest.renderedSubtitleFile = result.subtitleFileName;
        latest.renderDurationSec = result.durationSec;
        latest.renderCompletedAt = new Date().toISOString();
      }
      latest.updatedAt = new Date().toISOString();
      writeJobs(latestJobs);
    } catch (error) {
      updateJob(jobId, item => {
        item.renderStatus = "failed";
        item.renderProgress = 0;
        item.renderError = String(error?.message || "Server video rendering fail हुई।").slice(0, 1200);
        item.renderCompletedAt = new Date().toISOString();
      });
      console.error("[cloud-render] " + (error?.message || "Unknown rendering error"));
    }
  }

  function recover() {
    const jobs = readJobs();
    let changed = false;
    for (const job of jobs) {
      if (!["queued", "rendering"].includes(job.renderStatus)) continue;
      if (job.renderStatus === "rendering") {
        job.renderStatus = "queued";
        job.renderProgress = 0;
        job.renderError = "Server restart के बाद render queue में वापस जोड़ा गया।";
        job.renderStartedAt = null;
        changed = true;
      }
      if (!queuedIds.has(job.id)) {
        pending.push(job.id);
        queuedIds.add(job.id);
      }
    }
    if (changed) writeJobs(jobs);
    void drain();
  }

  return { enqueue, recover };
}
