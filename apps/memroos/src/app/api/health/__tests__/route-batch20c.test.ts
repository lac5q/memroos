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
  AGENT_CONFIGS_PATH: "/tmp/agent-configs-batch20c",
}));

beforeEach(() => {
  mockExecFile.mockReset();
  mockCheckGraphHealth.mockReset();
  mockFsStat.mockReset();
  vi.resetModules();
  process.env.HOME = "/tmp";
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe("health route batch20c", () => {
  it("GET marks optional RTK/QMD as degraded when binaries missing", async () => {
    execFail();
    mockCheckGraphHealth.mockResolvedValue({ status: "not_configured", backend: "neo4j" });
    mockFsStat.mockRejectedValue(new Error("no apo dir"));
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })) as typeof fetch;

    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    const rtk = body.services.find((s: { service: string }) => s.service === "RTK");
    const qmd = body.services.find((s: { service: string }) => s.service === "QMD");
    expect(rtk.status).toBe("degraded");
    expect(qmd.status).toBe("degraded");
  });

  it("GET reports graph memory down when Neo4j is not configured", async () => {
    execSuccess("1.0.0");
    mockCheckGraphHealth.mockResolvedValue({ status: "not_configured", backend: "neo4j" });
    mockFsStat.mockResolvedValue({ isFile: () => true });
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, pendingEmbeddings: 0, failures: [], warnings: [] }),
    })) as typeof fetch;

    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    const graph = body.services.find((s: { service: string }) => s.service === "Graph Memory");
    expect(graph.status).toBe("down");
    expect(graph.detail).toMatch(/not configured/i);
  });
});
