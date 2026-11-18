import test from "node:test";
import assert from "node:assert/strict";
import { validateScriptData } from "../src/script-validation.js";

function validScript() {
  return {
    title: "मन की आदतें",
    hook: "क्या आपने ध्यान दिया?",
    voiceover: "यह एक परीक्षण narration है।",
    cta: "अपने अनुभव साझा करें।",
    scenes: [1, 2, 3].map(number => ({
      duration_sec: 10,
      dialogue: "यह scene " + number + " का संवाद है।",
      visual_direction: "A calm cinematic visual for scene " + number,
      shot_type: "medium shot",
      camera_movement: "slow push-in",
      transition: "hard cut",
      audio_cue: "soft ambient bed",
      subtitle: "एक छोटा विचार",
      subtitle_segments: ["पहला छोटा वाक्य", "दूसरा छोटा वाक्य", "तीसरा छोटा वाक्य"]
    }))
  };
}

test("accepts a complete three-scene script matching the selected duration", () => {
  assert.deepEqual(validateScriptData(validScript(), 30), []);
});

test("rejects a script with the wrong number of scenes", () => {
  const script = validScript();
  script.scenes.pop();
  assert.ok(validateScriptData(script, 20).some(issue => issue.includes("exactly 3 scenes")));
});

test("rejects a scene missing production shot instructions", () => {
  const script = validScript();
  delete script.scenes[0].camera_movement;
  const issues = validateScriptData(script, 30);
  assert.ok(issues.some(issue => issue.includes("camera_movement")));
});

test("rejects missing scene copy and invalid subtitle segments", () => {
  const script = validScript();
  script.scenes[1].dialogue = " ";
  script.scenes[1].subtitle_segments = ["एक"];
  const issues = validateScriptData(script, 30);
  assert.ok(issues.some(issue => issue.includes("dialogue")));
  assert.ok(issues.some(issue => issue.includes("3 or 4")));
});

test("rejects non-positive scene durations and duration drift", () => {
  const script = validScript();
  script.scenes[0].duration_sec = 0;
  script.scenes[1].duration_sec = 14;
  const issues = validateScriptData(script, 30);
  assert.ok(issues.some(issue => issue.includes("positive integer")));
  assert.ok(issues.some(issue => issue.includes("2-second tolerance")));
});

test("allows a two-second duration difference", () => {
  const script = validScript();
  script.scenes[2].duration_sec = 8;
  assert.deepEqual(validateScriptData(script, 30), []);
});
