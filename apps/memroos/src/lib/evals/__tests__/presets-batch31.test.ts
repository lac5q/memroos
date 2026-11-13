// @vitest-environment node
import { describe, expect, it } from "vitest";

import { BUILT_IN_PRESETS, resolveWeights } from "../presets";
import type { EvalConfig } from "../types";

const baseConfig: EvalConfig = {
  weights: { l1: 0.33, l2: 0.33, l3: 0.34 },
  weightPresets: {},
  activePreset: null,
  agents: {},
  thresholds: {},
  rubricVersion: "1",
};

describe("evals presets batch31 — resolveWeights", () => {
  it("returns manual weights when activePreset is null", () => {
    expect(resolveWeights(baseConfig)).toEqual(baseConfig.weights);
  });

  it("uses BUILT_IN_PRESETS fallback when preset missing from weightPresets", () => {
    const resolved = resolveWeights({
      ...baseConfig,
      activePreset: "quality-weighted",
    });
    expect(resolved).toEqual(BUILT_IN_PRESETS["quality-weighted"]);
  });

  it("prefers config.weightPresets over built-ins", () => {
    const custom = { l1: 0.5, l2: 0.3, l3: 0.2 };
    const resolved = resolveWeights({
      ...baseConfig,
      activePreset: "custom-b31",
      weightPresets: { "custom-b31": custom },
    });
    expect(resolved).toEqual(custom);
  });
});
