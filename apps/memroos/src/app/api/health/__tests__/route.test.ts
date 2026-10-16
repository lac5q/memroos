// @vitest-environment node
import { execFile } from "child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  stat: vi.fn(async () => ({})),
}));

async function loadRoute() {
  vi.resetModules();
  return import("../route");
}

describe("runtime health route", () => {
  beforeEach(() => {
    process.env.MEM0_URL = "http://mem0.test";
    process.env.KNOWLEDGE_INDEX_HEALTH_TTL_MS = "0";
    vi.mocked(execFile).mockImplementation((_command, args, options, callback) => {
      const done = typeof options === "function" ? options : callback;
      if (!done) throw new Error("missing callback");
      if (Array.isArray(args) && args.includes("--json")) {
        done(null, JSON.stringify({ ok: true, pendingEmbeddings: 0, failures: [], warnings: [] }), "");
        return {} as ReturnType<typeof execFile>;
      }
      done(null, "", "");
      return {} as ReturnType<typeof execFile>;
    });
  });

  afterEach(() => {
    delete process.env.MEM0_URL;
    delete process.env.MEM0_HEALTH_TIMEOUT_MS;
    delete process.env.KNOWLEDGE_INDEX_HEALTH_TTL_MS;
    delete process.env.KNOWLEDGE_INDEX_HEALTH_REQUEST_TIMEOUT_MS;
    delete process.env.NEO4J_PASSWORD;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("probes mem0 with the shared MEM0_HEALTH_TIMEOUT_MS budget (default 15s)", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "ok",
          vector_store: "connected",
          memory_runtime: { status: "available" },
          queue: { queued: 0 },
        })
      )
    );
    const { GET } = await loadRoute();
    await GET();

    expect(timeoutSpy).toHaveBeenCalledWith(15_000);
    timeoutSpy.mockRestore();
  });

  it("honors MEM0_HEALTH_TIMEOUT_MS for the operator mem0 probe", async () => {
    process.env.MEM0_HEALTH_TIMEOUT_MS = "12500";
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "ok",
          vector_store: "connected",
          memory_runtime: { status: "available" },
          queue: { queued: 0 },
        })
      )
    );
    const { GET } = await loadRoute();
    await GET();

    expect(timeoutSpy).toHaveBeenCalledWith(12_500);
    timeoutSpy.mockRestore();
  });

  it("marks mem0 degraded when the health payload reports queued writes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "degraded",
          vector_store: "connected",
          queue: { queued: 3 },
        })
      )
    );
    const { GET } = await loadRoute();

    const response = await GET();
    const body = await response.json();
    const mem0 = body.services.find((service: { service: string }) => service.service === "mem0");

    expect(mem0.status).toBe("degraded");
    expect(mem0.detail).toContain("3 queued memory saves");
  });

  it("marks mem0 degraded when Qdrant is not connected through mem0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "ok",
          vector_store: "unavailable",
          queue: { queued: 0 },
        })
      )
    );
    const { GET } = await loadRoute();

    const response = await GET();
    const body = await response.json();
    const mem0 = body.services.find((service: { service: string }) => service.service === "mem0");

    expect(mem0.status).toBe("degraded");
    expect(mem0.detail).toContain("vector store unavailable");
  });

  it("marks mem0 degraded when the runtime package is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "ok",
          vector_store: "connected",
          memory_runtime: { status: "unavailable", error: "No module named 'mem0'" },
          queue: { queued: 0 },
        })
      )
    );
    const { GET } = await loadRoute();

    const response = await GET();
    const body = await response.json();
    const mem0 = body.services.find((service: { service: string }) => service.service === "mem0");

    expect(mem0.status).toBe("degraded");
    expect(mem0.detail).toContain("runtime unavailable: No module named 'mem0'");
  });

  it("includes failure details when a service check throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:3201");
      })
    );
    const { GET } = await loadRoute();

    const response = await GET();
    const body = await response.json();
    const mem0 = body.services.find((service: { service: string }) => service.service === "mem0");

    expect(mem0.status).toBe("down");
    expect(mem0.detail).toContain("ECONNREFUSED");
  });

  it("includes the source-to-QMD knowledge indexing contract in app health", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "ok",
          vector_store: "connected",
          memory_runtime: { status: "available" },
          queue: { queued: 0 },
        })
      )
    );
    const { GET } = await loadRoute();

    const response = await GET();
    const body = await response.json();
    const knowledge = body.services.find((service: { service: string }) => service.service === "Knowledge Index");

    expect(knowledge.status).toBe("up");
    expect(knowledge.detail).toBe("0 pending embeddings");
  });

  it("marks knowledge indexing degraded when the contract report has failures", async () => {
    vi.mocked(execFile).mockImplementation((_command, args, options, callback) => {
      const done = typeof options === "function" ? options : callback;
      if (!done) throw new Error("missing callback");
      if (Array.isArray(args) && args.includes("--json")) {
        done(
          new Error("knowledge index contract failed"),
          JSON.stringify({
            ok: false,
            pendingEmbeddings: 63,
            failures: ["emails: missing qmd://emails/example.md"],
            warnings: [],
          }),
          ""
        );
        return {} as ReturnType<typeof execFile>;
      }
      done(null, "", "");
      return {} as ReturnType<typeof execFile>;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "ok",
          vector_store: "connected",
          memory_runtime: { status: "available" },
          queue: { queued: 0 },
        })
      )
    );
    const { GET } = await loadRoute();

    const response = await GET();
    const body = await response.json();
    const knowledge = body.services.find((service: { service: string }) => service.service === "Knowledge Index");

    expect(knowledge.status).toBe("degraded");
    expect(knowledge.detail).toContain("63 pending embeddings");
    expect(knowledge.detail).toContain("missing qmd");
  });

  it("returns a bounded degraded result when knowledge indexing is still running", async () => {
    process.env.KNOWLEDGE_INDEX_HEALTH_REQUEST_TIMEOUT_MS = "1";
    vi.mocked(execFile).mockImplementation((_command, args, options, callback) => {
      const done = typeof options === "function" ? options : callback;
      if (!done) throw new Error("missing callback");
      if (Array.isArray(args) && args.includes("--json")) {
        return {} as ReturnType<typeof execFile>;
      }
      done(null, "", "");
      return {} as ReturnType<typeof execFile>;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "ok",
          vector_store: "connected",
          memory_runtime: { status: "available" },
          queue: { queued: 0 },
        })
      )
    );
    const { GET } = await loadRoute();

    const response = await GET();
    const body = await response.json();
    const knowledge = body.services.find((service: { service: string }) => service.service === "Knowledge Index");

    expect(knowledge.status).toBe("degraded");
    expect(knowledge.detail).toContain("still running");
  });

  it("marks mem0 down when the health endpoint returns a non-OK HTTP status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream error", { status: 503 }))
    );
    const { GET } = await loadRoute();

    const response = await GET();
    const body = await response.json();
    const mem0 = body.services.find((service: { service: string }) => service.service === "mem0");

    expect(mem0.status).toBe("down");
    expect(mem0.detail).toContain("HTTP 503");
  });

  it("reports RTK as up when the rtk binary responds to --version", async () => {
    vi.mocked(execFile).mockImplementation((command, args, options, callback) => {
      const done = typeof options === "function" ? options : callback;
      if (!done) throw new Error("missing callback");
      if (command === "rtk" && Array.isArray(args) && args.includes("--version")) {
        done(null, "rtk 0.1.0", "");
        return {} as ReturnType<typeof execFile>;
      }
      if (Array.isArray(args) && args.includes("--json")) {
        done(null, JSON.stringify({ ok: true, pendingEmbeddings: 0, failures: [], warnings: [] }), "");
        return {} as ReturnType<typeof execFile>;
      }
      done(null, "", "");
      return {} as ReturnType<typeof execFile>;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "ok",
          vector_store: "connected",
          memory_runtime: { status: "available" },
          queue: { queued: 0 },
        })
      )
    );
    const { GET } = await loadRoute();
    const body = await (await GET()).json();
    const rtk = body.services.find((service: { service: string }) => service.service === "RTK");
    expect(rtk.status).toBe("up");
  });

  it("includes knowledge indexing warnings in the health detail", async () => {
    vi.mocked(execFile).mockImplementation((_command, args, options, callback) => {
      const done = typeof options === "function" ? options : callback;
      if (!done) throw new Error("missing callback");
      if (Array.isArray(args) && args.includes("--json")) {
        done(
          null,
          JSON.stringify({
            ok: false,
            pendingEmbeddings: 2,
            failures: [],
            warnings: ["emails: stale embedding batch"],
          }),
          ""
        );
        return {} as ReturnType<typeof execFile>;
      }
      done(null, "", "");
      return {} as ReturnType<typeof execFile>;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "ok",
          vector_store: "connected",
          memory_runtime: { status: "available" },
          queue: { queued: 0 },
        })
      )
    );
    const { GET } = await loadRoute();
    const body = await (await GET()).json();
    const knowledge = body.services.find((service: { service: string }) => service.service === "Knowledge Index");
    expect(knowledge.detail).toContain("stale embedding batch");
  });

  it("includes graph memory status in app health", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "ok",
          vector_store: "connected",
          memory_runtime: { status: "available" },
          queue: { queued: 0 },
        })
      )
    );
    const { GET } = await loadRoute();

    const response = await GET();
    const body = await response.json();
    const graph = body.services.find((service: { service: string }) => service.service === "Graph Memory");

    expect(graph.status).toBe("down");
    expect(graph.detail).toMatch(/not configured|NOT storing/i);
  });
});
