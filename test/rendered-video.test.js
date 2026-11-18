import test from "node:test";
import assert from "node:assert/strict";
import { buildRenderedVideoFileName, getRenderedVideoExtension } from "../src/rendered-video.js";

test("accepts MP4 and WebM MIME types with codec parameters", () => {
  assert.equal(getRenderedVideoExtension("video/mp4"), "mp4");
  assert.equal(getRenderedVideoExtension("video/mp4;codecs=avc1.42E01E,mp4a.40.2"), "mp4");
  assert.equal(getRenderedVideoExtension("video/webm;codecs=vp9,opus"), "webm");
});
test("rejects unsupported rendered-video MIME types", () => {
  assert.throws(() => getRenderedVideoExtension("application/octet-stream"), /MP4 or WebM/i);
  assert.throws(() => getRenderedVideoExtension("video/quicktime"), /MP4 or WebM/i);
});
test("builds safe output filenames", () => {
  assert.equal(buildRenderedVideoFileName("123e4567-e89b-12d3-a456-426614174000","mp4"),"antardrishti-123e4567-e89b-12d3-a456-426614174000-final.mp4");
  assert.throws(() => buildRenderedVideoFileName("../private","mp4"), /Invalid video job ID/i);
  assert.throws(() => buildRenderedVideoFileName("job-1","exe"), /MP4 or WebM/i);
});
