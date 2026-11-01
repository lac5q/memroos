// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { persistEvalRun } from "@/lib/evals/persistence";

const testDb = new Database(":memory:");
initSchema(testDb);

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));
const mockListProposals = vi.hoisted(() => vi.fn());
const mockGetRunById = vi.hoisted(() => vi.fn());
const mockCreateProposal = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () => Response.json({ error: "unauthorized" }, { status: 403 }),
}));

vi.mock("@/lib/seal/service", () => ({
  SealService: class {
    listProposals = mockListProposals;
    createProposal = mockCreateProposal;
    evalService = { getRunById: mockGetRunById };
  },
}));

const LOOPBACK = "http://localhost";

describe("/api/memory/proposals batch23", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReturnValue(true);
    mockListProposals.mockReset();
    mockGetRunById.mockReset();
    mockCreateProposal.mockReset();
  });

  it("GET filters proposals by status query param", async () => {
    mockListProposals.mockReturnValue([
      { proposalType: "memory_rewrite", status: "approved", id: "p1" },
      { proposalType: "other_type", status: "approved", id: "p3" },
    ]);
    const { GET } = await import("../route");
    const res = await GET(new Request(`${LOOPBACK}/api/memory/proposals?status=approved`) as never);
    const body = await res.json();
    expect(mockListProposals).toHaveBeenCalledWith({ status: "approved" });
    expect(body.proposals).toHaveLength(1);
    expect(body.proposals[0].id).toBe("p1");
  });

  it("POST returns 400 for invalid JSON bodies", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/memory/proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("POST returns 404 when the eval run is missing", async () => {
    mockGetRunById.mockReturnValue(null);
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/memory/proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ traceId: "t1", runId: "missing-run" }),
      }) as never
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("missing-run") });
  });

  it("POST returns 400 when proposal creation throws", async () => {
    persistEvalRun(testDb, {
      id: "run-batch23",
      traceId: "trace-batch23",
      agentId: "agent-mem",
      role: "ops",
      compositeW: 0.5,
      trusted: true,
      layers: {
        l1: { score: 0.5, weight: 0.2, scorers: [] },
        l2: { score: 0.5, weight: 0.5, scorers: [] },
        l3: { score: 0.5, weight: 0.3, scorers: [] },
      },
      scorerResults: [],
      judge: {
        score: 0.5,
        rubricScores: { faithful: 0.5, useful: 0.5, policy: 0.5 },
        model: "judge",
        provider: "local",
        modelFamily: "local",
        promptTemplateVersion: "v1",
        promptHash: "hash",
        positionBiasMitigation: { swapAugmentation: true, orderAgreement: true },
      },
      driftGuard: {
        status: "passed",
        agreement: 1,
        floor: 0.85,
        goldenSetVersion: "golden",
        examples: [],
      },
      configHash: "config",
      goldenSetPath: "./golden.jsonl",
      startedAt: "2026-05-15T00:00:00.000Z",
      completedAt: "2026-05-15T00:00:01.000Z",
    });
    mockGetRunById.mockReturnValue({
      traceId: "trace-batch23",
      agentId: "agent-mem",
      compositeW: 0.5,
      layers: {},
    });
    mockCreateProposal.mockImplementation(() => {
      throw new Error("create proposal failed batch23");
    });
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/memory/proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          traceId: "trace-batch23",
          runId: "run-batch23",
          proposalTypes: ["memory_rewrite"],
        }),
      }) as never
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "create proposal failed batch23" });
  });
});
