// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("memory backends batch36b", () => {
  it("default registration wires vector, graph, and episodic adapters (443–449)", async () => {
    vi.resetModules();
    const registry = await import("../registry");
    registry.clearRegistry();
    await import("../backends");
    expect(registry.getAdapters("vector").length).toBeGreaterThan(0);
    expect(registry.getAdapters("graph").length).toBeGreaterThan(0);
    expect(registry.getAdapters("episodic").length).toBeGreaterThan(0);
  });
});
