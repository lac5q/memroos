// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as backends from "../backends";
import * as registry from "../registry";

function stubAbortSignal(): void {
  vi.spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
}

beforeEach(() => {
  stubAbortSignal();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete process.env.MEMROOS_MEMORY_SEARCH_TIMEOUT_MS;
  delete process.env.MEM0_HEALTH_TIMEOUT_MS;
  delete process.env.NEO4J_PASSWORD;
});

describe("memory backends batch34 — health envelopes and adapter normalization", () => {
  it("mem0HealthTimeoutMs falls back when env is non-finite (17, 22–23)", () => {
    vi.stubEnv("MEM0_HEALTH_TIMEOUT_MS", "not-a-number");
    expect(backends.mem0HealthTimeoutMs()).toBe(15_000);
  });

  it("checkVectorHealth marks degraded when mem0 reports queued saves (175–176)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          vector_store: "connected",
          memory_runtime: { status: "available" },
          queue: { queued: 3 },
        }),
      ),
    );
    vi.spyOn(registry, "getAdapters").mockReturnValue([]);
    const health = await backends.checkVectorHealth();
    expect(health.status).toBe("degraded");
    expect(health.detail).toMatch(/queued/i);
  });

  it("VectorMemoryAdapter.search normalizes memories[] payloads (235–237)", async () => {
    vi.spyOn(registry, "getAdapters").mockReturnValue([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/memory/search")) {
          return Response.json({ memories: [{ id: "v-b34", memory: "vector batch34 body" }] });
        }
        return Response.json({}, { status: 404 });
      }),
    );
    const adapter = new backends.VectorMemoryAdapter();
    const hits = await adapter.search("batch34", 2);
    expect(hits[0]?.content).toBe("vector batch34 body");
  });

  it("GraphMemoryAdapter.write falls back to mem0 when Neo4j is not configured (339–346)", async () => {
    delete process.env.NEO4J_PASSWORD;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new backends.GraphMemoryAdapter();
    await adapter.write({ memory: "graph batch34 memory", id: "g-b34" });
    expect(fetchMock).toHaveBeenCalled();
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.memory).toBe("graph batch34 memory");
    expect(body.type).toBe("graph");
  });

  it("checkGraphHealth returns not_configured without password (194)", async () => {
    delete process.env.NEO4J_PASSWORD;
    const health = await backends.checkGraphHealth();
    expect(health.status).toBe("not_configured");
  });

  it("EpisodicMemoryAdapter.health reports down when db factory throws (416–421)", async () => {
    const adapter = new backends.EpisodicMemoryAdapter(() => {
      throw new Error("sqlite unavailable batch34");
    });
    const health = await adapter.health();
    expect(health.status).toBe("down");
    expect(health.detail).toMatch(/sqlite unavailable batch34/);
  });

  it("module registration guard is idempotent on re-import (440)", async () => {
    vi.resetModules();
    const reg = await import("../registry");
    reg.clearRegistry();
    await import("../backends");
    const n = reg.getAdapters("vector").length;
    await import("../backends");
    expect(reg.getAdapters("vector").length).toBe(n);
  });
});
