import test from "node:test";
import assert from "node:assert/strict";
import { preserveSceneProductionFields, validateScriptData } from "../src/script-validation.js";

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

test("preserves existing production metadata when converting scene text", () => {
  const original = validScript().scenes;
  const converted = validScript().scenes.map(scene => ({
    duration_sec: 1,
    dialogue: "बदला हुआ संवाद",
    visual_direction: "Changed model prompt",
    subtitle: "बदला हुआ कैप्शन",
    subtitle_segments: ["एक छोटा विचार", "दूसरा छोटा विचार", "तीसरा छोटा विचार"]
  }));

  const result = preserveSceneProductionFields(converted, original);
  result.forEach((scene, index) => {
    assert.equal(scene.duration_sec, original[index].duration_sec);
    assert.equal(scene.visual_direction, original[index].visual_direction);
    assert.equal(scene.shot_type, original[index].shot_type);
    assert.equal(scene.camera_movement, original[index].camera_movement);
    assert.equal(scene.transition, original[index].transition);
    assert.equal(scene.audio_cue, original[index].audio_cue);
    assert.equal(scene.dialogue, "बदला हुआ संवाद");
  });
});

test("does not replace newly generated production metadata when none existed", () => {
  const converted = validScript().scenes;
  const result = preserveSceneProductionFields(converted, []);
  assert.deepEqual(result, converted);
});

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

test("rejects scripts missing any production-planning field", () => {
  for (const field of ["shot_type", "camera_movement", "transition", "audio_cue"]) {
    const script = validScript();
    delete script.scenes[0][field];
    const issues = validateScriptData(script, 30);
    assert.ok(issues.some(issue => issue.includes(field)), "Expected validation to reject missing " + field);
  }
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
