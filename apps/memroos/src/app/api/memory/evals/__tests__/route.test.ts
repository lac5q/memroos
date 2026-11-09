// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () => Response.json({ ok: false, error: "forbidden" }, { status: 403 }),
}));

vi.mock("@/lib/memory-recall-evals", () => ({
  getLatestMemoryEvalRun: vi.fn(),
  runMemoryRecallEvalSuite: vi.fn(),
}));

async function loadRoutes() {
  vi.resetModules();
  const latestRoute = await import("../latest/route");
  const runRoute = await import("../run/route");
  const evals = await import("@/lib/memory-recall-evals");
  return { latestRoute, runRoute, evals };
}

describe("memory eval API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
  });

  it("returns 403 for latest when registry write is unauthorized", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const { latestRoute } = await loadRoutes();
    const response = await latestRoute.GET(new Request("http://localhost/api/memory/evals/latest"));
    expect(response.status).toBe(403);
  });

  it("returns 403 for run when registry write is unauthorized", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const { runRoute } = await loadRoutes();
    const response = await runRoute.POST(new Request("http://localhost/api/memory/evals/run", { method: "POST" }));
    expect(response.status).toBe(403);
  });

  it("returns the latest persisted eval run", async () => {
    const { latestRoute, evals } = await loadRoutes();
    vi.mocked(evals.getLatestMemoryEvalRun).mockReturnValue({
      ok: true,
      run: {
        id: "run-1",
        mode: "gold",
        status: "passed",
        startedAt: "2026-05-15T00:00:00.000Z",
        completedAt: "2026-05-15T00:01:00.000Z",
        summary: { totalCases: 1, passedCases: 1, failedCases: 0, passRate: 1, p95LatencyMs: 100, tierFailures: [] },
        results: [],
      },
      timestamp: "2026-05-15T00:01:00.000Z",
    });

    const response = await latestRoute.GET(new Request("http://localhost/api/memory/evals/latest"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.run.id).toBe("run-1");
    expect(body.run.summary.passRate).toBe(1);
  });

  it("runs the suite on demand", async () => {
    const { runRoute, evals } = await loadRoutes();
    vi.mocked(evals.runMemoryRecallEvalSuite).mockResolvedValue({
      id: "run-2",
      mode: "canary",
      status: "failed",
      startedAt: "2026-05-15T00:00:00.000Z",
      completedAt: "2026-05-15T00:01:00.000Z",
      summary: { totalCases: 1, passedCases: 0, failedCases: 1, passRate: 0, p95LatencyMs: 5000, tierFailures: ["vector"] },
      results: [],
    });

    const response = await runRoute.POST(
      new Request("http://localhost/api/memory/evals/run?mode=canary", { method: "POST" })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.run.status).toBe("failed");
    expect(body.run.summary.tierFailures).toEqual(["vector"]);
    expect(evals.runMemoryRecallEvalSuite).toHaveBeenCalledWith(expect.objectContaining({ mode: "canary" }));
  });
});
