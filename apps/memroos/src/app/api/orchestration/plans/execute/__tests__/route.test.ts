// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));
const executeOrchestrationPlan = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, success: true, status: "completed", runId: "orch-1" }))
);

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () =>
    Response.json({ ok: false, error: "unauthorized" }, { status: 403 }),
}));

vi.mock("@/lib/orchestration/client", () => ({
  executeOrchestrationPlan: (...args: unknown[]) => executeOrchestrationPlan(...args),
}));

const { POST } = await import("../route");

describe("POST /api/orchestration/plans/execute", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
    executeOrchestrationPlan.mockClear();
  });

  it("returns 403 without operator auth", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const res = await POST(
      new Request("http://localhost/api/orchestration/plans/execute", {
        method: "POST",
        body: JSON.stringify({ planId: "p1" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 for non-object body", async () => {
    const res = await POST(new Request("http://localhost/api/orchestration/plans/execute", { method: "POST", body: "[]" }));
    expect(res.status).toBe(400);
  });

  it("executes plan via orchestration client", async () => {
    const res = await POST(
      new Request("http://localhost/api/orchestration/plans/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: "p1", steps: [] }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("returns 502 when client throws", async () => {
    executeOrchestrationPlan.mockRejectedValueOnce(new Error("down"));
    const res = await POST(
      new Request("http://localhost/api/orchestration/plans/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: "p1" }),
      })
    );
    expect(res.status).toBe(502);
  });
});
