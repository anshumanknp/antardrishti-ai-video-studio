import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCloudflareScenePrompt,
  CLOUDFLARE_IMAGE_PROMPT_LIMIT
} from "../src/image-prompt.js";

test("keeps long scene prompts below the Cloudflare input limit", () => {
  const prompt = buildCloudflareScenePrompt({
    topic: "सर्दियों में मन उदास क्यों हो जाता है? ".repeat(100),
    dialogueContext: "धूप कम होने से मूड प्रभावित हो सकता है। ".repeat(100),
    visualDirection: "A quiet Indian home in winter, with a person sitting near a sunlit window. ".repeat(100),
    shotType: "wide shot ".repeat(100),
    cameraMovement: "slow push-in ".repeat(100)
  });

  assert.ok(prompt.length <= CLOUDFLARE_IMAGE_PROMPT_LIMIT);
  assert.match(prompt, /INDIAN CONTEXT/);
  assert.match(prompt, /ABSTRACT RULE/);
  assert.match(prompt, /NO TEXT/);
  assert.match(prompt, /Exact visual direction: A quiet Indian home in winter/);
});

test("keeps scene-specific instructions and removes line breaks from dynamic fields", () => {
  const prompt = buildCloudflareScenePrompt({
    topic: "विंटर ब्लूज़",
    dialogueContext: "कम धूप\nमूड को प्रभावित करती है",
    visualDirection: "An abstract glowing line\nwith no people",
    shotType: "close-up",
    cameraMovement: "pan left"
  });

  assert.match(prompt, /Exact visual direction: An abstract glowing line with no people/);
  assert.match(prompt, /Scene dialogue context: कम धूप मूड को प्रभावित करती है/);
  assert.match(prompt, /Shot framing: close-up/);
  assert.match(prompt, /Camera movement: pan left/);
  assert.ok(prompt.length <= CLOUDFLARE_IMAGE_PROMPT_LIMIT);
});
