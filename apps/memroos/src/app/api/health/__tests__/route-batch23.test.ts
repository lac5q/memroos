// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecFile = vi.fn();
const mockCheckGraphHealth = vi.fn();
const mockFsStat = vi.fn();

vi.mock("child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

vi.mock("@/lib/memory/backends", () => ({
  checkGraphHealth: (...args: unknown[]) => mockCheckGraphHealth(...args),
  mem0HealthTimeoutMs: () => 1000,
}));

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    stat: (...args: unknown[]) => mockFsStat(...args),
  };
});

vi.mock("@/lib/constants", () => ({
  MEM0_URL: "http://localhost:8080",
  AGENT_CONFIGS_PATH: "/tmp/agent-configs-batch23",
}));

function execSuccess(stdout = "") {
  mockExecFile.mockImplementation((_file, _args, _opts, cb) => {
    cb(null, stdout, "");
  });
}

function execFail() {
  mockExecFile.mockImplementation((_file, _args, _opts, cb) => {
    cb(new Error("missing"), "", "");
  });
}

describe("GET /api/health batch23", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
    mockCheckGraphHealth.mockReset();
    mockFsStat.mockReset();
    vi.resetModules();
    process.env.HOME = "/tmp";
    delete process.env.KNOWLEDGE_INDEX_HEALTH_REQUEST_TIMEOUT_MS;
    delete process.env.KNOWLEDGE_INDEX_HEALTH_TTL_MS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tolerates non-JSON mem0 health bodies", async () => {
    execFail();
    mockCheckGraphHealth.mockResolvedValue({ status: "not_configured", backend: "neo4j" });
    mockFsStat.mockRejectedValue(new Error("no apo"));
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("bad mem0 json batch23");
      },
    })) as typeof fetch;

    const { GET } = await import("../route");
    const res = await GET();
    const mem0 = (await res.json()).services.find((s: { service: string }) => s.service === "mem0");
    expect(mem0.status).toBe("degraded");
    expect(mem0.detail).toMatch(/vector store/i);
  });

  it("returns degraded knowledge index detail when the refresh times out without cache", async () => {
    process.env.KNOWLEDGE_INDEX_HEALTH_REQUEST_TIMEOUT_MS = "5";
    execSuccess("/usr/bin/qmd");
    mockCheckGraphHealth.mockResolvedValue({ status: "not_configured", backend: "neo4j" });
    mockFsStat.mockRejectedValue(new Error("no apo"));
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })) as typeof fetch;

    mockExecFile.mockImplementation((file, args, _opts, cb) => {
      if (file === "which") {
        cb(null, "/usr/bin/qmd", "");
        return;
      }
      if (Array.isArray(args) && String(args[0] ?? "").includes("check-knowledge-indexing.mjs")) {
        setTimeout(() => cb(null, JSON.stringify({ ok: true, pendingEmbeddings: 0 }), ""), 200);
        return;
      }
      cb(new Error("unexpected"), "", "");
    });

    const { GET } = await import("../route");
    const res = await GET();
    const knowledge = (await res.json()).services.find(
      (s: { service: string }) => s.service === "Knowledge Index"
    );
    expect(knowledge.status).toBe("degraded");
    expect(knowledge.detail).toMatch(/still running/i);
  });
});
