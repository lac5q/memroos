// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authenticateAgentHeaders = vi.hoisted(() => vi.fn());
const runBoundedDiscussCouncil = vi.hoisted(() => vi.fn());

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: (...args: unknown[]) => authenticateAgentHeaders(...args),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual };
});

vi.mock("@/lib/gsd/discuss", () => ({
  runBoundedDiscussCouncil: (...args: unknown[]) => runBoundedDiscussCouncil(...args),
}));

const LOOPBACK = "http://localhost";

beforeEach(() => {
  authenticateAgentHeaders.mockReturnValue({ id: "gsd-agent-b37", tenantId: "default-tenant" });
  runBoundedDiscussCouncil.mockReturnValue({
    blockedReasons: [],
    verdict: { validatorPass: true, risks: ["real-risk"] },
  });
  vi.resetModules();
});

describe("POST /api/gsd/discuss batch37", () => {
  it("filters non-string verdict.risks entries (44)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new NextRequest(`${LOOPBACK}/api/gsd/discuss`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goalId: `goal-b37-${randomUUID().slice(0, 8)}`,
          topic: "batch37 risks filter",
          lane: "ops",
          taskBudget: { maxRounds: 1, maxAgents: 2 },
          roles: [],
          contributions: [],
          verdict: {
            decision: "approve",
            summary: "ok",
            risks: ["keep-me", 99, null, { bad: true }],
          },
        }),
      }),
    );
    expect(runBoundedDiscussCouncil).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        verdict: expect.objectContaining({
          risks: ["keep-me"],
        }),
      }),
    );
    expect(res.status).toBe(200);
  });
});