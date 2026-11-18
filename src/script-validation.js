export function getRecommendedSceneCount(duration) {
  const seconds = Number(duration);
  if (seconds <= 30) return 3;
  if (seconds <= 45) return 5;
  return 6;
}

export function validateScriptData(scriptData, expectedDuration) {
  const issues = [];
  if (!scriptData || typeof scriptData !== "object" || Array.isArray(scriptData)) {
    return ["Script response must be an object."];
  }
  for (const field of ["title", "hook", "voiceover", "cta"]) {
    if (typeof scriptData[field] !== "string" || !scriptData[field].trim()) {
      issues.push("Missing " + field + ".");
    }
  }
  if (!Array.isArray(scriptData.scenes) || scriptData.scenes.length < 3 || scriptData.scenes.length > 6) {
    issues.push("A video script must contain between 3 and 6 scenes.");
    return issues;
  }

  let totalDuration = 0;
  scriptData.scenes.forEach((scene, index) => {
    const number = index + 1;
    if (!scene || typeof scene !== "object" || Array.isArray(scene)) {
      issues.push("Scene " + number + " must be an object.");
      return;
    }
    for (const field of ["dialogue", "visual_direction", "shot_type", "camera_movement", "transition", "audio_cue", "subtitle"]) {
      if (typeof scene[field] !== "string" || !scene[field].trim()) {
        issues.push("Scene " + number + " is missing " + field + ".");
      }
    }
    if (!Number.isInteger(scene.duration_sec) || scene.duration_sec < 1) {
      issues.push("Scene " + number + " must have a positive integer duration.");
    } else {
      totalDuration += scene.duration_sec;
    }
    if (!Array.isArray(scene.subtitle_segments) ||
        scene.subtitle_segments.length < 3 ||
        scene.subtitle_segments.length > 4 ||
        scene.subtitle_segments.some(segment => typeof segment !== "string" || !segment.trim())) {
      issues.push("Scene " + number + " must have 3 or 4 non-empty subtitle segments.");
    }
  });

  const duration = Number(expectedDuration);
  if (Number.isFinite(duration) && duration > 0 &&
      Math.abs(totalDuration - duration) > 2) {
    issues.push("Scene durations total " + totalDuration +
      " seconds; selected video duration is " + duration + " seconds (2-second tolerance).");
  }
  return issues;
}

const PRESERVED_SCENE_FIELDS = [
  "duration_sec",
  "visual_direction",
  "shot_type",
  "camera_movement",
  "transition",
  "audio_cue"
];

export function preserveSceneProductionFields(convertedScenes, originalScenes) {
  if (!Array.isArray(convertedScenes)) return convertedScenes;

  return convertedScenes.map((convertedScene, index) => {
    if (!convertedScene || typeof convertedScene !== "object" || Array.isArray(convertedScene)) {
      return convertedScene;
    }

    const originalScene = Array.isArray(originalScenes) ? originalScenes[index] : null;
    if (!originalScene || typeof originalScene !== "object" || Array.isArray(originalScene)) {
      return { ...convertedScene };
    }

    const result = { ...convertedScene };
    for (const field of PRESERVED_SCENE_FIELDS) {
      const originalValue = originalScene[field];
      if (typeof originalValue === "string" && originalValue.trim()) {
        result[field] = originalValue;
      } else if (field === "duration_sec" &&
                 Number.isInteger(originalValue) && originalValue > 0) {
        result[field] = originalValue;
      }
    }
    return result;
  });
}
