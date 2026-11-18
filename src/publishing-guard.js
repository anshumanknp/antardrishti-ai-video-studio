import { createHash } from "node:crypto";

const APPROVED_STATUS = "approved";

function fingerprintVideoUrl(videoUrl) {
  return createHash("sha256").update(String(videoUrl || "").trim()).digest("hex");
}

export function resetBufferApprovalIfContentChanged(job, { invalidateRenderedVideo = false } = {}) {
  if (!job || typeof job !== "object") return false;
  let changed = false;
  if (job.status === "approved" || job.status === "exported") {
    job.status = "review";
    changed = true;
  }
  // A hosted video belongs to one exact render. Content changes require a fresh upload.
  if (job.bufferVideoUrl) {
    delete job.bufferVideoUrl;
    changed = true;
  }
  if (invalidateRenderedVideo && job.renderedVideoFile) {
    delete job.renderedVideoFile;
    delete job.renderedVideoMimeType;
    delete job.renderedVideoSizeBytes;
    delete job.renderedVideoSavedAt;
    changed = true;
  }
  return changed;
}

export function assertBufferPublishAllowed(job, { channelId, videoUrl }) {
  if (!job || typeof job !== "object") {
    throw new Error("A valid video job is required before Buffer publishing.");
  }
  if (job.status !== APPROVED_STATUS) {
    throw new Error("Buffer publishing blocked: first review the final video and captions, then set this job's dashboard status to Approved.");
  }
  const safeChannelId = String(channelId || "").trim();
  const safeVideoUrl = String(videoUrl || "").trim();
  if (!safeChannelId) throw new Error("Select a Buffer channel.");
  if (!safeVideoUrl) throw new Error("A public video URL is required.");

  const videoFingerprint = fingerprintVideoUrl(safeVideoUrl);
  const alreadyQueued = (Array.isArray(job.bufferQueuedPosts) ? job.bufferQueuedPosts : [])
    .some(item => item.channelId === safeChannelId && item.videoFingerprint === videoFingerprint);
  if (alreadyQueued) {
    throw new Error("This video has already been added to this Buffer channel's queue. Use a different video URL to queue a revised export.");
  }
  return videoFingerprint;
}

export function recordBufferQueuePost(job, {
  videoFingerprint,
  postId,
  channelId,
  channelName,
  platform,
  dueAt = null,
  queuedAt = new Date().toISOString()
}) {
  if (!job || typeof job !== "object") throw new Error("A valid video job is required.");
  if (!videoFingerprint || !postId || !channelId) {
    throw new Error("The Buffer queue record is missing required post details.");
  }
  if (!Array.isArray(job.bufferQueuedPosts)) job.bufferQueuedPosts = [];
  const duplicate = job.bufferQueuedPosts.some(item =>
    item.channelId === channelId && item.videoFingerprint === videoFingerprint
  );
  if (duplicate) {
    throw new Error("This video is already recorded in this Buffer channel's queue.");
  }
  const record = {
    postId: String(postId),
    channelId: String(channelId),
    channelName: String(channelName || ""),
    platform: String(platform || "").toLowerCase(),
    dueAt: dueAt ? String(dueAt) : null,
    queuedAt: String(queuedAt),
    videoFingerprint
  };
  job.bufferQueuedPosts.push(record);
  if (job.bufferQueuedPosts.length > 50) job.bufferQueuedPosts.splice(0, job.bufferQueuedPosts.length - 50);
  return record;
}
