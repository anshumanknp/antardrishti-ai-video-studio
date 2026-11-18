import test from "node:test";
import assert from "node:assert/strict";
import { buildBufferVideoPostInput, validatePublicVideoUrl } from "../src/buffer-api.js";

const videoUrl = "https://cdn.example.com/short.mp4";
const copy = {
  facebookCaption: "Facebook caption #selfawareness",
  instagramCaption: "Instagram caption #mindfulness",
  youtubeTitle: "मन को समझने का आसान तरीका",
  youtubeDescription: "YouTube description #selfawareness",
  youtubeTags: "self awareness, mindfulness, hindi motivation"
};

test("builds a Facebook Reel queue post with a hosted video", () => {
  const input = buildBufferVideoPostInput({
    channel: { id: "fb-1", service: "facebook" },
    videoUrl,
    platformCopy: copy
  });
  assert.equal(input.channelId, "fb-1");
  assert.equal(input.mode, "addToQueue");
  assert.equal(input.schedulingType, "automatic");
  assert.equal(input.assets[0].video.url, videoUrl);
  assert.deepEqual(input.metadata, { facebook: { type: "reel" } });
  assert.equal(input.text, copy.facebookCaption);
});

test("builds an Instagram Reel with feed sharing and AI disclosure", () => {
  const input = buildBufferVideoPostInput({
    channel: { id: "ig-1", service: "instagram" },
    videoUrl,
    platformCopy: copy
  });
  assert.equal(input.metadata.instagram.type, "reel");
  assert.equal(input.metadata.instagram.shouldShareToFeed, true);
  assert.equal(input.metadata.instagram.isAiGenerated, true);
  assert.equal(input.text, copy.instagramCaption);
});

test("builds a YouTube post with a separate title and education category", () => {
  const input = buildBufferVideoPostInput({
    channel: { id: "yt-1", service: "youtube" },
    videoUrl,
    platformCopy: copy
  });
  assert.equal(input.metadata.youtube.title, copy.youtubeTitle);
  assert.equal(input.metadata.youtube.categoryId, "27");
  assert.equal(input.metadata.youtube.privacy, "public");
  assert.equal(input.metadata.youtube.isAiGenerated, true);
  assert.equal(input.text, copy.youtubeDescription);
});

test("keeps the generated YouTube SEO tag pack with the saved copy while Buffer receives title and description", () => {
  const input = buildBufferVideoPostInput({
    channel: { id: "yt-1", service: "youtube" },
    videoUrl,
    platformCopy: copy
  });
  assert.equal(input.metadata.youtube.title, copy.youtubeTitle);
  assert.equal(input.text, copy.youtubeDescription);
  assert.equal("tags" in input.metadata.youtube, false);
});

test("rejects local or non-HTTPS media URLs", () => {
  assert.throws(() => buildBufferVideoPostInput({
    channel: { id: "fb-1", service: "facebook" },
    videoUrl: "http://localhost:3460/outputs/video.mp4",
    platformCopy: copy
  }), /public HTTPS URL/i);
});

test("rejects private-network HTTPS video URLs", () => {
  assert.throws(() => buildBufferVideoPostInput({
    channel: { id: "fb-1", service: "facebook" },
    videoUrl: "https://192.168.1.20/video.mp4",
    platformCopy: copy
  }), /Private or local video URLs/i);
});

test("rejects channels outside the supported three platforms", () => {
  assert.throws(() => buildBufferVideoPostInput({
    channel: { id: "x-1", service: "twitter" },
    videoUrl,
    platformCopy: copy
  }), /Only Facebook, Instagram and YouTube/i);
});

test("rejects an empty caption and overlong YouTube title", () => {
  assert.throws(() => buildBufferVideoPostInput({
    channel: { id: "fb-1", service: "facebook" },
    videoUrl,
    platformCopy: {}
  }), /caption or description is empty/i);

  assert.throws(() => buildBufferVideoPostInput({
    channel: { id: "yt-1", service: "youtube" },
    videoUrl,
    platformCopy: {
      youtubeTitle: "अ".repeat(101),
      youtubeDescription: "Description"
    }
  }), /100 characters or fewer/i);
});

test("validates and returns a direct public HTTPS media URL", () => {
  assert.equal(validatePublicVideoUrl(videoUrl), videoUrl);
  assert.throws(() => validatePublicVideoUrl("https://localhost/video.mp4"), /Private or local/i);
  assert.throws(() => validatePublicVideoUrl("https://user:pass@example.com/video.mp4"), /without login credentials/i);
});
