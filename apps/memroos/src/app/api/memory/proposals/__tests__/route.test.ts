// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { persistEvalRun } from "@/lib/evals/persistence";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () =>
    Response.json({ error: "unauthorized" }, { status: 403 }),
}));

const { GET, POST } = await import("../route");

function seedRun(id: string, traceId: string) {
  persistEvalRun(testDb, {
    id,
    traceId,
    agentId: "agent-mem",
    role: "ops",
    compositeW: 0.55,
    trusted: true,
    layers: {
      l1: { score: 0.55, weight: 0.2, scorers: [] },
      l2: { score: 0.55, weight: 0.5, scorers: [] },
      l3: { score: 0.55, weight: 0.3, scorers: [] },
    },
    scorerResults: [],
    judge: {
      score: 0.55,
      rubricScores: { faithful: 0.55, useful: 0.55, policy: 0.55 },
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
}

describe("/api/memory/proposals", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
  });

  it("GET lists memory proposal types metadata", async () => {
    const res = await GET(new Request("http://localhost/api/memory/proposals") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.proposals)).toBe(true);
    expect(body.types.memory_rewrite).toBeTruthy();
  });

  it("POST returns 403 without operator auth", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const res = await POST(
      new Request("http://localhost/api/memory/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ traceId: "t1", runId: "r1" }),
      }) as never
    );
    expect(res.status).toBe(403);
  });

  it("POST returns 400 when traceId or runId missing", async () => {
    const res = await POST(
      new Request("http://localhost/api/memory/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ traceId: "only-trace" }),
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("POST creates memory proposals for a valid eval run", async () => {
    seedRun("mem-run-1", "mem-trace-1");
    const res = await POST(
      new Request("http://localhost/api/memory/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          traceId: "mem-trace-1",
          runId: "mem-run-1",
          proposalTypes: ["memory_rewrite"],
        }),
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.proposals.length).toBeGreaterThan(0);
  });
});
