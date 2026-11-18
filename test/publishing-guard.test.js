import test from "node:test";
import assert from "node:assert/strict";
import {
  assertBufferPublishAllowed,
  recordBufferQueuePost,
  resetBufferApprovalIfContentChanged
} from "../src/publishing-guard.js";

const videoUrl = "https://cdn.example.com/short.mp4";

test("Buffer queue requires an explicitly approved video job", () => {
  for (const status of ["brief_created", "review", "exported", "published"]) {
    assert.throws(
      () => assertBufferPublishAllowed({ id: "job-1", status }, {
        channelId: "ig-1",
        videoUrl
      }),
      /set this job's dashboard status to Approved/i
    );
  }
  assert.equal(
    assertBufferPublishAllowed({ id: "job-1", status: "approved" }, {
      channelId: "ig-1",
      videoUrl
    }).length,
    64
  );
});

test("same video cannot be queued twice to the same Buffer channel", () => {
  const job = { id: "job-1", status: "approved", bufferQueuedPosts: [] };
  const videoFingerprint = assertBufferPublishAllowed(job, { channelId: "ig-1", videoUrl });
  recordBufferQueuePost(job, {
    videoFingerprint,
    postId: "post-1",
    channelId: "ig-1",
    channelName: "Instagram",
    platform: "instagram",
    dueAt: "2026-11-19T10:00:00.000Z",
    queuedAt: "2026-11-18T12:00:00.000Z"
  });

  assert.throws(
    () => assertBufferPublishAllowed(job, { channelId: "ig-1", videoUrl }),
    /already been added/i
  );
});

test("same video can be queued to a different Buffer channel", () => {
  const job = { id: "job-1", status: "approved", bufferQueuedPosts: [] };
  const fingerprint = assertBufferPublishAllowed(job, { channelId: "fb-1", videoUrl });
  recordBufferQueuePost(job, {
    videoFingerprint: fingerprint,
    postId: "post-1",
    channelId: "fb-1",
    channelName: "Facebook",
    platform: "facebook"
  });

  assert.equal(
    assertBufferPublishAllowed(job, { channelId: "ig-1", videoUrl }).length,
    64
  );
});

test("content edits move an approved or exported job back to review", () => {
  const approved = { status: "approved" };
  const exported = { status: "exported" };
  const draft = { status: "script_ready" };

  assert.equal(resetBufferApprovalIfContentChanged(approved), true);
  assert.equal(approved.status, "review");
  assert.equal(resetBufferApprovalIfContentChanged(exported), true);
  assert.equal(exported.status, "review");
  assert.equal(resetBufferApprovalIfContentChanged(draft), false);
  assert.equal(draft.status, "script_ready");
});

test("queue records keep the video URL fingerprint, not the raw URL", () => {
  const job = { id: "job-1", bufferQueuedPosts: [] };
  const fingerprint = assertBufferPublishAllowed({ status: "approved" }, {
    channelId: "yt-1",
    videoUrl
  });
  const record = recordBufferQueuePost(job, {
    videoFingerprint: fingerprint,
    postId: "post-yt-1",
    channelId: "yt-1",
    channelName: "YouTube Shorts",
    platform: "youtube"
  });

  assert.equal(record.videoFingerprint, fingerprint);
  assert.equal("videoUrl" in record, false);
  assert.equal(job.bufferQueuedPosts.length, 1);
});
