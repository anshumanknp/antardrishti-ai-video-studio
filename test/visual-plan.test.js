import test from "node:test";
import assert from "node:assert/strict";
import {
  getAlternateShotType,
  getVideoVisualPlan,
  getVisualImageTargets
} from "../src/visual-plan.js";

test("uses the approved visual shot and AI image budgets for each duration", () => {
  const expected = [
    [15, 3, 5, 4],
    [30, 3, 8, 6],
    [45, 5, 10, 8],
    [60, 6, 13, 10]
  ];
  for (const [duration, scenes, shots, images] of expected) {
    const plan = getVideoVisualPlan(duration, scenes);
    assert.equal(plan.totalShots, shots);
    assert.equal(plan.totalImages, images);
    assert.equal(plan.scenes.reduce((sum, scene) => sum + scene.shotCount, 0), shots);
    assert.equal(plan.scenes.reduce((sum, scene) => sum + scene.imageCount, 0), images);
    assert.equal(getVisualImageTargets(plan).length, images);
  }
});

test("distributes visual shots and images across the available scenes", () => {
  const plan = getVideoVisualPlan(15, 3);
  assert.deepEqual(plan.scenes, [
    { sceneIndex: 0, shotCount: 2, imageCount: 2 },
    { sceneIndex: 1, shotCount: 2, imageCount: 1 },
    { sceneIndex: 2, shotCount: 1, imageCount: 1 }
  ]);
});

test("handles invalid scene counts without exceeding six scenes", () => {
  assert.equal(getVideoVisualPlan(60, 0).scenes.length, 3);
  assert.equal(getVideoVisualPlan(60, 99).scenes.length, 6);
});

test("chooses a complementary alternate framing", () => {
  assert.equal(getAlternateShotType("wide shot"), "close-up detail shot");
  assert.equal(getAlternateShotType("close-up"), "wide environmental shot");
});
