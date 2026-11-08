// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { checkVectorHealth } from "../backends";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("memory backends batch30b — registry guard and direct health fallback", () => {
  it("checkVectorHealth uses direct path when no vector adapter is registered (lines 484–488)", async () => {
    const registry = await import("../registry");
    vi.spyOn(registry, "getAdapters").mockReturnValue([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      })),
    );
    const health = await checkVectorHealth();
    expect(health.tier).toBe("vector");
    expect(["degraded", "down"]).toContain(health.status);
  });

  it("module registration guard keeps adapter lists stable on re-import (line 440)", async () => {
    vi.resetModules();
    const registry = await import("../registry");
    registry.clearRegistry();
    await import("../backends");
    const afterInit = registry.getAdapters("vector").length;
    expect(afterInit).toBeGreaterThan(0);
    await import("../backends");
    expect(registry.getAdapters("vector").length).toBe(afterInit);
  });
});
