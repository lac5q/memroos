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
  AGENT_CONFIGS_PATH: "/tmp/agent-configs-batch24",
}));

function execSuccess(stdout = "") {
  mockExecFile.mockImplementation((_file, args, _opts, cb) => {
    if (Array.isArray(args) && String(args[0] ?? "").includes("check-knowledge-indexing.mjs")) {
      cb(null, stdout, "");
      return;
    }
    cb(null, "/usr/bin/qmd", "");
  });
}

describe("GET /api/health batch24", () => {
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

  it("returns cached knowledge index detail when refresh times out with stale cache", async () => {
    process.env.KNOWLEDGE_INDEX_HEALTH_REQUEST_TIMEOUT_MS = "5";
    process.env.KNOWLEDGE_INDEX_HEALTH_TTL_MS = "1";
    mockCheckGraphHealth.mockResolvedValue({ status: "not_configured", backend: "neo4j" });
    mockFsStat.mockRejectedValue(new Error("no apo"));
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })) as typeof fetch;

    execSuccess(JSON.stringify({ ok: true, pendingEmbeddings: 2 }));

    const { GET } = await import("../route");
    const first = await GET();
    const firstKnowledge = (await first.json()).services.find(
      (s: { service: string }) => s.service === "Knowledge Index",
    );
    expect(firstKnowledge.status).toBe("up");

    await new Promise((resolve) => setTimeout(resolve, 15));

    mockExecFile.mockImplementation((_file, args, _opts, cb) => {
      if (Array.isArray(args) && String(args[0] ?? "").includes("check-knowledge-indexing.mjs")) {
        setTimeout(() => cb(null, JSON.stringify({ ok: true, pendingEmbeddings: 0 }), ""), 200);
        return;
      }
      cb(null, "/usr/bin/qmd", "");
    });

    const second = await GET();
    const secondKnowledge = (await second.json()).services.find(
      (s: { service: string }) => s.service === "Knowledge Index",
    );
    expect(secondKnowledge.status).toBe("up");
    expect(secondKnowledge.detail).toMatch(/refresh still running/i);
    expect(secondKnowledge.detail).toMatch(/pending embeddings/i);
  });
});
