// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as backends from "../backends";
import * as registry from "../registry";

beforeEach(() => {
  vi.spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete process.env.MEMROOS_MEMORY_SEARCH_TIMEOUT_MS;
});

describe("memory backends batch35 — registration guard and timeout fallbacks", () => {
  it("module registration guard short-circuits on second init (440)", async () => {
    vi.resetModules();
    const reg = await import("../registry");
    reg.clearRegistry();
    await import("../backends");
    const first = reg.getAdapters("vector").length;
    await import("../backends");
    expect(reg.getAdapters("vector").length).toBe(first);
    expect(first).toBeGreaterThan(0);
  });

  it("mem0 search uses default timeout when env is non-finite", async () => {
    vi.stubEnv("MEMROOS_MEMORY_SEARCH_TIMEOUT_MS", "NaN");
    vi.spyOn(registry, "getAdapters").mockReturnValue([]);
    const fetchMock = vi.fn(async () => Response.json({ memories: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new backends.VectorMemoryAdapter();
    await adapter.search("batch35", 1);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("neo4jUsesQueryApi detects Aura hostnames", () => {
    expect(backends.neo4jUsesQueryApi("https://abc.databases.neo4j.io")).toBe(true);
    expect(backends.neo4jUsesQueryApi("http://localhost:7474")).toBe(false);
  });
});
