import test from "node:test";
import assert from "node:assert/strict";
import { getRecommendedSceneCount, preserveSceneProductionFields, validateScriptData } from "../src/script-validation.js";

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

test("rejects scripts outside the supported three-to-six scene range", () => {
  const tooFew = validScript();
  tooFew.scenes.pop();
  assert.ok(validateScriptData(tooFew, 20).some(issue => issue.includes("between 3 and 6 scenes")));

  const tooMany = validScript();
  tooMany.scenes = Array.from({ length: 7 }, (_, index) => ({
    ...validScript().scenes[0],
    duration_sec: 5,
    dialogue: "Scene " + (index + 1)
  }));
  assert.ok(validateScriptData(tooMany, 35).some(issue => issue.includes("between 3 and 6 scenes")));
});

test("recommends scene counts for 15, 30, 45 and 60 second videos", () => {
  assert.equal(getRecommendedSceneCount(15), 3);
  assert.equal(getRecommendedSceneCount(30), 3);
  assert.equal(getRecommendedSceneCount(45), 5);
  assert.equal(getRecommendedSceneCount(60), 6);
});

test("accepts duration-matched five- and six-scene scripts", () => {
  for (const [duration, count] of [[45, 5], [60, 6]]) {
    const script = validScript();
    script.scenes = Array.from({ length: count }, (_, index) => ({
      ...validScript().scenes[0],
      duration_sec: duration / count,
      dialogue: "यह scene " + (index + 1) + " का संवाद है।"
    }));
    assert.deepEqual(validateScriptData(script, duration), []);
  }
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
  assert.ok(issues.some(issue => issue.includes("3 to 4")));
});

test("allows shorter caption sequences for 15-second reels", () => {
  const script = validScript();
  script.scenes.forEach(scene => {
    scene.duration_sec = 5;
    scene.subtitle_segments = ["पहला छोटा विचार", "दूसरा छोटा विचार"];
  });
  assert.deepEqual(validateScriptData(script, 15), []);
});

test("rejects a single caption segment in a 15-second scene", () => {
  const script = validScript();
  script.scenes.forEach(scene => {
    scene.duration_sec = 5;
    scene.subtitle_segments = ["केवल एक caption"];
  });
  const issues = validateScriptData(script, 15);
  assert.ok(issues.some(issue => issue.includes("2 to 3")));
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
