import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkVectorHealth,
  checkGraphHealth,
  mem0HealthTimeoutMs,
  neo4jConfig,
  neo4jHttpQuery,
  neo4jUsesQueryApi,
  queryGraphMemory,
  searchVectorMemory,
} from "../backends";
import * as registry from "../registry";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mem0HealthTimeoutMs", () => {
  it("defaults to 15_000ms when env var is unset", () => {
    delete process.env.MEM0_HEALTH_TIMEOUT_MS;
    expect(mem0HealthTimeoutMs()).toBe(15_000);
  });

  it("defaults to 15_000ms when env var is empty string", () => {
    process.env.MEM0_HEALTH_TIMEOUT_MS = "";
    expect(mem0HealthTimeoutMs()).toBe(15_000);
  });

  it("accepts a positive integer override", () => {
    process.env.MEM0_HEALTH_TIMEOUT_MS = "7500";
    expect(mem0HealthTimeoutMs()).toBe(7_500);
  });

  it("accepts a numeric string and truncates fractional values", () => {
    process.env.MEM0_HEALTH_TIMEOUT_MS = "12345.9";
    expect(mem0HealthTimeoutMs()).toBe(12_345);
  });

  it("falls back to 15_000ms when override is zero", () => {
    process.env.MEM0_HEALTH_TIMEOUT_MS = "0";
    expect(mem0HealthTimeoutMs()).toBe(15_000);
  });

  it("falls back to 15_000ms when override is negative", () => {
    process.env.MEM0_HEALTH_TIMEOUT_MS = "-100";
    expect(mem0HealthTimeoutMs()).toBe(15_000);
  });

  it("falls back to 15_000ms when override is NaN", () => {
    process.env.MEM0_HEALTH_TIMEOUT_MS = "not-a-number";
    expect(mem0HealthTimeoutMs()).toBe(15_000);
  });

  it("integrates a live override via direct read", () => {
    process.env.MEM0_HEALTH_TIMEOUT_MS = "20000";
    expect(mem0HealthTimeoutMs()).toBe(20_000);
    delete process.env.MEM0_HEALTH_TIMEOUT_MS;
    expect(mem0HealthTimeoutMs()).toBe(15_000);
  });
});

describe("checkVectorHealth timeout honesty", () => {
  it("reports vector down with timeout detail when the Mem0 probe aborts", async () => {
    process.env.MEM0_HEALTH_TIMEOUT_MS = "50";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const signal = init?.signal;
        await new Promise<void>((_resolve, reject) => {
          if (!signal) {
            reject(new Error("TimeoutError: The operation was aborted due to timeout"));
            return;
          }
          if (signal.aborted) {
            reject(signal.reason ?? new DOMException("The operation was aborted due to timeout", "TimeoutError"));
            return;
          }
          signal.addEventListener("abort", () => {
            reject(signal.reason ?? new DOMException("The operation was aborted due to timeout", "TimeoutError"));
          });
        });
        return new Response("{}");
      }),
    );

    const health = await checkVectorHealth();
    expect(health.tier).toBe("vector");
    expect(health.status).toBe("down");
    expect(String(health.detail ?? "").toLowerCase()).toMatch(/abort|timeout/);
  });

  it("reports vector up when Mem0 health returns ok within the probe window", async () => {
    process.env.MEM0_HEALTH_TIMEOUT_MS = "5000";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "ok",
          vector_store: "connected",
          queue: { queued: 0 },
          memory_runtime: { status: "available" },
        }),
      ),
    );

    const health = await checkVectorHealth();
    expect(health).toMatchObject({ tier: "vector", backend: "mem0-qdrant", status: "up" });
  });

  it("marks vector degraded when queued saves are pending", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "ok",
          vector_store: "connected",
          queue: { queued: 3 },
          memory_runtime: { status: "available" },
          disk: { critical: false },
        }),
      ),
    );

    const health = await checkVectorHealth();
    expect(health.status).toBe("degraded");
    expect(String(health.detail)).toMatch(/3 queued memory saves/);
  });

  it("marks vector down when memory runtime is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "degraded",
          vector_store: "connected",
          queue: { queued: 0 },
          memory_runtime: { status: "error", error: "worker offline" },
          disk: { critical: false },
        }),
      ),
    );

    const health = await checkVectorHealth();
    expect(health.status).toBe("down");
    expect(String(health.detail)).toMatch(/runtime error/);
  });

  it("marks vector down on non-OK HTTP responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("service unavailable", { status: 503 })),
    );

    const health = await checkVectorHealth();
    expect(health.status).toBe("down");
    expect(String(health.detail)).toMatch(/HTTP 503/);
  });

  it("neo4jConfig returns trimmed defaults and env overrides", () => {
    const original = {
      url: process.env.NEO4J_HTTP_URL,
      database: process.env.NEO4J_DATABASE,
      username: process.env.NEO4J_USERNAME,
      password: process.env.NEO4J_PASSWORD,
    };
    process.env.NEO4J_HTTP_URL = "http://neo4j.example.com/";
    process.env.NEO4J_DATABASE = "graphdb";
    process.env.NEO4J_USERNAME = "graph-user";
    process.env.NEO4J_PASSWORD = "test-graph-pass";
    expect(neo4jConfig()).toEqual({
      url: "http://neo4j.example.com",
      database: "graphdb",
      username: "graph-user",
      password: "test-graph-pass",
    });
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key as keyof typeof original];
      else process.env[key as keyof typeof original] = value;
    }
  });

  it("neo4jHttpQuery throws when password is missing", async () => {
    const prev = process.env.NEO4J_PASSWORD;
    process.env.NEO4J_PASSWORD = "";
    let message = "";
    try {
      await neo4jHttpQuery("RETURN 1");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("Neo4j password is not configured");
    if (prev !== undefined) process.env.NEO4J_PASSWORD = prev;
    else delete process.env.NEO4J_PASSWORD;
  });

  it("neo4jHttpQuery uses Query API v2 for Aura hosts", async () => {
    expect(neo4jUsesQueryApi("https://abcd.databases.neo4j.io")).toBe(true);
    process.env.NEO4J_HTTP_URL = "https://abcd.databases.neo4j.io";
    process.env.NEO4J_PASSWORD = "test-aura-pass";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(String(url)).toContain("/query/v2");
        return Response.json({ data: { fields: ["count"], values: [[42]] } });
      }),
    );
    const body = await neo4jHttpQuery("MATCH (n) RETURN count(n) AS count");
    expect(body.results[0]?.data[0]?.row[0]).toBe(42);
  });

  it("searchVectorMemory surfaces mem0 HTTP errors on the direct path", async () => {
    vi.spyOn(registry, "getAdapters").mockImplementation(() => []);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ detail: "search offline" }, { status: 503 })),
    );
    let message = "";
    try {
      await searchVectorMemory("hello", 3);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("search offline");
  });

  it("searchVectorMemory uses recent query fallback when search text is empty", async () => {
    vi.spyOn(registry, "getAdapters").mockImplementation(() => []);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(String(url)).toContain("q=recent");
        return Response.json({ results: [] });
      }),
    );
    await searchVectorMemory("", 5);
  });

  it("marks vector degraded on mem0 disk warning without home-advisory alone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "ok",
          vector_store: "connected",
          queue: { queued: 0 },
          memory_runtime: { status: "available" },
          disk: { warning: true, critical: false },
        }),
      ),
    );
    const health = await checkVectorHealth();
    expect(health.status).toBe("up");
    expect(String(health.detail ?? "")).toMatch(/disk warning/);
  });

  it("queryGraphMemory and checkGraphHealth use the direct Neo4j HTTP path when no adapter is registered", async () => {
    const getAdaptersSpy = vi.spyOn(registry, "getAdapters").mockReturnValue([]);
    process.env.NEO4J_PASSWORD = "test-graph-pass";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(String(url)).toContain("/tx/commit");
        expect(init?.method).toBe("POST");
        return Response.json({
          results: [{ data: [{ row: [{ name: "Node A" }, ["KNOWS"], [{ title: "Node B" }]] }] }],
        });
      }),
    );

    const graphResults = await queryGraphMemory("node", 3);
    expect(graphResults).toEqual({
      results: [{ data: [{ row: [{ name: "Node A" }, ["KNOWS"], [{ title: "Node B" }]] }] }],
    });

    const health = await checkGraphHealth();
    expect(health).toMatchObject({ tier: "graph", backend: "neo4j", status: "up" });
    getAdaptersSpy.mockRestore();
  });
});
