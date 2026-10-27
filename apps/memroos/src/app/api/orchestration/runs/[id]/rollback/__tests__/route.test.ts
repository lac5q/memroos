// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));
const rollbackOrchestrationRun = vi.hoisted(() => vi.fn());

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () => Response.json({ ok: false, error: "forbidden" }, { status: 403 }),
}));

vi.mock("@/lib/orchestration/client", () => ({
  rollbackOrchestrationRun: (...args: unknown[]) => rollbackOrchestrationRun(...args),
}));

const { POST } = await import("../route");

describe("POST /api/orchestration/runs/[id]/rollback", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
    rollbackOrchestrationRun.mockReset();
  });

  it("returns 403 when registry write is unauthorized", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const res = await POST(new Request("http://localhost/api/orchestration/runs/r1/rollback", { method: "POST", body: "{}" }), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 when body is not a JSON object", async () => {
    const res = await POST(new Request("http://localhost/api/orchestration/runs/r1/rollback", { method: "POST", body: "null" }), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 502 when orchestration client fails", async () => {
    rollbackOrchestrationRun.mockRejectedValueOnce(new Error("rollback unavailable"));
    const res = await POST(
      new Request("http://localhost/api/orchestration/runs/r1/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt: "abc" }),
      }),
      { params: Promise.resolve({ id: "r1" }) }
    );
    expect(res.status).toBe(502);
  });

  it("returns orchestration result on success", async () => {
    rollbackOrchestrationRun.mockResolvedValueOnce({ ok: true, status: "rolled_back" });
    const res = await POST(
      new Request("http://localhost/api/orchestration/runs/r1/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receipt: "abc" }),
      }),
      { params: Promise.resolve({ id: "r1" }) }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "rolled_back" });
  });
});
