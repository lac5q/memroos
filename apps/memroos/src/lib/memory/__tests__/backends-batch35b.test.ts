// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("memory backends batch35b", () => {
  it("module registration guard short-circuits duplicate adapter registration (440)", async () => {
    vi.resetModules();
    const registry = await import("../registry");
    registry.clearRegistry();
    await import("../backends");
    const afterFirst = registry.getAdapters("vector").length;
    await import("../backends");
    const afterSecond = registry.getAdapters("vector").length;
    expect(afterFirst).toBeGreaterThan(0);
    expect(afterSecond).toBe(afterFirst);
  });
});
