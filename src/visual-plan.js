export const VISUAL_PLAN_BY_DURATION = Object.freeze({
  15: Object.freeze({ totalShots: 5, totalImages: 4 }),
  30: Object.freeze({ totalShots: 8, totalImages: 6 }),
  45: Object.freeze({ totalShots: 10, totalImages: 8 }),
  60: Object.freeze({ totalShots: 13, totalImages: 10 })
});

function distribute(total, buckets) {
  const base = Math.floor(total / buckets);
  const remainder = total % buckets;
  return Array.from({ length: buckets }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function getVideoVisualPlan(duration, sceneCount = 3) {
  const selectedDuration = [15, 30, 45, 60].includes(Number(duration)) ? Number(duration) : 45;
  const spec = VISUAL_PLAN_BY_DURATION[selectedDuration];
  const safeSceneCount = Math.max(1, Math.min(6, Math.round(Number(sceneCount) || 3)));
  const shotCounts = distribute(spec.totalShots, safeSceneCount);
  const imageCounts = distribute(spec.totalImages, safeSceneCount);

  return {
    duration: selectedDuration,
    totalShots: spec.totalShots,
    totalImages: spec.totalImages,
    scenes: shotCounts.map((shotCount, sceneIndex) => ({
      sceneIndex,
      shotCount,
      imageCount: imageCounts[sceneIndex]
    }))
  };
}

export function getVisualImageTargets(plan) {
  return (plan?.scenes || []).flatMap(scene =>
    Array.from({ length: scene.imageCount }, (_, variantIndex) => ({
      sceneIndex: scene.sceneIndex,
      variantIndex
    }))
  );
}

export function getAlternateShotType(shotType = "") {
  return /wide|establishing/i.test(String(shotType))
    ? "close-up detail shot"
    : "wide environmental shot";
}
