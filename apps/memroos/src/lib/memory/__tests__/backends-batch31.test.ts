// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { checkGraphHealth, checkVectorHealth } from "../backends";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("memory backends batch31 — registration guard and health branches", () => {
  it("module registration guard is idempotent across re-imports (line 440)", async () => {
    vi.resetModules();
    const registry = await import("../registry");
    registry.clearRegistry();
    await import("../backends");
    const vectorCount = registry.getAdapters("vector").length;
    expect(vectorCount).toBeGreaterThan(0);
    await import("../backends");
    expect(registry.getAdapters("vector").length).toBe(vectorCount);
    expect(registry.getAdapters("graph").length).toBeGreaterThan(0);
    expect(registry.getAdapters("episodic").length).toBeGreaterThan(0);
  });

  it("checkVectorHealth reports degraded when mem0 health is unreachable on localhost", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("localhost mem0 unreachable b31");
      }),
    );
    const health = await checkVectorHealth();
    expect(health.tier).toBe("vector");
    expect(["degraded", "down"]).toContain(health.status);
  });

  it("checkGraphHealth returns a structured health envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      })),
    );
    const graph = await checkGraphHealth();
    expect(graph.tier).toBe("graph");
    expect(graph.status).toBeDefined();
  });
});
