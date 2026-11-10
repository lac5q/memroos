// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEvalServiceForSeal, SdkBackedEvalService } from "../sdk-eval-service";

describe("SdkBackedEvalService batch28b — factory gate and getRunById", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("createEvalServiceForSeal returns null outside production NODE_ENV", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    try {
      expect(createEvalServiceForSeal()).toBeNull();
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("getRunById returns null in the SDK path", () => {
    const service = new SdkBackedEvalService({
      baseUrl: "http://localhost:3000",
      apiKey: "production-only-test-key-not-default",
    });
    expect(service.getRunById()).toBeNull();
  });
});
